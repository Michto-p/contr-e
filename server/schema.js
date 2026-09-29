// État synchronisé avec les clients (Colyseus). Seul ce qui change est envoyé.
// Les données fixes de la carte (biomes, noms de lieux) partent une fois, par message, à l'arrivée.
import { schema, t } from '@colyseus/schema';

export const Joueur = schema({
  joueur: t.string(), // le joueur qui incarne ce personnage
  classe: t.string(),
  metier: t.string(),
  secret: t.string(), // secret de classe découvert ('' sinon)
  force: t.uint8(),
  endurance: t.uint8(),
  agilite: t.uint8(),
  survie: t.uint8(),
  savoirFaire: t.uint8(),
  flair: t.uint8(),
  nom: t.string(),
  x: t.float32(),
  y: t.float32(),
  dir: t.string(), // 'bas' | 'haut' | 'gauche' | 'droite'
  bouge: t.boolean(),
  attaque: t.uint16(), // compteur : chaque attaque l'incrémente (le client anime)
  couleur: t.uint8(),
  pv: t.uint8(),
  pvMax: t.uint8(),
  aTerre: t.boolean(),
  touche: t.uint16(), // compteur : chaque coup reçu l'incrémente
  action: t.string(), // ce que fait la touche E ici (« réparer la palissade »), vide sinon
  epee: t.uint8(), // niveau de l'épée (dégâts)
  armure: t.uint8(), // niveau de l'armure (points de vie max)
  bottes: t.uint8(), // 0 ou 1 (vitesse)
  talisman: t.uint8(), // 0 ou 1 (+4 PV), forgé d'après un plan inventé au village
  roulade: t.uint16(), // compteur : chaque roulade l'incrémente
  sac: t.map('uint16'), // objet -> quantité (minerai, cuir, ressources rares)
  maison: t.int8(), // terrain de la maison du joueur (-1 : il dort à l'auberge)
  faim: t.uint8(), // 0–100
  fatigue: t.uint8(), // 0–100
  coffre: t.map('uint16'), // le coffre de sa maison, commun à ses personnages
}, 'Joueur');

export const Habitant = schema({
  id: t.uint16(),
  prenom: t.string(),
  famille: t.string(),
  age: t.uint8(),
  metier: t.string(), // '' pour un enfant
  talent: t.string(),
  traits: t.string(), // « curieux, bavard »
  parents: t.string(), // prénoms des parents
  partenaire: t.string(),
  sortie: t.int16(), // zone où l'habitant est parti aujourd'hui (-1 : au village)
  joueur: t.string(), // personnage d'un joueur ('' sinon)
  joue: t.boolean(), // incarné en ce moment (il n'est donc pas au village)
  motif: t.string(), // 'travail', 'defense' ou 'exploration'
  blesse: t.boolean(),
}, 'Habitant');

// Un plan inventé par le forgeron : une recette de plus à la forge.
export const Plan = schema({
  id: t.string(),
  nom: t.string(),
  effet: t.string(),
  slot: t.string(),
  niveau: t.uint8(),
  prerequis: t.uint8(),
  requis: t.string(), // « minerai:3,cuir:1 »
  materiau: t.string(),
  auteur: t.string(),
}, 'Plan');

export const Butin = schema({
  sorte: t.string(), // 'minerai' | 'cuir' | nom d'une ressource rare
  x: t.float32(),
  y: t.float32(),
}, 'Butin');

export const Projectile = schema({
  x: t.float32(),
  y: t.float32(),
}, 'Projectile');

export const Monstre = schema({
  sorte: t.string(), // 'gluant' | 'rodeur' | 'brute' | 'cracheur'
  x: t.float32(),
  y: t.float32(),
  pv: t.uint8(),
  pvMax: t.uint8(),
  coup: t.uint16(), // compteur : chaque attaque du monstre
  touche: t.uint16(), // compteur : chaque coup reçu
  horde: t.boolean(), // membre d'une horde en marche vers le village
}, 'Monstre');

// Un habitant présent sur la carte du jeu : garde en patrouille ou voyageur égaré.
export const Pnj = schema({
  sorte: t.string(), // 'garde' | 'egare'
  prenom: t.string(),
  famille: t.string(),
  x: t.float32(),
  y: t.float32(),
  dir: t.string(),
  bouge: t.boolean(),
  pv: t.uint8(),
  pvMax: t.uint8(),
  coup: t.uint16(), // compteur : chaque coup porté
  touche: t.uint16(), // compteur : chaque coup reçu
  suit: t.string(), // égaré : nom du joueur qui le ramène
}, 'Pnj');

export const Zone = schema({
  p: t.uint8(), // pression des monstres 0–100
  w: t.uint8(), // usure du chemin
  c: t.boolean(), // fermée (neige)
  s: t.string(), // structures exposées : "type|état|chantier;…"
}, 'Zone');

export const Metier = schema({
  niveau: t.uint8(),
  satisfaction: t.uint8(),
}, 'Metier');

export const Quete = schema({
  id: t.uint16(),
  texte: t.string(),
  zone: t.int16(), // -1 : au village
  progres: t.uint8(), // 0–100
}, 'Quete');

export const EtatContree = schema({
  jour: t.uint16(),
  heure: t.uint8(),
  saison: t.string(),
  meteo: t.string(),
  bois: t.uint8(), // réserve de bois du village (réparations, tours de guet)
  pain: t.uint8(), // réserve de pain du boulanger (soins)
  outils: t.uint8(), // outils du forgeron (la forge en consomme un par objet)
  joueurs: t.map(Joueur),
  monstres: t.map(Monstre),
  butins: t.map(Butin),
  projectiles: t.map(Projectile),
  maisons: t.map('string'), // terrain -> joueur qui y a bâti sa maison
  pnj: t.map(Pnj),
  zones: t.array(Zone),
  metiers: t.map(Metier),
  quetes: t.array(Quete),
  habitants: t.array(Habitant),
  plans: t.array(Plan),
  offrandes: t.map('uint16'), // ressources rares confiées au village, pas encore utilisées
}, 'EtatContree');
