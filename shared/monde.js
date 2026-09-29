// Constantes partagées entre le serveur et le client (géométrie du monde jouable).
// Taille de la carte du jeu, en zones de côté (la simulation seule garde 12 par défaut).
export const MAP_ZONES = 16;
// Une zone de la simulation = un carré de ZONE_TILES × ZONE_TILES tuiles à l'écran.

export const ZONE_TILES = 16;
// Un avant-poste se dresse à l'écart du centre de sa zone (en tuiles depuis le coin de la zone) ; autour de
// lui, les monstres n'apparaissent pas et l'on reprend des forces.
export const OUTPOST_SPOT = [12, 6];
export const OUTPOST_SAFE = 4.5; // tuiles

// Au village (en tuiles depuis le coin de la zone) : l'auberge, où tout le monde commence, et les
// terrains où les joueurs bâtissent leur maison.
export const INN_SPOT = [10, 4]; // coin haut-gauche, 3 × 2 tuiles
export const INN_DOOR = [11.5, 6.4];
export const HOUSE_LOTS = [[4, 3], [7, 4], [14, 4], [3, 7], [11, 8], [5, 9], [14, 9], [8, 12], [6, 14], [12, 14]];
export const houseDoor = (lot) => [HOUSE_LOTS[lot][0] + 0.5, HOUSE_LOTS[lot][1] + 1.3];

// Maisons des habitants au cœur du village (leurs fenêtres s'allument la nuit).
export const VILLAGE_HOUSES = [[2, 1], [6, 1], [10, 1], [13, 2], [1, 5], [13, 6], [1, 10], [5, 12], [10, 12], [13, 11], [3, 14]];

// Quand le village s'agrandit, chaque faubourg a ses maisons d'habitants et 6 terrains de plus.
export const FAUBOURG_HOUSES = [[2, 2], [7, 1], [12, 2], [2, 12], [12, 12], [7, 13]];
export const FAUBOURG_LOTS = [[4, 6], [8, 5], [12, 6], [4, 9], [8, 9], [11, 10]];
export const lotCount = (faubourgs = []) => HOUSE_LOTS.length + faubourgs.length * FAUBOURG_LOTS.length;
// Tuile (en coordonnées du monde) d'un terrain : les premiers au cœur du village, puis par faubourg.
// `geo` : { villageId, width, faubourgs }.
export function lotTile(lot, geo) {
  let zone;
  let rel;
  if (lot < HOUSE_LOTS.length) {
    zone = geo.villageId;
    rel = HOUSE_LOTS[lot];
  } else {
    const k = Math.floor((lot - HOUSE_LOTS.length) / FAUBOURG_LOTS.length);
    zone = geo.faubourgs?.[k];
    rel = FAUBOURG_LOTS[(lot - HOUSE_LOTS.length) % FAUBOURG_LOTS.length];
    if (zone == null) return null;
  }
  return [(zone % geo.width) * ZONE_TILES + rel[0], Math.floor(zone / geo.width) * ZONE_TILES + rel[1]];
}
// Tuile d'une maison d'habitants : d'abord le cœur du village, puis les faubourgs.
export function villagerHouseTile(index, geo) {
  let zone;
  let rel;
  if (index < VILLAGE_HOUSES.length) {
    zone = geo.villageId;
    rel = VILLAGE_HOUSES[index];
  } else {
    const k = Math.floor((index - VILLAGE_HOUSES.length) / FAUBOURG_HOUSES.length);
    zone = geo.faubourgs?.[k];
    rel = FAUBOURG_HOUSES[(index - VILLAGE_HOUSES.length) % FAUBOURG_HOUSES.length];
    if (zone == null) return null;
  }
  return [(zone % geo.width) * ZONE_TILES + rel[0], Math.floor(zone / geo.width) * ZONE_TILES + rel[1]];
}
// Une ruine : la maison d'un habitant (`maison`) ou celle d'un joueur (`lot`).
export const ruinTile = (r, geo) => (r.kind === 'lot' ? lotTile(r.index, geo) : villagerHouseTile(r.index, geo));

export function lotDoor(lot, geo) {
  const t = lotTile(lot, geo);
  return t ? [t[0] + 0.5, t[1] + 1.3] : null;
}

// L'intérieur d'une maison : une pièce de ROOM_W × ROOM_H tuiles, en coordonnées locales.
// Le mobilier a une place par défaut (la disposition pourra se personnaliser plus tard).
export const ROOM_W = 10;
export const ROOM_H = 7;
export const ROOM_FURNITURE = {
  porte: [5, 6.4], lit: [1.6, 1.9], coffre: [8.4, 1.8], panier: [2, 5.2], cheminee: [5, 0.9], table: [7, 4.2],
};
export const SPEED = 5; // tuiles par seconde
export const MOVE_STEP_MS = 50; // pas de simulation des déplacements côté serveur

export function zoneIndexAt(x, y, width, height) {
  const zx = Math.max(0, Math.min(width - 1, Math.floor(x / ZONE_TILES)));
  const zy = Math.max(0, Math.min(height - 1, Math.floor(y / ZONE_TILES)));
  return zy * width + zx;
}

export const DASH_MS = 220; // durée d'une roulade
export const DASH_FACTOR = 3.4; // vitesse pendant la roulade
export const BOOTS_FACTOR = 1.2; // avec des bottes

// Déplacement d'un pas : direction normalisée, vitesse constante (× facteur : bottes, roulade).
export function stepPosition(x, y, input, dtMs, factor = 1) {
  const len = Math.hypot(input.x, input.y);
  if (!len) return { x, y };
  const d = (SPEED * factor * dtMs) / 1000;
  return { x: x + (input.x / len) * d, y: y + (input.y / len) * d };
}
