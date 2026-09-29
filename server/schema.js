// État synchronisé avec les clients (Colyseus). Seul ce qui change est envoyé.
// Les données fixes de la carte (biomes, noms de lieux) partent une fois, par message, à l'arrivée.
import { schema, t } from '@colyseus/schema';

export const Joueur = schema({
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
}, 'Joueur');

export const Monstre = schema({
  sorte: t.string(), // 'gluant' | 'rodeur' | 'brute'
  x: t.float32(),
  y: t.float32(),
  pv: t.uint8(),
  pvMax: t.uint8(),
  coup: t.uint16(), // compteur : chaque attaque du monstre
  touche: t.uint16(), // compteur : chaque coup reçu
}, 'Monstre');

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
  joueurs: t.map(Joueur),
  monstres: t.map(Monstre),
  zones: t.array(Zone),
  metiers: t.map(Metier),
  quetes: t.array(Quete),
}, 'EtatContree');
