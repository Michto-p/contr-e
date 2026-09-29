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

## systems/monsters.js
- Fait : sans joueurs, chaque zone tend vers un plafond qui dépend de sa distance au village (et du biome). Une zone au-delà de 70 déborde vers une voisine plus proche du village ; au plus une horde par jour part d'une zone saturée. Le combat fait reculer la pression (×1,5 à plusieurs) ; seul face à une zone au-delà de 80, on bat en retraite (pilier coopération).
- Problème repéré puis corrigé : la première version (croissance linéaire, débordement vers les 8 voisins) saturait toute la carte en 3 jours et noyait la chronique de hordes. Aujourd'hui, sans aucun joueur, la carte est envahie en 30 à 60 jours environ.
- Décision : on ne signale les débordements qu'à 3 zones du village ou moins ; plus loin, l'infestation est normale.

## systems/village.js
- Fait : les chaînes blé → pain et minerai/charbon → outils → (agriculteur, mineur). Un champ menacé et non gardé perd 20 à 50 % de sa part de récolte. La mine devient dangereuse au-delà de 70 de pression. Les quêtes (patrouille, escorte, réparation, coup de main) sont générées chaque matin et expirent au bout de 3 jours. Déclin après 3 jours de négligence (jamais sous le niveau 1) ; reprise en 1 jour d'aide pour un niveau déjà atteint, 2 pour un nouveau.
- Problème repéré puis corrigé : avec les premiers réglages, les stocks absorbaient tout et le village restait « rondement » même en perdant 40 % des récoltes. J'ai réduit les stocks de départ, rendu le pain périssable (30 au plus) et fait dépendre la satisfaction de la production réelle. Sans joueurs, les pénuries arrivent maintenant vers les jours 10 à 12.
- Décision : une pénurie n'est annoncée qu'au début et à la fin, pas chaque jour.

## systems/seasons.js
- Fait : un cycle de 28 jours dont le point de départ est tiré de la graine (chaque contrée a son calendrier). Chaque saison règle la croissance et l'agressivité des monstres. L'hiver ferme les hauteurs et les confins (dont parfois la mine), le printemps les rouvre. Une météo du jour apparaît dans le titre, et l'orage abîme davantage les structures exposées.
- Décision : la météo n'a qu'un seul effet mécanique (l'orage), pour rester simple et lisible.

## agents.js
- Fait : trois scénarios (`assidus` = 8 assidus ; `mixte` = 3 assidus, 3 occasionnels, 2 absents ; `absents` = 8 absents, présents aux jours 1 et 7). Chaque matin, les quêtes urgentes sont réparties, à deux si la zone est trop dangereuse pour un joueur seul. Les assidus sans quête chassent autour des champs, les occasionnels explorent (découverte des ressources exclusives, bois rapporté). Les trajets tracent des chemins, et chaque joueur a une maison protégée au village.
- Résultats (graine 42, 7 jours) : aucune perte de récolte avec des assidus, jusqu'à 7 pertes quand tout le monde est absent. Sur 30 jours, les métiers finissent aux niveaux 5/4/3/4 (assidus), 5/2/1/1 (mixte) et 3/1/1/1 (absents).
- Problème repéré puis corrigé : la nature ne voyait pas les nouveaux sentiers (les joueurs usent les chemins hors du système nature), donc l'état du chemin est désormais mémorisé dans la zone. La chronique élimine aussi les doublons (une même action racontée deux fois). Un nouveau niveau de métier demande 3 jours d'aide, contre 1 pour un niveau perdu.
