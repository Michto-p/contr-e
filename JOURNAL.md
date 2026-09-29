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

## --since (vue « retour de joueur »)
- Fait : dans le résumé « pendant votre absence », l'état du monde (saisons, récoltes, mine, monstres) passe avant les exploits des autres joueurs.

## GitHub Pages
- Fait : `index.html` (à la racine) fait tourner la simulation directement dans le navigateur (le code de `src/` n'a aucune dépendance) avec les réglages graine, jours, scénario, `--since` et chiffres. Les paramètres sont repris dans l'URL, ce qui permet de partager une chronique. Le workflow `.github/workflows/tests.yml` lance `npm test` et la sim à chaque push.
- Décision : ce n'est pas un client de jeu (pas de rendu graphique, pas de réseau), juste une page pour lire la chronique ; elle reste donc dans le périmètre de l'étape 1. Elle a été demandée par le développeur.
- Constat : Pages était déjà activé en mode « Deploy from a branch » sur cette branche. La page est donc à la racine (avec `.nojekyll` pour que tout soit servi tel quel), et il n'y a pas de job de déploiement dans le workflow.

## Bilan de l'étape 1
- Les 4 systèmes (nature, monstres, village, saisons), les agents et la chronique fonctionnent. `CHRONIQUE-EXEMPLE.md` contient la sortie de `npm run sim -- --days 7 --seed 42`. Arrêt ici, comme demandé : l'étape 2 n'est pas commencée.
- Pistes repérées pour la suite : les lignes « chemin qui s'efface » reviennent souvent et pourraient être regroupées sur plusieurs jours ; sur 30 jours, le scénario mixte laisse le forgeron et le mineur au niveau 1 (peut-être trop dur, à valider en jouant) ; les occasionnels battent souvent en retraite seuls (voulu : pilier coopération).

## Visuel sur la page (demande du développeur)
- Fait : la page affiche maintenant une vue du jour avec un curseur, des boutons précédent/suivant et une lecture automatique. On y trouve la carte 12 × 12 (calques monstres, chemins et terrain ; structures colorées selon leur état ; joueurs présents ; zones fermées hachurées), le village (niveaux, satisfaction, stocks et variation du jour) et les lignes de chronique du jour. Deux courbes suivent la pression des monstres par distance au village et la satisfaction des métiers : un clic sur une courbe ou sur un titre de la chronique affiche ce jour. Un tableau « données jour par jour » complète l'ensemble, et l'URL garde le jour et le calque.
- Décision : `simulate()` accepte un crochet `onDayEnd(state, day)` pour capturer l'état de chaque fin de journée, sans rien changer au résultat (test à l'appui, `CHRONIQUE-EXEMPLE.md` identique). Le code de la page est dans `web/` ; la simulation reste dans `src/` sans aucune dépendance au navigateur.
- Décision couleurs : le terrain est donné par des glyphes (♣ ≈ ▲ ∩ ·) et non par cinq couleurs, car une carte à cinq teintes ne passe pas le test daltonisme. La pression des monstres et l'usure des chemins utilisent chacune une rampe d'une seule teinte, et les palettes ont été vérifiées avec un validateur (clair et sombre). Ce n'est pas un client de jeu : il n'y a ni sprites ni réseau, cela reste un outil pour lire la simulation.

## Biomes : plus de plaines (retour du développeur)
- Problème : le marais paraissait partout. Sur 500 graines, les cinq biomes étaient en fait à égalité, mais les graines les plus utilisées (1, 2, 3, 42) tombaient sur le marais, et le biome dominant couvrait parfois 90 % de la carte.
- Fait : les biomes sont tirés avec des poids (plaine 34, forêt 26, collines 18, marais 12, hauteurs 10) ; le village est toujours dans une plaine ; le marais et les hauteurs sont repoussés à au moins 3 zones du centre ; le biome dominant pèse moins lourd. Résultat sur 500 graines : 37 % de plaine, 11 % de marais. La signature annonce désormais le biome réellement majoritaire.

