"""Collecte des nouveautés PhilPapers en philosophie de l'esprit.

Sources (publiques, sans compte), catégorie Philosophy of Mind et sous-catégories :
  - liste « récents » : ?recent=1&sort=added           (≈ 3 derniers mois)
  - liste complète triée par entrée dans la catégorie : ?sort=added (remonte aussi loin qu'on veut ;
    contient aussi d'anciens textes nouvellement classés, qu'on écarte)
  Chaque page est lue en JSON (titres, auteurs, résumés, dates) et en BibTeX (type de publication).

Usage :
  python collector/collect.py                 # collecte quotidienne (≈ 2 dernières semaines)
  python collector/collect.py --backfill 365  # reconstitue l'historique sur N jours (une fois)

Sortie : docs/data/index.json + docs/data/items-AAAA-MM.json (un fichier par mois d'ajout).
"""

from __future__ import annotations

import argparse
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
PAGE = 500
HEADERS = {"User-Agent": "PhilMindDigest/0.2 (lecteur personnel de nouveautes)"}
KEEP_DAYS = 380
DELAY = 4  # secondes entre deux requêtes (politesse envers PhilPapers)
LANG_VERSION = 3  # à incrémenter quand la détection de langue change : tout l'historique sera recalculé

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"

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


def fetch(params: dict, fmt: str) -> requests.Response:
    last = None
    for attempt in range(4):
        try:
            r = requests.get(BASE, params={**params, "format": fmt}, headers=HEADERS, timeout=120)
            if r.status_code == 200 and "Cloudflare" not in r.text[:2000]:
                return r
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:  # réseau
            last = str(e)
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Échec de la requête {params} format={fmt}: {last}")


def fetch_page(params: dict) -> tuple[list[dict], dict[str, str]]:
    """Une page de la liste : entrées JSON + types BibTeX."""
    content = fetch(params, "json").json().get("content", [])
    time.sleep(DELAY)
    types = bib_types(fetch(params, "bib").text, [e["id"] for e in content])
    time.sleep(DELAY)
    return content, types


def bib_types(bib: str, ids: list[str]) -> dict[str, str]:
    """Associe chaque identifiant PhilPapers à son type BibTeX (clé de la forme Auteur2026-IDENT)."""
    idset = set(ids)
    out: dict[str, str] = {}
    for btype, key in re.findall(r"^@(\w+)\{([^,\s]+),", bib, flags=re.M):
        cands = [key] + [key[i + 1 :] for i, ch in enumerate(key) if ch == "-"]
        for c in cands:
            if c in idset:
                out[c] = btype.lower()
                break
    return out


def is_new_work(e: dict) -> bool:
    """Écarte les anciens textes simplement reclassés dans la catégorie."""
    d = (e.get("date") or "").strip().lower()
    if not d[:4].isdigit():  # manuscript, forthcoming, unknown…
        return True
    added_year = int((e.get("added") or "0000")[:4] or 0)
    return int(d[:4]) >= added_year - 1


LANG_FR_NAMES = {
    "en": "Anglais", "fr": "Français", "de": "Allemand", "es": "Espagnol", "it": "Italien",
    "pt": "Portugais", "nl": "Néerlandais", "ru": "Russe", "uk": "Ukrainien", "pl": "Polonais",
    "cs": "Tchèque", "tr": "Turc", "el": "Grec", "zh": "Chinois", "ja": "Japonais", "ko": "Coréen",
    "ar": "Arabe", "fa": "Persan", "he": "Hébreu", "sv": "Suédois", "da": "Danois", "nb": "Norvégien",
    "fi": "Finnois", "hu": "Hongrois", "ro": "Roumain", "ca": "Catalan", "hr": "Croate", "sr": "Serbe",
    "sl": "Slovène", "sk": "Slovaque", "bg": "Bulgare", "id": "Indonésien", "vi": "Vietnamien", "hi": "Hindi",
}

# Mots-outils : très fiables pour trancher anglais / français sur des titres courts.
# Seulement des mots propres à chaque langue (« la », « de », « que », « a »… existent aussi en espagnol/italien).
EN_WORDS = set("the of and in on an to for is are what why how with as from our its their by not or between".split())
FR_WORDS = set("le les des du et une est sont qui pour dans sur au aux ou pas ce cette ses leur leurs nous vers chez".split())
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
        pub_html = m.group(1) if m else ""
        pub = strip_tags(pub_html)
        abstract = " ".join(x for x in (e.get("excerpt1"), e.get("excerpt2")) if x).strip()
        abstract = clip(strip_tags(abstract))
        btype = types.get(e["id"], "misc")
        code, name = detect_lang(detector, title, abstract)
        items.append(
            {
                "id": e["id"],
                "title": title,
                "authors": e.get("authors") or [],
                "year": e.get("date", ""),
                "pub": pub,
                "venue": extract_venue(btype, pub_html, pub),
                "abstract": abstract,
                "added": e.get("added", "")[:10],
                "type": TYPE_MAP.get(btype, "autre"),
                "subtype": SUBTYPE_LABEL.get(btype, btype),
                "lang": code,
                "langName": name,
                "lv": LANG_VERSION,
                "url": f"https://philpapers.org/rec/{e['id']}",
            }
        )
    return items


