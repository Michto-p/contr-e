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
}, 'Joueur');

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

export const EtatContree = schema({
  jour: t.uint16(),
  heure: t.uint8(),
  saison: t.string(),
  meteo: t.string(),
  joueurs: t.map(Joueur),
  zones: t.array(Zone),
  metiers: t.map(Metier),
  quetes: t.array("string"),
}, 'EtatContree');
