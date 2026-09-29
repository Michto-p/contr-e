// Génération d'une contrée à partir d'une graine.
// Une contrée = une grille de zones (pas de tuiles) avec un village au centre.
import { createRng } from './rng.js';
import { createPopulation } from './systems/population.js';

export const BIOMES = ['foret', 'plaine', 'colline', 'marais', 'montagne'];

// Fréquence des biomes : la plaine est la plus courante, le marais et la montagne plus rares.
export const BIOME_WEIGHTS = { plaine: 34, foret: 26, colline: 18, marais: 12, montagne: 10 };
// Biomes repoussés loin du village (on ne fonde pas un village au bord d'un marais ou d'un col).
const FAR_BIOMES = new Set(['marais', 'montagne']);

// Ressources communes par biome (valeurs 0–100 = abondance).
const BIOME_RESOURCES = {
  foret: ['bois', 'gibier'],
  plaine: ['herbes'],
  colline: ['pierre', 'minerai'],
  marais: ['herbes', 'tourbe'],
  montagne: ['minerai', 'charbon', 'pierre'],
};

// Végétation maximale atteignable par biome.
export const BIOME_MAX_VEGETATION = { foret: 95, plaine: 70, colline: 60, marais: 80, montagne: 35 };

// Ressources rares : chaque contrée en possède 2 ou 3, les autres doivent voyager.
export const EXCLUSIVE_RESOURCES = ['cristal', 'ambre', 'soie sauvage', 'sel gemme', 'fer noir', 'résine dorée', 'perles de marais'];

const OUTSIDE_STRUCTURES = ['tour de guet', 'pont', 'cabane de chasseur', 'palissade', 'vieux moulin'];

const SYLLABES_A = ['Val', 'Mor', 'Bré', 'Ker', 'Aube', 'Roc', 'Fen', 'Lau', 'Sau', 'Gris'];
const SYLLABES_B = ['lande', 'moor', 'val', 'brune', 'combe', 'fond', 'mont', 'noue', 'aigue', 'bois'];

export const JOBS = ['agriculteur', 'boulanger', 'forgeron', 'bucheron_mineur'];

// Stock de départ de chaque métier (ce qu'il produit et garde en réserve).
const JOB_STOCK = {
  agriculteur: { ble: 15 },
  boulanger: { pain: 20 },
  forgeron: { outils: 15 },
  bucheron_mineur: { minerai: 15, charbon: 15, bois: 20 },
};

export const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(v)));

// Un avant-poste bâti hors du village rend une zone plus sûre (moins de monstres, on y travaille).
export const OUTPOST = 'avant-poste';
// Structure debout et en état (au moins à moitié) dans une zone.
export const standing = (zone, type) => zone.structures.some((s) => s.type === type && !s.building && s.condition >= 50);

// Direction d'une zone vue depuis le village (8 secteurs).
export function regionOf(dx, dy) {
  if (dx === 0 && dy === 0) return 'Centre';
  const angle = Math.atan2(-dy, dx); // y vers le bas dans la grille
  const sectors = ['Est', 'Nord-Est', 'Nord', 'Nord-Ouest', 'Ouest', 'Sud-Ouest', 'Sud', 'Sud-Est'];
  const idx = Math.round(angle / (Math.PI / 4));
  return sectors[(idx + 8) % 8];
}

// « de l'Est », « du Nord »…
export function deRegion(region) {
  return /^[AEIOUÉ]/.test(region) ? `de l'${region}` : `du ${region}`;
}

const BIOME_NOUN = {
  foret: 'les bois',
  plaine: 'les prés',
  colline: 'les collines',
  marais: 'les marais',
  montagne: 'les hauteurs',
};

export function zoneLabel(zone) {
  if (zone.isVillage) return 'le village';
  if (zone.faubourg) return `le faubourg ${deRegion(zone.region)}`;
  if (zone.isField) return `les champs ${deRegion(zone.region)}`;
  return `${BIOME_NOUN[zone.biome]} ${deRegion(zone.region)}`;
}

function contreeName(rng) {
  return rng.pick(SYLLABES_A) + rng.pick(SYLLABES_B);
}

// Carte de biomes par cellules de Voronoï. Le village est dans une plaine ; le biome dominant
// revient plus souvent que les autres sans tout recouvrir.
function biomeMap(rng, width, height, dominant) {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const seeds = [{ x: cx, y: cy, biome: 'plaine' }];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const biome = rng.chance(0.3) ? dominant : rng.weighted(BIOME_WEIGHTS);
    let x = rng.int(0, width - 1);
    let y = rng.int(0, height - 1);
    for (let tries = 0; FAR_BIOMES.has(biome) && Math.max(Math.abs(x - cx), Math.abs(y - cy)) < 3 && tries < 10; tries++) {
      x = rng.int(0, width - 1);
      y = rng.int(0, height - 1);
    }
    seeds.push({ x, y, biome });
  }
  return (x, y) => {
    let best = seeds[0];
    let bestD = Infinity;
    for (const s of seeds) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best.biome;
  };
}