ABSTRACT_MAX = 2500


def clip(s: str) -> str:
    if len(s) <= ABSTRACT_MAX:
        return s
    return s[:ABSTRACT_MAX].rsplit(" ", 1)[0] + " …"


def extract_venue(btype: str, pub_html: str, pub: str) -> str:
    """Revue (article), livre collectif (chapitre) ou éditeur (livre)."""
    m = re.search(r"<i class='pubName'>(.*?)</i>", pub_html, flags=re.S)
    if m:
        return strip_tags(m.group(1))
    m = re.search(r"<span class='pub_name'>(.*?)</span>", pub_html, flags=re.S)
    if m:
        return strip_tags(m.group(1))
    if btype == "book" and pub:
        # « Ville: Éditeur. » ou « Éditeur. »
        v = pub.rstrip(". ").split(":")[-1].strip()
        return v if 1 < len(v) < 120 else ""
    return ""


# ---------- Stockage par mois ----------

def load_all() -> dict[str, dict]:
    items: dict[str, dict] = {}
    for f in sorted(DATA.glob("items-*.json")):
        for it in json.loads(f.read_text(encoding="utf-8")).get("items", []):
            items[it["id"]] = it
    legacy = DATA / "items.json"  # ancien format (un seul fichier)
    if legacy.exists():
        for it in json.loads(legacy.read_text(encoding="utf-8")).get("items", []):
            items.setdefault(it["id"], it)
    return items


def save_all(items: dict[str, dict]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    months: dict[str, list[dict]] = {}
    for it in items.values():
        months.setdefault(it["added"][:7], []).append(it)
    for f in DATA.glob("items-*.json"):
        if f.stem[6:] not in months:
            f.unlink()
    index = []
    for m in sorted(months, reverse=True):
        lst = sorted(months[m], key=lambda it: (it["added"], it["id"]), reverse=True)
        body = json.dumps({"month": m, "items": lst}, ensure_ascii=False, separators=(",", ":"))
        path = DATA / f"items-{m}.json"
        if not path.exists() or path.read_text(encoding="utf-8") != body:
            path.write_text(body, encoding="utf-8")
        index.append({"month": m, "count": len(lst), "file": path.name, "last": lst[0]["added"]})
    (DATA / "index.json").write_text(
        json.dumps({"generated": now, "months": index}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    legacy = DATA / "items.json"
    if legacy.exists():
        legacy.unlink()


# ---------- Collecte ----------

def collect(days: int) -> list[tuple[list[dict], dict[str, str]]]:
    """Pages de la liste récente + de la liste complète jusqu'à `days` jours en arrière."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    pages = []
    print("Liste « récents »…")
    pages.append(fetch_page({"recent": "1", "sort": "added", "limit": str(PAGE), "start": "0"}))
    start = 0
    while True:
        print(f"Liste complète, à partir de {start}…", flush=True)
        content, types = fetch_page({"sort": "added", "limit": str(PAGE), "start": str(start)})
        pages.append((content, types))
        if not content:
            break
        oldest = min((e.get("pubAdded") or e.get("added") or "")[:10] for e in content)
        print(f"  … jusqu'au {oldest}")
        if oldest < cutoff or len(content) < PAGE - 5:
            break
        start += PAGE
    return pages


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", type=int, default=0, help="reconstituer N jours d'historique")
    args = ap.parse_args()
    days = args.backfill or 14

    pages = collect(days)
    detector = build_detector()
    items = load_all()
    added_cut = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    n_new = 0
    for content, types in pages:
        keep = {"content": [e for e in content if is_new_work(e) and (e.get("added") or "") >= added_cut]}
        for it in parse_items(keep, types, detector):
            n_new += it["id"] not in items
            old = items.get(it["id"])
            # On garde le type déjà connu si cette page n'a pas pu le déterminer.
            if old and it["subtype"] == SUBTYPE_LABEL["misc"] and old.get("subtype") != SUBTYPE_LABEL["misc"]:
                it.update(type=old["type"], subtype=old["subtype"])
            items[it["id"]] = it

    for it in items.values():
        if it.get("lv") != LANG_VERSION:
            it["lang"], it["langName"] = detect_lang(detector, it["title"], it.get("abstract", ""))
            it["lv"] = LANG_VERSION
        it.setdefault("venue", "")
        it["abstract"] = clip(it.get("abstract", ""))
    items = {k: v for k, v in items.items() if v["added"] >= added_cut}
    save_all(items)
    print(f"OK : {len(items)} éléments au total, {n_new} nouveaux.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
