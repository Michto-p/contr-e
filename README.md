# Contrées vivantes

Jeu coopératif 2D façon action-aventure 16 bits : un petit monde partagé entre amis, qui continue de
vivre quand personne n'est connecté. Au retour, chacun lit la **chronique** de ce qui s'est passé.

- **Étape 1 (terminée)** : la simulation seule, et une page pour la lire :
  <https://michto-p.github.io/contr-e/> (carte jour par jour, courbes, chronique).
- **Étape 2 (en cours)** : un serveur multijoueur (Colyseus) et un client Canvas où l'on se déplace
  à plusieurs dans la contrée. Les joueurs pèsent sur le monde comme les bots de l'étape 1.

## Jouer à plusieurs avec GitHub Codespaces

1. Sur la page du dépôt GitHub : bouton **Code** > onglet **Codespaces** > **Create codespace**
   (sur la branche voulue).
2. À l'ouverture, le Codespace installe tout, lance le serveur et rend le port 2567 public.
   Le terminal affiche l'**adresse du jeu à partager**, du type
   `https://<nom-du-codespace>-2567.app.github.dev`.
3. Ouvrez cette adresse, choisissez un nom, et envoyez-la à vos amis.

Si le port n'a pas pu être rendu public automatiquement : onglet **PORTS** > clic droit sur `2567` >
**Port Visibility** > **Public**.

Bon à savoir :

- Un Codespace s'arrête après 30 minutes sans activité dans l'éditeur, et l'offre gratuite donne un
  nombre d'heures limité chaque mois. Quand il redémarre, la contrée **rattrape le temps passé**
  (jusqu'à 7 jours) : le monde a continué de vivre, et chacun reçoit le résumé de son absence.
- La contrée est sauvegardée dans `data/contree.json` (chaque fin de journée de jeu et à l'arrêt).
- Pour un monde permanent, le serveur ira sur le LXC Proxmox : voir `deploy/PROXMOX-LXC.md`.

## Commandes

```
npm start                                   # serveur du jeu sur http://localhost:2567
npm test                                    # tous les tests (simulation, chronique, serveur)
npm run sim -- --days 7 --seed 42           # chronique d'une simulation, sans serveur
npm run sim -- --days 30 --seed 42 --agents mixte --debug
npm run sim -- --days 60 --seed 42 --vie 0.25       # habitants : une saison par jour
```

Réglages du serveur (variables d'environnement) :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `2567` | port HTTP et WebSocket |
| `HEURE_MS` | `30000` | durée réelle d'une heure de jeu (30 s : une journée en 12 minutes) |
| `BOTS` | `mixte` | joueurs simulés : `mixte`, `assidus`, `absents` ou `aucun` |
| `GRAINE` | `42` | graine de la contrée (utilisée seulement à la création) |
| `FICHIER` | `data/contree.json` | sauvegarde |
| `RATTRAPAGE_JOURS` | `7` | temps maximal rattrapé au redémarrage |
| `RYTHME_VIE` | `1` | années de vie des habitants par jour de jeu (`0.25` = une saison par jour, générations plus longues) |

## Commandes du jeu

- Flèches, ou **Z Q S D** (AZERTY) / **W A S D** (QWERTY) : se déplacer.
- **Espace** : combattre, dans la direction du regard. Chaque monstre vaincu fait reculer la
  pression de sa zone. Plus une zone est infestée, plus ses monstres sont nombreux et coriaces
  (gluants, rôdeurs, brutes, et des cracheurs qui tirent de loin dans les marais et les
  collines) : à plusieurs, c'est bien plus facile.
- **E** : agir selon l'endroit (le bandeau indique quoi) : couper du bois en forêt, réparer une
  structure abîmée (2 bois), bâtir une tour de guet demandée par le village (3 bois), donner un
  coup de main au village.
- **Maj** : roulade. On file quelques pas et les coups (et les crachats) ne portent pas.
- **R** : manger un morceau de pain du village (+4 PV). Pas de champs gardés, pas de pain.
- **F** : sac et forge. Les monstres lâchent minerai, cuir et parfois une ressource rare de la
  contrée ; au village, le forgeron en fait une meilleure épée, une armure, des bottes (chaque pièce
  lui coûte un outil). L'équipement est gardé d'une connexion à l'autre.
- **E** sur un gisement rare (le bandeau l'indique) : l'extraire, une fois la zone dégagée.
- **E** près d'un habitant : lui parler. Chacun a son nom, son âge, son métier, sa famille, son
  caractère et parfois un talent ; il parle de sa vie et de ce qui inquiète le village.
- Dans le sac (**F**), au village : **offrir** une ressource rare. Un forgeron savant peut en tirer
  un **plan** (une lame à 4 dégâts, un talisman +4 PV) que tout le monde pourra ensuite forger.
- **G** : l'arbre des familles du village, avec les disparus (en gris) et les conjoints (♥).
- **C** : chronique, quêtes du village, métiers, habitants et familles, joueurs en ligne.
- Sur téléphone : maintenir le doigt dans une direction pour marcher, ⚔ frapper, ✋ agir,
  🌀 rouler, 🍞 manger, 🎒 sac.

Le village vit sa vie : les habitants s'unissent, ont des enfants quand le pain ne manque pas,
les enfants apprennent de leurs parents, grands-parents et de l'enseignant, puis reprennent souvent
le métier familial avec parfois un talent (forestier qui replante et ouvre des passages, agronome
qui défriche un nouveau champ avec l'éleveur, inventeur…). Un jour de jeu vaut une année de leur vie
(réglable avec `RYTHME_VIE`). Selon leur caractère, certains sortent : les audacieux vont défendre
les champs menacés (et en reviennent parfois blessés), les curieux explorent et rapportent parfois
une ressource rare. On les voit partir le matin et rentrer le soir.

Les quêtes du village (fanions jaunes sur la carte) se valident en jouant : une patrouille ou une
escorte en vainquant 4 monstres autour du champ ou de la mine, une réparation ou une tour en y
travaillant avec **E**. À bout de forces, on se relève au village sans rien perdre.

## Organisation du code

```
src/sim/        simulation (monde, systèmes, bots) — sans dépendance
src/chronicle/  events -> phrases de la chronique
server/         serveur Colyseus : une room = une contrée, sauvegarde, rattrapage
client/         page du jeu (Canvas 2D), servie par le serveur
shared/         constantes communes au serveur et au client
web/, index.html  page de visualisation de la simulation (GitHub Pages)
```
