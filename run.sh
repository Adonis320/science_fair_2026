#!/usr/bin/env bash
# Lance la démo : serveur web local (sans internet) + navigateur.
cd "$(dirname "$0")/viewer" || exit 1
PORT=8000
URL="http://localhost:$PORT/index.html"
python3 -m http.server "$PORT" --bind 127.0.0.1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
if command -v xdg-open >/dev/null; then xdg-open "$URL"; elif command -v open >/dev/null; then open "$URL"; fi
echo "Démo lancée sur $URL  (Ctrl+C pour arrêter)"
wait $SERVER
