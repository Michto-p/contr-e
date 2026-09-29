# Contrées vivantes — CLAUDE.md

Jeu coop 2D (style action-aventure SNES) : des petits mondes vivants entre amis (~20 joueurs par
« contrée »), chacun unique et incomplet, reliés par des voyages risqués. Le monde évolue même
quand personne n'est connecté. Au retour, le joueur lit une **chronique** de ce qui s'est passé.

## Phase actuelle : ÉTAPE 2 — client Canvas + Colyseus, déplacements multijoueur

L'étape 1 (simulation seule) est terminée : `npm run sim -- --days 7 --seed 42` produit la chronique
(exemple dans `CHRONIQUE-EXEMPLE.md`, visualisation sur GitHub Pages via `index.html` + `web/`).

Objectif de l'étape 2 : un serveur Colyseus (1 room = 1 contrée) où la simulation tourne en continu,
et un client HTML unique en Canvas 2D où plusieurs joueurs se déplacent et combattent ; leur présence
et leurs combats pèsent sur la simulation comme ceux des bots. Test à plusieurs via GitHub Codespaces.

Critère de réussite : deux navigateurs se voient bouger dans la même contrée, le monde continue
d'avancer sans eux (et rattrape le temps serveur éteint), et au retour chacun lit ce qu'il a manqué.

## Façon de travailler

1. **Git** : le dépôt est sur GitHub. Développer sur la branche de travail désignée, pousser avec
   `git push -u origin <branche>`. Jamais de `reset --hard`, `rebase` ou `push --force`.
2. **Petits pas** : une tâche = un commit.
3. **Avant chaque commit** : `npm test` doit passer et `npm run sim -- --days 7 --seed 42` doit
   s'exécuter sans erreur. Sinon corrige avant de committer.
4. **Messages de commit en français**, préfixés : `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.
5. **Face à une ambiguïté** : choisis l'option la plus simple compatible avec ce fichier et note-la
   dans `JOURNAL.md`.
6. **JOURNAL.md** : après chaque commit, ajoute 2 ou 3 lignes (ce qui est fait, décision prise,
   problème repéré).
7. **CHRONIQUE-EXEMPLE.md** : à régénérer quand la sortie de `npm run sim -- --days 7 --seed 42` change.

Dépendances autorisées : `@colyseus/core`, `@colyseus/ws-transport`, `@colyseus/schema`,
`@colyseus/sdk`, `express`. Toute autre dépendance demande une validation du développeur.
Ne pas modifier `.claude/settings.json`.

## Piliers (toute mécanique doit en servir au moins un)

1. Un monde qui vit sans les joueurs : règles simples qui tournent seules, pas de contenu scripté.
2. Simple à comprendre, exigeant à maîtriser.
3. La coopération est nécessaire.
4. Des revers, jamais de point de non-retour.
5. Chaque contrée est incomplète (ressources exclusives ailleurs).

## Stack

- Node.js 22 LTS, ES modules (`"type": "module"`), JavaScript pur, pas de TypeScript pour l'instant.
- `src/` (simulation, chronique) reste sans aucune dépendance. Tests avec `node:test`.
- Serveur : Colyseus 0.18 (1 room = 1 contrée), qui sert aussi le client sur le même port.
- Client : une page HTML en Canvas 2D (`client/`), sans framework ni sprites (formes dessinées).
- État sauvegardé en JSON dans `data/` (SQLite plus tard, quand ce sera utile).
- Test à plusieurs : GitHub Codespaces (`.devcontainer/`, port 2567 public). Monde permanent : LXC Proxmox.

## Architecture de la simulation

```
src/
  sim/
    rng.js            PRNG déterministe à graine (mulberry32). JAMAIS Math.random().
    world.js          createWorld(seed) : génère la contrée (grille de zones + village)
    tick.js           tick(state, rng) -> { state, events } : applique les systèmes dans l'ordre
    agents.js         joueurs simulés (bots) qui agissent entre les ticks
    systems/
      nature.js       végétation, usure des chemins, dégradation des structures
      monsters.js     pression des monstres par zone, expansion/recul
      village.js      métiers interconnectés, niveaux, stocks, quêtes
      seasons.js      cycle des saisons, effets globaux
      population.js   habitants, familles, naissances, héritage des savoirs, talents (validé par le développeur)
  chronicle/
    chronicle.js      transforme les events bruts en phrases lisibles, regroupées par jour
