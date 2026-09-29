// Nature : la végétation repousse, les chemins oubliés s'effacent, les structures non entretenues s'abîment.
import { BIOME_MAX_VEGETATION, clamp } from '../world.js';

const PATH_THRESHOLD = 40;

function pathState(wear) {
  if (wear >= PATH_THRESHOLD) return 'chemin';
  if (wear > 0) return 'trace';
  return 'aucun';
}

// Paliers de dégradation d'une structure, du plus grave au moins grave.
const STRUCTURE_STEPS = [
  { below: 1, level: 'ruine' },
  { below: 25, level: 'menace' },
  { below: 50, level: 'abimee' },
];

function structureStep(condition) {
  for (const s of STRUCTURE_STEPS) if (condition < s.below) return s.level;
  return null;
}

export function nature(state, rng, ctx) {
  if (!ctx.dayEnd) return [];
  const events = [];
  const growth = state.season?.growth ?? 1;

  for (const z of state.zones) {
    if (z.isVillage) continue;
    const visited = z.today.visits > 0 || (z.today.workers ?? 0) > 0; // joueurs ou habitants au travail

    // Végétation : repousse vers le maximum du biome, piétinée là où l'on passe beaucoup.
    const max = BIOME_MAX_VEGETATION[z.biome];
    if (z.vegetation < max && growth > 0) {
      z.vegetation = clamp(z.vegetation + Math.max(1, Math.round((max - z.vegetation) * 0.08 * growth)), 0, max);
    }
    if (visited && z.pathWear >= PATH_THRESHOLD) z.vegetation = clamp(z.vegetation - 2);

    // Chemins : sans passage, l'usure diminue ; la végétation dense accélère l'effacement.
    // L'état précédent est mémorisé car les joueurs usent les chemins en dehors de ce système.
    const before = z.pathState ?? pathState(z.pathWear);
    if (!visited && z.pathWear > 0) {
      z.pathWear = clamp(z.pathWear - (3 + (z.vegetation > 70 ? 2 : 0)));
    }
    const after = pathState(z.pathWear);
    z.pathState = after;
    if (before !== after) {
      if (after === 'chemin') events.push(ctx.event('path_formed', z, { label: z.label, dist: z.dist }));
      else if (after === 'trace' && before === 'chemin') {
        events.push(ctx.event('path_fading', z, { label: z.label, dist: z.dist, wear: z.pathWear, fix: 'emprunter' }));
      } else if (after === 'aucun') {
        events.push(ctx.event('path_lost', z, { label: z.label, dist: z.dist, fix: 'emprunter' }));
      }
    }

    // Structures exposées : se dégradent sans entretien, plus vite quand les monstres rôdent.
    for (const s of z.structures) {
      if (s.protected || s.building) continue; // un chantier n'est pas encore une structure
      if (s.maintainedDay === ctx.day) continue;
      const storm = state.season?.weather === 'orage';
      const loss = rng.int(1, 3) + (z.monsterPressure >= 70 ? 2 : 0) + (storm ? rng.int(2, 5) : 0);
      s.condition = clamp(s.condition - loss);
      const step = structureStep(s.condition);
      if (step && step !== s.warned) {
        s.warned = step;
        events.push(ctx.event('structure_decay', z, {
          label: z.label, structure: s.type, level: step, condition: s.condition, fix: 'reparer',
        }));
      }
    }
  }
  return events;
}
