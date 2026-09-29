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

**Mettre le jeu à jour** (après de nouveaux changements sur la branche) : dans le terminal du
Codespace, tapez `npm run relancer`. La commande récupère le dernier code, arrête l'ancien serveur
(la contrée est sauvegardée) et démarre le nouveau. Pour repartir d'une contrée neuve (par exemple
pour profiter d'une carte plus grande), tapez `npm run relancer -- --nouvelle` : l'ancienne est
archivée dans `data/`, pas effacée. La version du jeu est affichée dans le panneau
Chronique (touche C) ; rechargez la page du jeu (Ctrl+Maj+R) après la relance.

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
| `TAILLE` | `16` | taille d'une nouvelle contrée, en zones de côté (une contrée sauvegardée garde la sienne) |
| `ABANDON_JOURS` | `30` | jours réels sans être joué au-delà desquels un personnage reste au village pour de bon |
| `RYTHME_VIE` | `1` | années de vie des habitants par jour de jeu (`0.25` = une saison par jour, générations plus longues) |

## Personnages

On entre avec son **nom de joueur** (pas de mot de passe), puis on choisit ou crée un **personnage** :
un prénom (libre dans la contrée), un métier et une couleur de tunique. Chaque joueur peut en avoir
**trois**. Le personnage qu'on ne joue pas **vit au village** comme un habitant : on le croise, on lui
parle, et s'il a un métier il y travaille, avec le savoir-faire rapporté de ses aventures (un vrai bonus
pour ce métier). Tant qu'il vous appartient, il ne vieillit pas. On le reprend quand on veut (bouton
👥 Personnages ou touche **P** en jeu). Mais un personnage **délaissé 30 jours** (réels) est perdu
pour son joueur : il reste au village pour de bon, vieillit, et vit sa vie comme les autres.

**Classe, métier et compétences.** Chaque personnage a une classe (guerrier, gardien, éclaireur,
herboriste) et un métier. La classe apporte 60 points de compétences, le métier 40 : 100 points
répartis d'office entre Force (dégâts), Endurance (vie), Agilité (vitesse), Survie (récupération hors
du village, soin du pain), Savoir-faire (le métier rapporte plus : bois par coupe, pain qui soigne,
bonus au village) et Flair (butin). On place ensuite **10 points libres**. Certaines paires classe +
métier vont bien ensemble et révèlent un **secret de classe** : des points en plus. À vous de les trouver.

**L'auberge et la maison.** Tout le monde commence à l'auberge du village (la grande bâtisse à
colombages). Plus tard, on bâtit sa maison sur un terrain libre (les enclos du village) : **E** devant
le terrain, avec 4 cuir et 4 minerai rapportés des combats et 10 bois de la réserve du village. On
y réapparaît désormais, et l'on peut **y entrer** (E devant la porte) : une pièce avec un lit (dormir),
le **coffre** qui garde vos affaires pour tous vos personnages, et un panier où adopter un
**compagnon** (un chien, qui ajoute du flair, ou un chat, de la survie). Il vous suit partout.
On peut **rendre visite** à un ami : E devant sa porte pour frapper ; s'il est chez lui, on entre
(le coffre, le lit et le panier restent les siens). Chez soi, **🛠 Aménager** (touche **H**) : changer le sol (plancher, dalles, tomettes) et la couleur
des murs, déplacer les meubles (on choisit, puis on clique où le poser) et fabriquer des décorations
(plante, étagère, lanterne, grand tapis, tableau, trophée avec une ressource rare). L'équipement, lui, reste propre à chaque personnage.

