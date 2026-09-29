// Constantes partagées entre le serveur et le client (géométrie du monde jouable).
// Taille de la carte du jeu, en zones de côté (la simulation seule garde 12 par défaut).
export const MAP_ZONES = 16;
// Une zone de la simulation = un carré de ZONE_TILES × ZONE_TILES tuiles à l'écran.

export const ZONE_TILES = 16;
// Un avant-poste se dresse à l'écart du centre de sa zone (en tuiles depuis le coin de la zone) ; autour de
// lui, les monstres n'apparaissent pas et l'on reprend des forces.
export const OUTPOST_SPOT = [12, 6];
export const OUTPOST_SAFE = 4.5; // tuiles
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
