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

## Commandes du jeu

- Flèches, ou **Z Q S D** (AZERTY) / **W A S D** (QWERTY) : se déplacer.
- **Espace** : combattre. Les monstres de la zone reculent, et bien plus vite à plusieurs.
- **C** : chronique, quêtes du village, métiers, joueurs en ligne.
- Sur téléphone : maintenir le doigt dans une direction pour marcher, bouton ⚔ pour combattre.

## Organisation du code

```
src/sim/        simulation (monde, systèmes, bots) — sans dépendance
src/chronicle/  events -> phrases de la chronique
server/         serveur Colyseus : une room = une contrée, sauvegarde, rattrapage
client/         page du jeu (Canvas 2D), servie par le serveur
shared/         constantes communes au serveur et au client
web/, index.html  page de visualisation de la simulation (GitHub Pages)
```
