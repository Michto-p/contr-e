// Terrain procédural du client, tuile par tuile, tiré de la graine de la contrée : il ne sert qu'au
// dessin (la simulation raisonne par zones). Même graine = même paysage pour tous les joueurs.
// - les biomes se mêlent en lisière au lieu de s'arrêter net au bord des zones ;
// - collines et montagnes s'étagent en terrasses, avec des falaises ;
// - des ruisseaux serpentent loin du village (ils se traversent à gué) ;
// - les bois ont leurs clairières, les prés leurs bosquets.
import { ZONE_TILES } from './shared/monde.js';

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Bruit de valeur lissé, entre 0 et 1.
function noise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Plusieurs octaves : de grandes formes et un peu de détail.
export function fbm(x, y, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, y, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / norm;
}

function seedOf(monde) {
  if (Number.isInteger(monde.graine)) return monde.graine;
  let h = 7;
  for (const ch of monde.nom ?? '') h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

export function createTerrain(monde) {
  const seed = seedOf(monde);
  const W = monde.largeur;
  const H = monde.hauteur;
  const worldW = W * ZONE_TILES;
  const worldH = H * ZONE_TILES;
  const zoneIndex = (gx, gy) => {
    const zx = Math.max(0, Math.min(W - 1, Math.floor(gx / ZONE_TILES)));
    const zy = Math.max(0, Math.min(H - 1, Math.floor(gy / ZONE_TILES)));
    return zy * W + zx;
  };
  const tame = (z) => z.village || z.champ;

  // Lisières : on regarde la zone d'un point légèrement déplacé par le bruit. Le village et les champs
  // gardent leurs bords nets (ce sont des lieux de jeu précis).
  function biomeAt(gx, gy) {
    const own = monde.zones[zoneIndex(gx, gy)];
    if (tame(own)) return own.biome;
    const wx = gx + (fbm(gx * 0.08, gy * 0.08, seed + 11) - 0.5) * 32;
    const wy = gy + (fbm(gx * 0.08, gy * 0.08, seed + 23) - 0.5) * 32;
    const other = monde.zones[zoneIndex(wx, wy)];
    return tame(other) ? own.biome : other.biome;
  }

  // Deux ruisseaux, l'un d'ouest en est, l'autre du nord au sud, dans les bandes éloignées du village.
  const water = new Set();
  const vx = monde.village % W;
  const vy = Math.floor(monde.village / W);
  function carve(horizontal) {
    const len = horizontal ? worldW : worldH;
    const across = horizontal ? H : W;
    const centre = horizontal ? vy : vx;
    // Le côté le plus large, loin du village et de ses champs.
    const before = centre - 2;
    const after = across - centre - 3;
    const side = hash2(seed, horizontal ? 1 : 2, 5) < 0.5 ? (before >= 2 ? -1 : 1) : (after >= 2 ? 1 : -1);
    const bandLo = side < 0 ? 0 : centre + 3;
    const bandHi = side < 0 ? centre - 2 : across;
    if (bandHi - bandLo < 2) return;
    const mid = ((bandLo + bandHi) / 2) * ZONE_TILES;
    const amp = ((bandHi - bandLo) / 2 - 0.5) * ZONE_TILES;
    for (let t = 0; t < len; t++) {
      const off = (fbm(t * 0.02, horizontal ? 3.7 : 9.1, seed + 31, 3) - 0.5) * 2 * amp;
      const c = Math.round(mid + off);
      const width = 2 + (fbm(t * 0.05, 1.3, seed + 41, 2) > 0.6 ? 1 : 0);
      for (let k = 0; k < width; k++) {
        const gx = horizontal ? t : c + k;
        const gy = horizontal ? c + k : t;
        if (gx < 0 || gy < 0 || gx >= worldW || gy >= worldH) continue;
        if (tame(monde.zones[zoneIndex(gx, gy)])) continue;
        water.add(gy * worldW + gx);
      }
    }
  }
  carve(true);
  carve(false);
  const isWater = (gx, gy) => water.has(gy * worldW + gx);
  const nearWater = (gx, gy) => !isWater(gx, gy) && (isWater(gx + 1, gy) || isWater(gx - 1, gy) || isWater(gx, gy + 1) || isWater(gx, gy - 1));

  // Relief : un niveau (0, 1, 2…) par terrasse ; une falaise sépare deux niveaux.
  function level(gx, gy, biome) {
    if (biome !== 'colline' && biome !== 'montagne') return 0;
    const h = fbm(gx * 0.07, gy * 0.07, seed + 57);
    const steps = biome === 'montagne' ? 5 : 3;
    return Math.floor(h * steps);
  }

  // Densité des bois (clairières) et des bosquets dans les prés.
  const density = (gx, gy) => fbm(gx * 0.06, gy * 0.06, seed + 73);
  // Nuance de couleur à grande échelle, pour que l'herbe ne soit jamais uniforme.
  const tint = (gx, gy) => fbm(gx * 0.04, gy * 0.04, seed + 89, 2) - 0.5;

  return { seed, biomeAt, isWater, nearWater, level, density, tint, zoneIndex };
}
