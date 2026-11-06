"""Test rapide de la détection de langue : python collector/test_lang.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import collect as c  # noqa: E402

CASES = {
    "Précis of Empathic Reason.": "en",
    "Our Teleological Selves.": "en",
    "Mind and World.": "en",
    "On Reincarnation. Part I: Madhyamaka – Prasangika.": "en",
    "Filsafat dan Sains Kesadaran.": "id",
    "Verstehen, worauf es (nicht) ankommt. Das strukturelle Relevanzproblem": "de",
    "Consciousness.": "en",
    "Intentionality.": "en",
    "La conscience et le corps.": "fr",
    "Qu'est-ce que l'intentionnalité ?": "fr",
    "Le problème difficile.": "fr",
    "Phénoménologie de la perception.": "fr",
    "Perception et action.": "fr",
    "L’esprit incarné.": "fr",
    "Müzakere.": "tr",
    "Conciencia e inteligencia artificial.": "es",
    "La conciencia de la mente.": "es",
    "Habitar lo que cambia.": "es",
    "Le réel du sujet – Désir, inconscient et subjectivité différentielle.": "fr",
    "La Cosmologie de l'esprit d'Evald Ilyenkov et la philosophie de la réalité": "fr",
    "Die Grenzen des Bewusstseins.": "de",
    "Il problema della coscienza.": "it",
}

det = c.build_detector()
fails = [(t, e, c.detect_lang(det, t, "")[0]) for t, e in CASES.items()]
fails = [f for f in fails if f[1] != f[2]]
for t, e, g in fails:
    print(f"ÉCHEC: {t!r} attendu {e}, obtenu {g}")
print(f"{len(CASES) - len(fails)}/{len(CASES)} OK")
sys.exit(1 if fails else 0)
