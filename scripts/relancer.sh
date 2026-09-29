#!/usr/bin/env bash
# Met le jeu à jour et relance le serveur : récupère le dernier code, installe les dépendances
# si besoin, arrête l'ancien serveur (qui sauvegarde la contrée) et démarre le nouveau.
# Usage : npm run relancer
#         npm run relancer -- --nouvelle   (repart d'une contrée neuve ; l'ancienne est archivée dans data/)
set -u
cd "$(dirname "$0")/.."

echo "1/4 Récupération du dernier code…"
git pull --ff-only || echo "  (git pull impossible : on relance avec le code présent)"

echo "2/4 Dépendances…"
npm install --no-audit --no-fund --loglevel=error

echo "3/4 Arrêt de l'ancien serveur (la contrée est sauvegardée)…"
pkill -INT -f "node server/index.js" 2>/dev/null
for _ in $(seq 1 20); do
  pgrep -f "node server/index.js" > /dev/null || break
  sleep 0.5
done
pkill -KILL -f "node server/index.js" 2>/dev/null

if [ "${1:-}" = "--nouvelle" ] && [ -f data/contree.json ]; then
  archive="data/contree-$(date +%Y%m%d-%H%M%S).json"
  mv data/contree.json "$archive"
  echo "  Nouvelle contrée : l'ancienne est archivée dans $archive"
fi

echo "4/4 Démarrage du nouveau serveur…"
echo "Version : $(git log -1 --format='%h — %s')"
exec bash scripts/codespace.sh
