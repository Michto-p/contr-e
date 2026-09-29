#!/usr/bin/env bash
# Lance le serveur du jeu dans un Codespace et rend le port public pour que les amis puissent entrer.
# Exécuté automatiquement à l'ouverture du Codespace (voir .devcontainer/devcontainer.json).
set -u
PORT="${PORT:-2567}"
LOG=/tmp/contree.log

if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
  echo "Le serveur du jeu tourne déjà."
else
  echo "Démarrage du serveur du jeu…"
  nohup npm start > "$LOG" 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf "http://localhost:$PORT/" > /dev/null 2>&1 && break
    sleep 1
  done
fi

if [ -n "${CODESPACE_NAME:-}" ]; then
  if gh codespace ports visibility "$PORT:public" -c "$CODESPACE_NAME" > /dev/null 2>&1; then
    echo "Port $PORT rendu public."
  else
    echo "Impossible de rendre le port public automatiquement :"
    echo "  onglet PORTS > clic droit sur $PORT > Port Visibility > Public."
  fi
  echo
  echo "Adresse du jeu à partager : https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  echo "Adresse du jeu : http://localhost:$PORT"
fi
echo
echo "Journal du serveur (Ctrl+C ferme l'affichage, pas le serveur) :"
touch "$LOG"
tail -n 20 -f "$LOG"
