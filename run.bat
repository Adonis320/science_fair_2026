@echo off
chcp 65001 >nul
rem Lance la démo : serveur web local (sans internet) + navigateur.
cd /d "%~dp0viewer"
start "" "http://localhost:8000/index.html"
echo Démo lancée sur http://localhost:8000/index.html  (fermer cette fenêtre pour arrêter)
python -m http.server 8000 --bind 127.0.0.1
