# Nouveautés — Philosophie de l'esprit

Application (PWA) qui affiche chaque jour les nouveautés PhilPapers de la catégorie
**Philosophy of Mind** (sous-catégories comprises), avec :

- trois onglets de langue : **Français / Anglais / Autres langues** ;
- un filtre de type : **Articles / Livres / Autres** (chapitres, thèses, manuscrits, prépublications…) ;
- des filtres **Auteur** et **Publication** (revue, livre collectif ou éditeur), avec suggestions ;
  un clic sur un auteur ou une revue dans une fiche applique le filtre ;
- un historique d'**un an** (chargé mois par mois, seulement quand on en a besoin) ;
- des marques **lu** et **à lire plus tard**, synchronisées entre le PC et le téléphone.

## Fonctionnement

| Élément | Rôle |
|---|---|
| `collector/collect.py` | Récupère les ajouts récents de la catégorie (JSON + BibTeX publics de PhilPapers), écarte les anciens textes simplement reclassés, détecte la langue, écrit `docs/data/index.json` et un fichier `items-AAAA-MM.json` par mois (≈ 380 jours). `--backfill 365` reconstitue toute l'année. |
| `.github/workflows/collect.yml` | Lance la collecte chaque matin sur GitHub et publie le résultat. |
| `docs/` | L'application, servie par GitHub Pages. |
| Dépôt privé `philmind-sync` | Contient `state.json` : vos marques lu / à lire. |
| `collecte-locale.ps1` | Secours : collecte depuis le PC si GitHub est bloqué par PhilPapers. |

## Mise en place (une seule fois)

1. **Dépôt de l'appli** : créer sur GitHub un dépôt public (ex. `philmind`) et y pousser ce dossier.
2. **GitHub Pages** : *Settings → Pages → Build and deployment → Deploy from a branch*, branche `main`, dossier `/docs`.
   L'appli sera à l'adresse `https://<identifiant>.github.io/philmind/`.
3. **Collecte** : onglet *Actions* → *Collecte quotidienne PhilPapers* → *Run workflow* pour un premier essai.
4. **Synchronisation** :
   - créer un second dépôt, **privé**, nommé `philmind-sync` (vide, case « Add a README » cochée) ;
   - créer un jeton : *Settings (du compte) → Developer settings → Personal access tokens → Fine-grained tokens* :
     *Repository access* = uniquement `philmind-sync`, *Permissions → Contents* = **Read and write** ;
   - dans l'appli, roue dentée → saisir identifiant, `philmind-sync`, jeton. Même chose sur le téléphone.
5. **Installer** :
   - **Windows** (Edge ou Chrome) : ouvrir l'adresse → icône « Installer l'application » dans la barre d'adresse.
   - **Android** (Chrome) : ouvrir l'adresse → menu ⋮ → *Ajouter à l'écran d'accueil* / *Installer l'application*.

## Développement local

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r collector\requirements.txt
.venv\Scripts\python collector\test_lang.py   # tests de détection de langue
.venv\Scripts\python collector\collect.py     # met à jour docs/data/items.json
py -m http.server 8765 --directory docs       # puis http://localhost:8765
```

## Limites connues

- PhilPapers ne fournit pas la langue : elle est détectée automatiquement (titre d'abord, résumé ensuite).
  Les titres très courts sans résumé peuvent être mal classés ; ajouter le cas dans `collector/test_lang.py` puis corriger.
- Les marques « lu » sont stockées dans un dépôt **privé** ; la liste des nouveautés, elle, est publique (comme sur PhilPapers).
