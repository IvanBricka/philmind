"""Collecte quotidienne des nouveautés PhilPapers en philosophie de l'esprit.

Sources (publiques, sans compte) :
  - /browse/philosophy-of-mind?recent=1&sort=added&format=json  -> titres, auteurs, résumés, date d'ajout
  - même requête en format=bib                                   -> type de publication (@article, @book, ...)

Sortie : docs/data/items.json (fusionné avec l'existant, fenêtre glissante de KEEP_DAYS jours).
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from lingua import LanguageDetectorBuilder

BASE = "https://philpapers.org/browse/philosophy-of-mind"
PARAMS = {"recent": "1", "sort": "added", "limit": "500"}
HEADERS = {"User-Agent": "PhilMindDigest/0.1 (lecteur personnel de nouveautes)"}
KEEP_DAYS = 120

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "items.json"

# Type BibTeX -> onglet de l'appli
TYPE_MAP = {"article": "article", "book": "livre"}  # tout le reste -> "autre"
SUBTYPE_LABEL = {
    "article": "Article de revue",
    "book": "Livre",
    "incollection": "Chapitre de livre",
    "inbook": "Chapitre de livre",
    "phdthesis": "Thèse",
    "mastersthesis": "Mémoire",
    "unpublished": "Manuscrit / prépublication",
    "inproceedings": "Actes de colloque",
    "misc": "Divers",
}

TAG_RE = re.compile(r"<[^>]+>")


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG_RE.sub("", s or ""))).strip()


def fetch(fmt: str) -> requests.Response:
    last = None
    for attempt in range(3):
        try:
            r = requests.get(BASE, params={**PARAMS, "format": fmt}, headers=HEADERS, timeout=60)
            if r.status_code == 200 and "Cloudflare" not in r.text[:2000]:
                return r
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:  # réseau
            last = str(e)
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Échec de la requête format={fmt}: {last}")


def bib_types(bib: str, ids: list[str]) -> dict[str, str]:
    """Associe chaque identifiant PhilPapers à son type BibTeX."""
    keys = re.findall(r"^@(\w+)\{([^,\s]+),", bib, flags=re.M)
    out: dict[str, str] = {}
    for btype, key in keys:
        for pid in ids:
            if key.endswith("-" + pid) or key == pid:
                out[pid] = btype.lower()
                break
    return out


LANG_FR_NAMES = {
    "en": "Anglais", "fr": "Français", "de": "Allemand", "es": "Espagnol", "it": "Italien",
    "pt": "Portugais", "nl": "Néerlandais", "ru": "Russe", "uk": "Ukrainien", "pl": "Polonais",
    "cs": "Tchèque", "tr": "Turc", "el": "Grec", "zh": "Chinois", "ja": "Japonais", "ko": "Coréen",
    "ar": "Arabe", "fa": "Persan", "he": "Hébreu", "sv": "Suédois", "da": "Danois", "nb": "Norvégien",
    "fi": "Finnois", "hu": "Hongrois", "ro": "Roumain", "ca": "Catalan", "hr": "Croate", "sr": "Serbe",
    "sl": "Slovène", "sk": "Slovaque", "bg": "Bulgare", "id": "Indonésien", "vi": "Vietnamien", "hi": "Hindi",
}

# Mots-outils : très fiables pour trancher anglais / français sur des titres courts.
EN_WORDS = set("the of and in on a an to for is are what why how with as from our its their by not or between".split())
FR_WORDS = set("le la les de des du et un une est sont que qui pour dans sur au aux entre ou pas ce cette son sa ses leur".split())
# Mots-outils espagnols / italiens / portugais, pour ne pas confondre avec le français ("que", "la"…).
OTHER_ROMANCE_WORDS = set(
    "el lo los las del y con por para su sus una il della dello degli gli di che non um uma do da dos das em ao não".split()
)
WORD_RE = re.compile(r"[a-zàâçéèêëîïôûùüÿœæ]+", re.I)


def build_detector():
    from lingua import Language

    names = {
        "en": "ENGLISH", "fr": "FRENCH", "de": "GERMAN", "es": "SPANISH", "it": "ITALIAN",
        "pt": "PORTUGUESE", "nl": "DUTCH", "ru": "RUSSIAN", "uk": "UKRAINIAN", "pl": "POLISH",
        "cs": "CZECH", "tr": "TURKISH", "el": "GREEK", "zh": "CHINESE", "ja": "JAPANESE", "ko": "KOREAN",
        "ar": "ARABIC", "fa": "PERSIAN", "he": "HEBREW", "sv": "SWEDISH", "da": "DANISH", "nb": "BOKMAL",
        "fi": "FINNISH", "hu": "HUNGARIAN", "ro": "ROMANIAN", "ca": "CATALAN", "hr": "CROATIAN",
        "sr": "SERBIAN", "sl": "SLOVENE", "sk": "SLOVAK", "bg": "BULGARIAN", "id": "INDONESIAN",
        "vi": "VIETNAMESE", "hi": "HINDI",
    }
    langs = [getattr(Language, n) for n in names.values()]
    return LanguageDetectorBuilder.from_languages(*langs).with_preloaded_language_models().build()


def detect_lang(detector, title: str, abstract: str) -> tuple[str, str]:
    """Renvoie (code ISO 639-1, nom de la langue en français).

    La langue du titre prime (un texte français a souvent un résumé anglais) ;
    le résumé sert à confirmer quand le titre est trop court pour conclure.
    """

    def name(code: str) -> str:
        return LANG_FR_NAMES.get(code, code)

    def top(text: str):
        cv = detector.compute_language_confidence_values(text)
        if not cv:
            return None, 0.0
        return cv[0].language.iso_code_639_1.name.lower(), cv[0].value

    t_code, t_conf = top(title)
    words = [w.lower() for w in WORD_RE.findall(title)]
    en = sum(w in EN_WORDS for w in words)
    fr = sum(w in FR_WORDS for w in words)
    # Élisions françaises (l', d', qu') comptent pour le français.
    fr += len(re.findall(r"\b(?:l|d|qu|n|s|c)['’]\w", title, flags=re.I))

    # 1) Titre clairement dans une langue autre que en/fr
    if t_code not in ("en", "fr", None) and t_conf >= (0.9 if en > fr else 0.6):
        return t_code, name(t_code)
    # 2) Mots-outils anglais / français dans le titre
    other = sum(w in OTHER_ROMANCE_WORDS for w in words)
    if en > fr and en > other:
        return "en", name("en")
    if fr > en and fr > other:
        return "fr", name("fr")
    # 3) Titre seul assez sûr
    if t_code and t_conf >= 0.6:
        return t_code, name(t_code)
    # 4) Le résumé tranche
    if len(abstract) > 80:
        a_code, a_conf = top(abstract[:800])
        if a_code and a_conf >= 0.5:
            return a_code, name(a_code)
    # 5) Par défaut : anglais (≈ 90 % du corpus)
    if t_code and t_code != "en" and (t_conf >= 0.45 or (other and t_code in ("es", "it", "pt", "ca"))):
        return t_code, name(t_code)
    return "en", name("en")


def parse_items(data: dict, types: dict[str, str], detector) -> list[dict]:
    items = []
    for e in data.get("content", []):
        if e.get("deleted"):
            continue
        entry = e.get("__entry__", "")
        m = re.search(r"recTitle'>(.*?)</span>", entry, flags=re.S)
        title = strip_tags(m.group(1)) if m else e["id"]
        m = re.search(r"<span class='pubInfo'>(.*)</span>\s*$", entry, flags=re.S)
        pub = strip_tags(m.group(1)) if m else ""
        abstract = " ".join(x for x in (e.get("excerpt1"), e.get("excerpt2")) if x).strip()
        abstract = strip_tags(abstract)
        btype = types.get(e["id"], "misc")
        code, name = detect_lang(detector, title, abstract)
        items.append(
            {
                "id": e["id"],
                "title": title,
                "authors": e.get("authors") or [],
                "year": e.get("date", ""),
                "pub": pub,
                "abstract": abstract,
                "added": e.get("added", "")[:10],
                "type": TYPE_MAP.get(btype, "autre"),
                "subtype": SUBTYPE_LABEL.get(btype, btype),
                "lang": code,
                "langName": name,
                "url": f"https://philpapers.org/rec/{e['id']}",
            }
        )
    return items


def main() -> int:
    print("Récupération JSON…")
    data = fetch("json").json()
    ids = [e["id"] for e in data.get("content", [])]
    time.sleep(3)  # politesse envers le serveur
    print("Récupération BibTeX…")
    types = bib_types(fetch("bib").text, ids)
    print(f"{len(ids)} entrées, {len(types)} types identifiés. Détection des langues…")
    detector = build_detector()
    fresh = parse_items(data, types, detector)

    existing = {}
    if OUT.exists():
        for it in json.loads(OUT.read_text(encoding="utf-8")).get("items", []):
            existing[it["id"]] = it
    for it in fresh:
        existing[it["id"]] = it
    # Recalcule la langue partout, pour que les améliorations de la détection s'appliquent à l'historique.
    for it in existing.values():
        it["lang"], it["langName"] = detect_lang(detector, it["title"], it.get("abstract", ""))

    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    items = sorted(
        (it for it in existing.values() if it["added"] >= cutoff),
        key=lambda it: (it["added"], it["id"]),
        reverse=True,
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": items},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"OK : {len(items)} éléments écrits dans {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
