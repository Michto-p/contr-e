# Contrées vivantes — CLAUDE.md

Jeu coop 2D (style action-aventure SNES) : des petits mondes vivants entre amis (~20 joueurs par
« contrée »), chacun unique et incomplet, reliés par des voyages risqués. Le monde évolue même
quand personne n'est connecté. Au retour, le joueur lit une **chronique** de ce qui s'est passé.

## Phase actuelle : ÉTAPE 1 — simulation seule, sans graphisme

Objectif unique : prouver que la simulation produit des chroniques intéressantes.
**Pas de client, pas de réseau, pas de sprites, pas de Colyseus à cette étape.**

Critère de réussite : `npm run sim -- --days 7 --seed 42` affiche une chronique jour par jour
qu'un humain a envie de lire, avec des événements variés et des conséquences visibles.

## Mode autonome (lire en premier)

Le développeur lance la session puis s'absente. Travaille sans attendre de validation.

1. **Git d'abord** : si le dossier n'a pas de `.git`, lance `git init -b main`, configure un
   utilisateur local si nécessaire (`git config user.name "Claude Code"` et
   `git config user.email "claude@local"`), puis fais un premier commit « init: structure de départ ».
   Pas de remote, pas de GitHub, pas de `git push`.
2. **Petits pas** : une tâche = un commit. Ordre : world.js -> tick.js -> nature -> run-sim.js ->
   chronique -> monsters -> village -> seasons -> agents.
3. **Avant chaque commit** : `npm test` doit passer et `npm run sim -- --days 7 --seed 42` doit
   s'exécuter sans erreur. Sinon corrige avant de committer.
4. **Messages de commit en français**, préfixés : `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.
5. **Ne pose pas de questions** : face à une ambiguïté, choisis l'option la plus simple compatible
   avec ce fichier et note-la dans `JOURNAL.md`.
6. **JOURNAL.md** : après chaque commit, ajoute 2 ou 3 lignes (ce qui est fait, décision prise,
   problème repéré). Le développeur le lira au retour.
7. **Exemple de chronique** : à la fin, sauvegarde la sortie de
   `npm run sim -- --days 7 --seed 42` dans `CHRONIQUE-EXEMPLE.md` et committe-la.
8. **Condition d'arrêt** : quand les 4 systèmes, les agents et la chronique fonctionnent, arrête-toi.
   Ne commence pas l'étape 2.

Interdits en mode autonome : installer des dépendances npm, supprimer l'historique git
(`reset --hard`, `rebase`, `push --force`), modifier `.claude/settings.json`.

## Piliers (toute mécanique doit en servir au moins un)

1. Un monde qui vit sans les joueurs : règles simples qui tournent seules, pas de contenu scripté.
2. Simple à comprendre, exigeant à maîtriser.
3. La coopération est nécessaire.
4. Des revers, jamais de point de non-retour.
5. Chaque contrée est incomplète (ressources exclusives ailleurs).

## Stack

- Node.js 22 LTS, ES modules (`"type": "module"`), JavaScript pur, pas de TypeScript pour l'instant.
- Aucune dépendance runtime à l'étape 1. Tests avec `node:test`.
- État sauvegardé en JSON dans `data/` (SQLite viendra à l'étape 2).
- Plus tard : serveur Colyseus (1 room = 1 contrée), client HTML unique en Canvas 2D.

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
  chronicle/
    chronicle.js      transforme les events bruts en phrases lisibles, regroupées par jour
scripts/
  run-sim.js          CLI : --days, --seed, --ticks-per-day, --agents, --out
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

## Systèmes (4 max à l'étape 1)

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
npm run sim -- --days 7 --seed 42
npm run sim -- --days 30 --seed 42 --agents mixte --debug
npm test
```

## Ce qu'il NE faut PAS faire à l'étape 1

- Pas de rendu graphique, pas de serveur réseau, pas de base de données.
- Pas de nouveau système au-delà des 4 listés sans validation.
- Pas de sur-abstraction (ECS, plugins, injection de dépendances) : des fonctions et des objets simples.

## Étapes suivantes (pour mémoire, ne pas commencer)

2. Client minimal Canvas + Colyseus, déplacements multijoueur, simulation branchée sur le serveur.
3. Village jouable (3 métiers + quêtes).
4. Deuxième contrée + voyages.
5. Arène et mécaniques additionnelles.

## Déploiement

Étape 1 : tourne sur n'importe quel PC, aucun serveur nécessaire.
À partir de l'étape 2 : LXC Proxmox dédié, voir `deploy/PROXMOX-LXC.md`.
