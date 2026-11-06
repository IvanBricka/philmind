# Solution de secours : lance la collecte depuis ce PC et publie le résultat sur GitHub.
# À utiliser seulement si la collecte automatique de GitHub est bloquée par PhilPapers.
# Planification : Planificateur de tâches > Créer une tâche de base > Quotidienne >
#   Programme : powershell.exe   Arguments : -ExecutionPolicy Bypass -File "C:\Users\ivanb\Documents\PhilPapers\collecte-locale.ps1"
# Un jour manqué n'est pas grave : chaque collecte récupère les ~500 derniers ajouts (plusieurs semaines).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = "utf-8"

if (-not (Test-Path ".venv")) {
    py -m venv .venv
    .\.venv\Scripts\python -m pip install -q -r collector\requirements.txt
}

git pull --quiet --rebase
.\.venv\Scripts\python collector\collect.py
git add docs/data/items.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "Nouveautés du $(Get-Date -Format yyyy-MM-dd) (collecte locale)"
    git push
}
