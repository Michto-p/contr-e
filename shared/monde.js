// Constantes partagées entre le serveur et le client (géométrie du monde jouable).
// Une zone de la simulation = un carré de ZONE_TILES × ZONE_TILES tuiles à l'écran.

export const ZONE_TILES = 12;
export const SPEED = 5; // tuiles par seconde
export const MOVE_STEP_MS = 50; // pas de simulation des déplacements côté serveur

export function zoneIndexAt(x, y, width, height) {
  const zx = Math.max(0, Math.min(width - 1, Math.floor(x / ZONE_TILES)));
  const zy = Math.max(0, Math.min(height - 1, Math.floor(y / ZONE_TILES)));
  return zy * width + zx;
}

// Déplacement d'un pas : direction normalisée, vitesse constante.
export function stepPosition(x, y, input, dtMs) {
  const len = Math.hypot(input.x, input.y);
  if (!len) return { x, y };
  const d = (SPEED * dtMs) / 1000;
  return { x: x + (input.x / len) * d, y: y + (input.y / len) * d };
}