scripts/
  run-sim.js          CLI : --days, --seed, --ticks-per-day, --agents, --out
  codespace.sh        démarre le serveur dans un Codespace et rend le port public
server/
  index.js            createGameServer() : Colyseus + fichiers du client ; `npm start`
  contree-room.js     la room : horloge du monde, joueurs réels -> simulation, chronique diffusée
  gameplay.js         temps réel : monstres, points de vie, touche E (bois, réparer, bâtir, aider), quêtes jouables
  pnj.js              habitants sur la carte : gardes en patrouille qui combattent, voyageur égaré à ramener
  personnages.js      joueurs et personnages (3 par joueur) : au village quand on ne les joue pas, abandon
  maisons.js          l'auberge (où l'on commence) et les maisons des joueurs, avec leur coffre
  persistence.js      ouverture / sauvegarde JSON, rattrapage du temps serveur éteint
  schema.js           état synchronisé (joueurs, zones, métiers, quêtes, horloge)
client/               index.html, game.js (réseau, entrées, interface), render.js (dessin),
                      terrain.js (paysage procédural), ciel.js (nuit, lumières, météo), ambiance.js
shared/monde.js       géométrie commune serveur/client (tuiles par zone, vitesse)
shared/genealogie.js  arbre des familles (jeu et page de simulation)
test/
```

### Règles d'implémentation

- **Déterminisme** : même graine + mêmes paramètres = même résultat. Tout aléatoire passe par `rng`.
- **Systèmes = fonctions pures** : `(state, rng, ctx) -> events[]` qui mutent une copie de l'état.
  Pas d'I/O dans `src/sim/`.
- **Events** : objets `{ day, tick, type, zone?, data }`. La chronique ne lit QUE les events.
- **Valeurs bornées** : toutes les jauges en entiers 0–100, clampées.
- Tick par défaut : 1 tick = 1 h de jeu, 24 ticks par jour de simulation.

## Modèle de monde (étape 1)

- Grille de **zones** (ex. 12 × 12), pas de tuiles. Chaque zone :
  `biome, vegetation, monsterPressure, pathWear, structures[], resources{}`.
- Une zone centrale = **village** (zone sûre, monsterPressure bloquée à 0).
- Signature de contrée tirée de la graine : biome dominant + 2 ou 3 ressources exclusives.

## Systèmes (4 à l'étape 1, + population validée à l'étape 2)

- **Nature** : la végétation repousse ; un chemin non emprunté perd de l'usure puis disparaît ;
  une structure hors village sans entretien se dégrade.
- **Monstres** : la pression monte dans les zones sans présence de joueurs, déborde sur les zones
  voisines au-delà d'un seuil, recule quand des joueurs y combattent.
- **Village** : métiers `agriculteur, boulanger, forgeron, bucheron_mineur`.
  Chaque métier : `level (1–5), stock, needs, satisfaction`.
  Chaîne : agriculteur -> blé -> boulanger -> pain ; mineur -> minerai/charbon -> forgeron -> outils ;
  outils -> agriculteur et mineur. Les champs sont en bordure : si la pression des monstres voisine
  est haute et que personne ne protège, une PARTIE de la récolte est perdue.
- **Saisons** : cycle de 28 jours (7 par saison). L'hiver réduit la croissance et ferme certaines zones.
- **Population** (validée par le développeur) : des habitants nommés (âge, métier, compétences,
  deux traits de caractère). Un jour de jeu = une année de vie (réglable : `--vie`, `RYTHME_VIE`). Couples, naissances si le pain le
  permet, enfants qui apprennent de leurs parents, grands-parents et de l'enseignant, métier choisi
  à 16 ans (souvent celui de la famille), talents (forestier, agronome, inventeur…) qui agissent sur
  le monde : replanter, ouvrir des passages, défricher un champ avec l'éleveur, inventer des plans
  avec les ressources rares rapportées par les joueurs. Le jour, les adultes travaillent hors du village
  (champs, bois, mine, pâtures) si la zone n'est pas trop dangereuse, et y dressent des avant-postes ; les
  gardes patrouillent devant les champs et escortent ceux qui travaillent. Des voyageurs s'égarent au loin :
  ramenés au village (par un joueur ou un habitant curieux), ils s'y installent ; sinon ils repartent.
  Les personnages des joueurs sont aussi des habitants : au village quand on ne les joue pas (ils y
  travaillent avec un bonus), sans vieillir tant qu'ils appartiennent à un joueur ; quand leur joueur a une
  maison, ils peuvent fonder une famille (enfants au nom du joueur). La production des métiers dépend des
  habitants qui les exercent ; on mange un pain pour deux habitants. Le village ne se vide jamais
  (des familles arrivent). Les plans portent le nom de leur contrée : ils pourront voyager (étape 4).

## Règles anti-punition (non négociables)

- **Plancher** : un métier ne descend jamais sous le niveau 1. Le village ne disparaît jamais.
- **Déclin lent, reprise rapide** : perdre un niveau demande plusieurs jours de négligence ;
  le regagner demande 1 à 2 jours d'activité.
- **Pertes partielles** : une récolte négligée perd 20 à 50 %, jamais 100 %.
- La maison d'un joueur au village est protégée. Ce qui est construit dehors est exposé.
- Chaque perte génère un event qui dit comment la réparer (utilisé par la chronique).

## Joueurs simulés (agents)

Pas de vrais joueurs à l'étape 1 : des bots avec des profils, pour tester l'équilibre.
- `assidu` : connecté presque tous les jours, fait les quêtes du village.
- `occasionnel` : 2–3 connexions par semaine, explore.
- `absent` : se connecte au jour 1 puis revient au jour 7.
Scénarios à tester : tous assidus / mixte / tout le monde absent 5 jours.

## Chronique

- Regroupée par jour, 3 à 8 lignes max, les événements les plus importants d'abord.
- Ton sobre et concret : « Les nuisibles ont ravagé un tiers des champs de l'Est. Le boulanger
  manque de blé. » Pas de chiffres bruts dans le texte joueur (mode `--debug` pour les chiffres).
- Vue « retour de joueur » : `--since <jour>` résume ce qu'un joueur absent a manqué.

## Commandes

```
npm start                                   # serveur du jeu (PORT, HEURE_MS, BOTS, GRAINE, FICHIER, RYTHME_VIE, TAILLE, ABANDON_JOURS)
npm run sim -- --days 7 --seed 42
npm run sim -- --days 30 --seed 42 --agents mixte --debug
npm test
```

## Ce qu'il NE faut PAS faire à l'étape 2

- Pas de nouveau système de simulation au-delà des 5 existants sans validation.
- Pas de sur-abstraction (ECS, plugins, injection de dépendances) : des fonctions et des objets simples.
- Le serveur fait autorité : le client prédit son propre déplacement mais ne décide de rien.
- Pas de base de données ni de comptes pour l'instant (le nom du joueur suffit).

## Étapes suivantes (pour mémoire, ne pas commencer)

3. Village jouable (3 métiers + quêtes).
4. Deuxième contrée + voyages.
5. Arène et mécaniques additionnelles.

## Déploiement

Simulation (étape 1) : tourne sur n'importe quel PC, et la page de visualisation sur GitHub Pages.
Jeu (étape 2) : essais à plusieurs dans GitHub Codespaces (voir `README.md`) ; monde permanent sur un
LXC Proxmox dédié, voir `deploy/PROXMOX-LXC.md`.
