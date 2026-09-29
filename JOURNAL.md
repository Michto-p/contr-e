# Journal de bord — étape 1

## world.js
- Fait : `createWorld(seed)` génère une grille 12×12 de zones (biomes par cellules de Voronoï), un village central sûr, 4 champs en bordure, des chemins de départ, 3 à 5 structures exposées et la signature (biome dominant + 2–3 ressources exclusives).
- Décision : chaque zone porte un libellé lisible (« les marais de l'Est ») calculé depuis sa direction par rapport au village, pour que la chronique parle de lieux et non de coordonnées. Le stock d'un métier est un objet `{ bien: quantité }` (le bûcheron-mineur garde minerai, charbon et bois).
- Décision Git : le développeur a demandé de travailler avec GitHub, donc je pousse sur la branche `claude/nifty-hopper-l2gdiv` (jamais de force), contrairement au « pas de push » de CLAUDE.md.

## tick.js
- Fait : `tick(state, rng)` clone l'état (`structuredClone`), applique les systèmes dans l'ordre, avance d'une heure et remet à zéro les compteurs quotidiens des zones en fin de journée. `simulate()` enchaîne les ticks et accepte un hook `beforeTick` pour les agents.
- Décision : le contexte `ctx` fournit `ctx.event(type, zone, data)` pour que tous les events aient le même format sans module supplémentaire.

## systems/nature.js
- Fait : la végétation repousse vers le maximum du biome ; sans passage, l'usure d'un chemin baisse (plus vite en végétation dense) jusqu'à disparaître ; les structures exposées perdent 1 à 3 points par jour (plus quand les monstres rôdent). Les maisons du village sont protégées.
- Décision : la nature tourne une fois par jour (dernier tick) et n'émet un event que lors d'un changement de palier (chemin → trace → rien ; abîmée → menace → ruine), pour éviter le bruit. Chaque perte porte un champ `fix`.

## scripts/run-sim.js
- Fait : CLI avec `--days`, `--seed`, `--ticks-per-day`, `--agents`, `--out` (sauvegarde JSON de l'état et des events), `--debug`, `--since`. Pour l'instant, la sortie liste les events bruts par jour.
- Problème repéré : les chemins des champs s'effacent aussi, alors que les paysans y passent tous les jours. Ce sera corrigé dans le système village.

## chronicle/chronicle.js
- Fait : chaque type d'event a un rendu (priorité + phrase). Les events semblables d'un même jour sont regroupés (« les champs du Nord, de l'Est et du Sud »), triés par importance, 8 lignes au plus. `--debug` ajoute les chiffres entre crochets, `--since` produit un résumé « pendant votre absence ».
- Décision : l'en-tête (nom de la contrée, signature) vient d'un event `contree` émis au tout premier tick, pour que la chronique ne lise que des events.