## Équilibrage : quêtes par urgence
- Problème : en mixte sur 30 jours, le forgeron et le bûcheron-mineur tombaient au niveau 1. Les joueurs traitaient les quêtes dans un ordre fixe (patrouilles d'abord), et les 4 places du tableau étaient prises par les patrouilles, si bien que l'escorte de la mine n'apparaissait jamais.
- Fait : chaque matin, le tableau des quêtes est reconstruit d'après les besoins du moment, trié par urgence (menace sur le champ, danger à la mine + 15, état de la structure, satisfaction du métier). Les joueurs choisissent dans le même ordre. En mixte sur 30 jours, aucun métier ne perd plus de niveau (finale 5/2/2/2), au prix d'environ 30 pertes de récolte (les champs sont un peu moins gardés).
- Fait : avec plus de plaines autour du village, les monstres approchaient trop lentement (quasiment aucune conséquence quand tout le monde est absent 7 jours). Croissance portée à 30 % de l'écart au plafond et bonus plaine ramené à -2 : sur 7 jours, 0 perte avec des assidus, 5 à 12 quand tout le monde est absent.

## Chronique : moins de refrains
- Fait : une nouvelle déjà racontée la veille (monstres qui s'étendent, chemins qui disparaissent, récoltes pillées, quêtes affichées) est reformulée (« gagnent encore du terrain », « s'acharnent », « à son tour ») et descend dans l'ordre d'importance. Les combats du jour sont regroupés en une ligne, les patrouilles demandées aussi. Les traces lointaines d'explorateurs qui s'effacent ne sont plus racontées (visibles avec `--debug`).
- Corrigé : « les chemins des marais…, les prés… » devient « des marais…, des prés… » (`dePlaces`). La page utilise la même fonction `dayLines` que la CLI. `CHRONIQUE-EXEMPLE.md` a été régénéré (nouvelle carte).
- Complément : la première zone autour du village est toujours de la plaine, et il n'y a ni marais ni hauteurs à 2 zones ou moins du village (les cellules de Voronoï débordaient vers le centre). Le test de dégradation des structures ne dépend plus du hasard de la graine.

## Tours de guet bâties par les joueurs, hordes qui saccagent
- Fait : quand un champ est menacé et qu'il y a au moins 15 bois en réserve, le village demande des bâtisseurs pour une tour de guet sur la terre sauvage d'où vient la menace. Il faut être deux pour lancer le chantier (pilier coopération). Chaque heure de travail consomme du bois ; la tour est debout à 75, et un chantier commencé passe avant tout nouveau. Une tour intacte divise par deux la montée des monstres dans sa zone. Comme toute construction extérieure, elle s'use, se répare, et peut être saccagée par une horde (event avec la façon de réparer).
- Problème repéré puis corrigé : quand le premier bâtisseur terminait la tour, le second, qui travaillait encore, en recommençait une au même endroit. Une tour intacte met maintenant fin au chantier pour toute l'équipe (test ajouté).
- Page : un chantier s'affiche comme un losange creux (légende « chantier »).
- Décision : ce n'est pas un nouveau système, juste une nouvelle action des joueurs et un nouveau type de quête du village, qui s'appuient sur la nature (usure) et les monstres (effet de la tour, hordes).

# Étape 2 — serveur Colyseus + client Canvas (validée par le développeur)

## Serveur
- Fait : `npm start` lance `server/index.js` : un serveur Colyseus 0.18 (paquets minimaux `@colyseus/core`, `ws-transport`, `schema`, `sdk`, plus `express`) qui sert aussi la page du jeu sur le même port. Une room = une contrée, créée au démarrage et jamais détruite (`autoDispose = false`) : le monde avance d'une heure toutes les `HEURE_MS` (30 s par défaut), avec ou sans joueurs, et les bots (`BOTS=mixte` par défaut, `aucun` possible) continuent de vivre.
- Fait : les vrais joueurs pèsent sur la simulation comme les bots. Chaque zone traversée pendant l'heure compte comme présence ; Espace compte comme combat dans la zone courante (hors village). Leurs noms apparaissent donc dans la chronique.
- Fait : sauvegarde JSON atomique dans `data/contree.json` chaque fin de journée et à l'arrêt. Au redémarrage, le monde rattrape les heures passées serveur éteint (7 jours au plus). Le générateur aléatoire est sauvegardé (`rng.save()`) pour reprendre exactement la même suite.
- Fait : à l'arrivée, chaque joueur reçoit la carte fixe, les 3 derniers jours de chronique et, s'il revient après au moins un jour, le résumé « pendant votre absence » (même fonction que `--since`). À la première venue, il obtient une maison protégée au village. La chronique du jour est diffusée à chaque fin de journée.
- Décision : les quêtes du village sont affichées aux vrais joueurs, mais seuls les bots les « valident » pour l'instant ; un vrai joueur aide en étant présent et en combattant. Persistance restée en JSON (SQLite plus tard) pour ne pas ajouter de dépendance native.
- Tests : 5 tests réseau avec de vrais clients (déplacements vus par l'autre joueur, combat compté, résumé d'absence, chronique diffusée, noms en double) et 2 tests de persistance (reprise à l'identique, rattrapage borné).

## Client Canvas
- Fait : `client/` est servi par le serveur. On choisit un nom (mémorisé dans le navigateur), puis on se déplace aux flèches, en ZQSD/WASD ou au doigt, et on combat avec Espace (bouton ⚔ sur téléphone). Le rendu est en pixel art dessiné en code, sans image : terrain par biome (pré-rendu une fois par zone), village et maisons, champs, chemins, structures (fissures, chantier, ruine), monstres dont le nombre suit la pression, neige et zones fermées en hiver, coup d'épée, noms des joueurs. Une carte miniature, un bandeau (jour, heure, saison, lieu, danger, structures du lieu), un panneau Chronique (C) avec les quêtes, les métiers et les joueurs en ligne, un message de bienvenue et le résumé « pendant votre absence » complètent l'interface.
- Décision : le serveur fait autorité ; le client prédit son propre déplacement et se recale en douceur (immédiatement si l'écart dépasse 2 tuiles), et les autres joueurs sont interpolés.
- Vérifié dans Chromium : deux navigateurs se voient bouger, aucune erreur console, affichage correct en bureau et en largeur mobile.

## Codespaces et documentation
- Fait : `.devcontainer/devcontainer.json` (Node 22, `npm ci` à la création, port 2567 transféré) et `scripts/codespace.sh`, qui lance le serveur à l'ouverture, tente de rendre le port public (`gh codespace ports visibility`) et affiche l'adresse à partager. Si l'automatisme échoue, le script dit comment faire à la main. `README.md` explique comment jouer à plusieurs, les commandes et les réglages.
- Fait : `CLAUDE.md` passe en « Phase actuelle : ÉTAPE 2 » (dépendances autorisées, architecture serveur/client, déploiement). La CI installe les dépendances, lance les tests, puis vérifie que le serveur démarre et sert la page.
- À vérifier dans un vrai Codespace : que le jeton du Codespace a bien le droit de rendre le port public (sinon, étape manuelle indiquée).

## Gameplay : de vrais monstres, la vie, la touche E, les quêtes jouables
- Fait (serveur, `server/gameplay.js`) : autour de chaque joueur (sa zone et les 8 voisines), des monstres apparaissent selon la pression (0 à 6 par zone). Trois sortes selon l'infestation : gluant, rôdeur (plus rapide), brute (5 PV, frappe fort) ; les zones très infestées demandent de s'y mettre à plusieurs. Ils errent sur leur territoire, flairent un joueur à 5 tuiles, le poursuivent et le frappent. Le coup d'épée touche dans un arc devant soi et repousse. Un monstre vaincu fait baisser tout de suite la pression de 1 et compte comme un combat pour la simulation (au plus 3 par heure et par zone, pour ne pas écraser l'équilibre). Une zone nettoyée reste tranquille 15 s.
- Fait : 10 PV par joueur ; à 0, on se relève 3 s plus tard au village avec toute sa vie, et la chronique le raconte sans punir (« à bout de forces… a dû rentrer au village se soigner »). La vie remonte vite au village et lentement dehors.
- Fait : la touche E agit selon l'endroit (indiqué dans le bandeau) : couper du bois en forêt (+1 dans la réserve du village), réparer une structure abîmée (2 bois, +10), bâtir la tour de guet demandée (3 bois, +8, debout à 75), donner un coup de main au village. Les quêtes se valident en jouant : patrouille ou escorte = 4 monstres vaincus au bon endroit, coup de main = 5 fois E au village. Chaque réussite est annoncée à tous avec la phrase de la chronique et aide son métier.
- Fait (client) : monstres dessinés et animés (éclat blanc quand ils sont touchés, bond quand ils attaquent, barre de vie), cœurs, réserve de bois, action E, les 3 quêtes les plus urgentes avec leur avancement, fanions jaunes sur la carte et la mini-carte, écran « à bout de forces », bouton ✋ sur téléphone.
- Décision : les monstres du temps réel sont des « incarnations » de la pression d'une zone, pas un nouveau système de simulation : ils n'existent que près des joueurs et disparaissent quand plus personne n'est autour.
- Tests : 6 tests de gameplay avec de vrais clients (apparition/disparition, monstre vaincu compté, chute et relève, bois puis réparation, patrouille validée) ; vérifié dans Chromium en bureau et en mobile, sans erreur.

## Butin, forge, pain, roulade, cracheurs, ressources rares (serveur)
- Fait (`server/objets.js`) : les monstres lâchent du minerai et du cuir, et dans les zones qui recèlent une ressource rare de la contrée, parfois cette ressource. Le butin reste au sol 60 s et se ramasse en marchant dessus, dans le sac du joueur. La forge du village (message `fabriquer`) propose épée niv. 2 et 3 (2 et 3 dégâts), armure niv. 2 et 3 (14 et 18 PV) et bottes (+20 % de vitesse). Les niveaux 3 demandent 2 ressources rares, et chaque objet consomme un outil du forgeron : la chaîne mine -> forge compte donc aussi pour les joueurs. L'équipement et le sac sont sauvegardés par nom de joueur.
- Fait : R mange un pain pris à la réserve du boulanger (+4 PV) ; sans champs gardés, plus de pain. Maj = roulade (220 ms, vitesse ×3,4, invulnérable, recharge 1,2 s). Nouveau monstre, le cracheur (marais, collines, hauteurs dès 35 de pression) : il garde ses distances et crache des projectiles qu'on esquive en roulant. E sur un gisement rare l'exploite, seulement si la zone est dégagée (pression < 40) : il faut d'abord la nettoyer, à plusieurs. La première extraction est annoncée comme une découverte.
- Décision : les petites fonctions d'events du gameplay passent dans `server/evenements.js` pour éviter une dépendance circulaire. Tests : 6 nouveaux tests réseau.

## Client : sac, forge, roulade, pain, et un monde plus vivant
- Fait : panneau « Sac et forge » (F ou 🎒) avec l'équipement, le contenu du sac (les ressources rares en couleur) et les recettes, grisées tant qu'il manque quelque chose ou qu'on n'est pas au village. Maj = roulade, prédite localement pour partir sans délai ; R = pain ; les bottes accélèrent aussi la prédiction. Le butin (pierre, cuir, gemme scintillante), les crachats et le cracheur (un crapaud qui se gonfle) sont dessinés, la lame change de couleur avec le niveau de l'épée, et épaulières et bottes se voient.
- Fait : ambiance calculée dans chaque navigateur, sans effet sur le jeu (`client/ambiance.js`) : cinq villageois qui vont et viennent sur la place, des lapins dans les prés et collines calmes qui détalent quand on approche, des oiseaux qui passent au-dessus des bois.
- Vérifié dans Chromium : combat, ramassage d'une ressource rare, forge d'une lame, roulade, villageois, sans erreur console.

## Système population : des habitants qui vivent, s'aiment, transmettent (validé par le développeur)
- Fait (`src/sim/systems/population.js`, 5e système) : environ 16 habitants au départ (cinq foyers, des enfants, deux anciens), chacun avec un nom de famille, un âge, un métier parmi agriculteur, boulanger, forgeron, bûcheron-mineur, éleveur et enseignant, six compétences et deux traits de caractère. Un jour de jeu = une année. Couples d'âge proche (jamais entre proches parents), naissances seulement avec du pain d'avance, apprentissage par les parents, grands-parents et l'enseignant, métier choisi à 16 ans (héritage familial, dons, besoins du village), retraite à 62 ans, décès des anciens avec leurs héritiers nommés, maisons bâties avec le bois du village, et nouvelles familles quand le village se vide ou prospère sans monde.
- Fait : talents (savoir ≥ 50 + métier appris) qui changent le monde. Le forestier replante les bois clairsemés et ouvre des passages en choisissant ses arbres. L'agronome et l'éleveur défrichent un pré voisin pour créer un champ, quand le pain manque (6 champs au plus). L'inventeur crée des plans (lame, talisman) à partir des ressources rares que les joueurs rapportent (`population.rares`). Des rumeurs colorent la chronique selon le caractère et la situation.
- Décision : la production d'un métier dépend des habitants qui l'exercent (facteur 0,6 à 1,5, environ 1 au départ) ; on mange un pain pour deux habitants, et chaque champ rapporte un quart de la capacité (défricher = récolter plus, mais aussi exposer plus). Le système a son propre générateur, sauvegardé, pour ne pas bouleverser les autres.
- Problèmes repérés puis corrigés : trop d'enseignants (tous les enfants deviennent savants à l'école), couples qui ne se formaient pas, puis population qui explosait tant que la consommation ne dépendait pas du nombre d'habitants. Sur 90 jours, la population se stabilise entre 12 et 32 habitants, plus nombreuse quand les joueurs protègent les champs.

## La population dans le jeu : parler aux habitants, offrir ses trouvailles, forger d'après un plan
- Fait : les habitants sont synchronisés avec les clients (nom, famille, âge, métier, talent, traits, parents, partenaire) et ce sont eux qui déambulent au village, à la place des villageois décoratifs. Les enfants sont plus petits, les anciens ont les cheveux blancs et une canne, et chaque famille a sa couleur. E près d'un habitant ouvre un dialogue (`client/dialogues.js`) selon son métier, son talent, son caractère et la situation du village.
- Fait : dans le sac, au village, « Offrir au village » confie une ressource rare au forgeron (`population.rares`), avec une annonce et une ligne de chronique. Quand un forgeron savant invente un plan, il devient une recette de forge pour tous : lame (4 dégâts, épée niv. 2 requise, 3 minerai + 1 du matériau) ou talisman (+4 PV, 2 cuir + 1 du matériau). Le panneau Chronique montre les habitants, les familles, les talents, les plans et les offrandes.
- Décision : un plan garde le nom de sa contrée d'origine et de son auteur ; c'est la base pour les échanger entre contrées à l'étape 4.