**Une famille.** Dès que le joueur a sa maison, ses personnages peuvent, quand ils vivent au village,
se mettre en couple avec un habitant et avoir des enfants, qui portent le nom du joueur et grandissent
au village (voir l'arbre des familles, touche G). L'écran de choix des personnages indique leur famille.

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
- **R** : manger un morceau de pain du village (+4 PV, et la faim s'apaise).
- **Faim et fatigue** (🍖 et 💤 sous les cœurs) montent en jouant, la fatigue aussi à l'effort. Au-delà
  de 70 : affamé, on ne reprend plus de forces tout seul ; fatigué, on marche moins vite et on frappe
  moins fort. On mange du pain (R) et on dort à l'auberge (E devant la porte). Jamais mortel. Pas de champs gardés, pas de pain.
- **F** : sac et forge. Les monstres lâchent minerai, cuir et parfois une ressource rare de la
  contrée ; au village, le forgeron en fait une meilleure épée, une armure, des bottes (chaque pièce
  lui coûte un outil). L'équipement est gardé d'une connexion à l'autre.
- **E** selon votre métier : l'agriculteur **récolte** dans les champs, le bûcheron-mineur **mine**
  les filons des collines et montagnes (et coupe plus de bois), l'éleveur **soigne et tond** les bêtes
  dans les prés (du cuir pour son sac), le boulanger **cuit le pain** et le forgeron **forge des outils**
  au village. Le rendement grandit avec le savoir-faire.
- **E** sur un gisement rare (le bandeau l'indique) : l'extraire, une fois la zone dégagée.
- **E** près d'un voyageur égaré (un « ? » au-dessus de la tête, un point clignotant sur la
  mini-carte, et la chronique dit où) : il vous suit. Menez-le jusqu'au village, où il s'installe
  avec son savoir-faire. Si vous tombez, il vous attend là où il est ; au bout de quelques jours
  sans secours, il reprend sa route.
- **E** près du piquet à fanion jaune d'une zone sauvage dégagée : dresser un **avant-poste** (4 bois, trois fois).
  Autour de sa tente, les monstres n'approchent pas et l'on reprend des forces comme au village ;
  la zone abrite moins de monstres et les habitants y travaillent plus loin. Il s'abîme sans entretien.
- **E** près d'un habitant : lui parler. Chacun a son nom, son âge, son métier, sa famille, son
  caractère et parfois un talent ; il parle de sa vie et de ce qui inquiète le village.
- Dans le sac (**F**), au village : **offrir** une ressource rare. Un forgeron savant peut en tirer
  un **plan** (une lame à 4 dégâts, un talisman +4 PV) que tout le monde pourra ensuite forger.
- **G** : l'arbre des familles du village, avec les disparus (en gris) et les conjoints (♥).
- **C** : chronique, quêtes du village, métiers, habitants et familles, joueurs en ligne.
- **P** : changer de personnage (celui qu'on quitte retourne au village).
- **M** : couper ou remettre le son (épée, coups, butin, cloche du matin, cor des hordes, pluie).
- Sur téléphone : maintenir le doigt dans une direction pour marcher, ⚔ frapper, ✋ agir,
  🌀 rouler, 🍞 manger, 🎒 sac.

Le paysage est dessiné à partir de la graine de la contrée : lisières naturelles entre les
biomes, collines et montagnes en terrasses, ruisseaux (qui se passent à gué), clairières. Le soir,
la nuit tombe : les fenêtres du village et les feux des avant-postes s'allument, les habitants
rentrent chez eux, chacun porte sa lanterne. De 21 h à 5 h, les monstres s'enhardissent : un de plus
par zone infestée, et ils vous repèrent de plus loin. Le village et les avant-postes restent sûrs. La météo du monde se voit : averses, orages, neige,
brume, vent. Les sentiers se voient aussi : herbe foulée quand on passe peu, chemin de terre quand
on passe souvent, qui s'efface si on le délaisse.

**Hordes** : quand une zone déborde, la simulation lance une horde. Si des joueurs sont connectés,
elle apparaît pour de bon (monstres cerclés de rouge, points rouges sur la mini-carte) et marche
sur le village. Repoussée à temps, à plusieurs et avec les gardes, sa zone recule nettement ;
sinon, elle pille une partie du pain en atteignant le village, puis se disperse.

**Le village s'agrandit.** Quand son cœur est plein (maisons d'habitants, ou terrains presque tous
pris par les joueurs), un pré voisin devient un **faubourg** : sûr comme le village, avec ses ruelles,
ses maisons et 6 nouveaux terrains à bâtir (4 faubourgs au plus).

**Les maisons abandonnées.** Quand trop de maisons restent vides, l'une est laissée à l'abandon ; la
maison d'un joueur qu'on n'a pas revu depuis longtemps aussi (même délai que pour les personnages).
Sans entretien, elle tombe en ruine puis devient un **repaire** : des bêtes en sortent, en plein
village. N'importe qui peut la **remettre en état** (E devant, 3 bois par coup de main) : elle est
réhabitée, ou le terrain est libéré. Le coffre d'un joueur parti l'attend s'il revient.

**La hiérarchie du village.** Chacun gagne de la **renommée** par ses hauts faits (inventions,
défrichages, défense, et pour les joueurs : quêtes, hordes repoussées, égarés ramenés…). Chaque jour,
l'adulte le plus respecté **prend la tête du village** (couronne de feuilles d'or ; un petit bonus pour
tous les métiers), le plus habile de chaque métier devient **maître d'atelier** (le métier produit
plus), et les jeunes qui travaillent auprès de lui sont ses **apprentis** (ils apprennent plus vite).
Un personnage de joueur peut prendre la tête du village. Les joueurs **votent** (panneau C) : chaque
joueur a une voix, qui compte autant que 15 points de prestige ; on compte chaque soir.

Le village vit sa vie : les habitants s'unissent, ont des enfants quand le pain ne manque pas,
les enfants apprennent de leurs parents, grands-parents et de l'enseignant, puis reprennent souvent
le métier familial avec parfois un talent (forestier qui replante et ouvre des passages, agronome
qui défriche un nouveau champ avec l'éleveur, inventeur…). Un jour de jeu vaut une année de leur vie
(réglable avec `RYTHME_VIE`). Selon leur caractère, certains sortent : les audacieux vont défendre
les champs menacés (et en reviennent parfois blessés), les curieux explorent et rapportent parfois
une ressource rare. Chaque matin, les autres partent travailler hors du village quand l'endroit
n'est pas trop dangereux : l'agriculteur aux champs (fourche), le bûcheron-mineur aux bois et à la
mine (hache), l'éleveur aux pâtures avec son troupeau. Leur présence ralentit les monstres et
entretient chemins et bâtisses ; là où ils travaillent, ils dressent eux-mêmes des avant-postes
avec le bois du village. On les voit partir le matin et rentrer le soir.

Les **gardes** (casque, lance et bouclier) sont des habitants comme les autres : souvent des jeunes
audacieux qui ont choisi ce métier à seize ans. Chaque matin, ils partent patrouiller là où l'on
travaille et devant les champs, et combattent pour de bon les monstres qu'ils croisent ; blessés,
ils rentrent se soigner quelques jours. Avec un garde, les habitants osent travailler plus loin.

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