export function createWorld(seed, { width = 12, height = 12, yearsPerDay = 1 } = {}) {
  const rng = createRng(seed);
  const dominant = rng.weighted(BIOME_WEIGHTS);
  const nbExclusives = rng.int(2, 3);
  const pool = [...EXCLUSIVE_RESOURCES];
  const exclusives = [];
  for (let i = 0; i < nbExclusives; i++) exclusives.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);

  const vx = Math.floor(width / 2);
  const vy = Math.floor(height / 2);
  const biomeAt = biomeMap(rng, width, height, dominant);

  const zones = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - vx;
      const dy = y - vy;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const isVillage = dist === 0;
      // Les champs bordent le village sur les 4 côtés.
      const isField = !isVillage && Math.abs(dx) + Math.abs(dy) === 1;
      // Le village est dans une clairière de plaine ; marais et hauteurs commencent plus loin.
      let biome = isVillage || isField || dist <= 1 ? 'plaine' : biomeAt(x, y);
      if (dist <= 2 && FAR_BIOMES.has(biome)) biome = 'plaine';
      const resources = {};
      for (const r of BIOME_RESOURCES[biome]) {
        if (r === 'minerai' && biome === 'colline' && !rng.chance(0.4)) continue;
        resources[r] = rng.int(30, 90);
      }
      if (isField) resources.ble = 80;
      const zone = {
        id: zones.length,
        x, y,
        biome,
        region: regionOf(dx, dy),
        dist,
        isVillage,
        isField,
        vegetation: clamp(BIOME_MAX_VEGETATION[biome] - rng.int(0, 20)),
        // Plus on s'éloigne du village, plus les monstres sont installés.
        monsterPressure: isVillage ? 0 : clamp(dist * 9 + rng.int(-8, 8)),
        pathWear: 0,
        structures: [],
        resources,
        closed: false,
        overflowing: false,
        today: { visits: 0, fights: 0, visitors: [], fighters: [], workers: 0 },
      };
      zone.label = zoneLabel(zone);
      zones.push(zone);
    }
  }
  const village = zones.find((z) => z.isVillage);

  // La signature annonce le biome réellement le plus présent (le tirage n'est qu'une tendance).
  const counts = {};
  for (const z of zones) if (!z.isVillage && !z.isField) counts[z.biome] = (counts[z.biome] ?? 0) + 1;
  const mainBiome = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  // Ressources exclusives : cachées dans 1 à 2 zones éloignées.
  const far = zones.filter((z) => z.dist >= 3);
  for (const res of exclusives) {
    const count = rng.int(1, 2);
    for (let i = 0; i < count; i++) rng.pick(far).resources[res] = rng.int(40, 80);
  }

  // Quelques chemins partent du village vers les quatre points cardinaux.
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = rng.int(2, 4);
    for (let k = 1; k <= len; k++) {
      const z = zoneAt({ zones, width, height }, vx + sx * k, vy + sy * k);
      if (z) z.pathWear = clamp(60 - k * 8);
    }
  }

  // Structures hors du village (exposées) : 3 à 5.
  const candidates = zones.filter((z) => z.dist >= 2 && z.dist <= 4);
  const nbStruct = rng.int(3, 5);
  for (let i = 0; i < nbStruct; i++) {
    const z = rng.pick(candidates);
    const type = rng.pick(OUTSIDE_STRUCTURES);
    if (z.structures.some((s) => s.type === type)) continue;
    z.structures.push({ type, condition: rng.int(55, 90), warned: null });
  }

  const jobs = {};
  for (const job of JOBS) {
    jobs[job] = { level: 2, stock: { ...JOB_STOCK[job] }, needs: {}, satisfaction: 60, neglect: 0, progress: 0, maxLevel: 2 };
  }
  // Les maisons des joueurs sont au village : protégées, elles ne se dégradent jamais.
  village.structures.push({ type: 'maisons', condition: 100, protected: true });

  return {
    seed,
    name: contreeName(rng),
    width,
    height,
    day: 1,
    tick: 0,
    villageId: village.id,
    signature: { biome: mainBiome, exclusives },
    zones,
    village: {
      jobs,
      quests: [],
      nextQuestId: 1,
      population: createPopulation(seed, { yearsPerDay }),
    },
    // Le cycle ne commence pas toujours au printemps : chaque contrée a son propre calendrier.
    season: { startOffset: rng.int(0, 27) },
    players: [],
  };
}

export function zoneAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
  return state.zones[y * state.width + x];
}

export function neighbors(state, zone) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const z = zoneAt(state, zone.x + dx, zone.y + dy);
      if (z) out.push(z);
    }
  }
  return out;
}
