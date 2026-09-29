// Monstres : la pression monte là où personne ne passe, déborde sur les zones voisines au-delà
// d'un seuil, et recule quand des joueurs y combattent (bien mieux à plusieurs).
import { clamp, neighbors } from '../world.js';

// Chaque zone tend vers un plafond naturel : les terres lointaines sont plus infestées.
const BIOME_BONUS = { plaine: -5, foret: 0, colline: 0, marais: 5, montagne: 5 };
export const capacity = (zone) => clamp(30 + zone.dist * 12 + BIOME_BONUS[zone.biome]);
export const OVERFLOW = 70; // au-delà, les monstres débordent chez les voisins
const CALM = 45; // en dessous, une zone débordante est considérée comme calmée
const HORDE = 95; // à ce niveau, une horde se forme et part vers les zones voisines
export const SOLO_LIMIT = 80; // au-delà, un joueur seul ne fait presque rien
const FIELD_ALERT = 50;

function hasIntactWatchtower(zone) {
  return zone.structures.some((s) => s.type === 'tour de guet' && s.condition >= 50);
}

export function monsters(state, rng, ctx) {
  const village = state.zones[state.villageId];
  village.monsterPressure = 0;
  if (!ctx.dayEnd) return [];

  const events = [];
  const rate = state.season?.monsterRate ?? 1;
  const before = new Map(state.zones.map((z) => [z.id, z.monsterPressure]));
  const spill = new Map();

  for (const z of state.zones) {
    if (z.isVillage || z.closed) continue;
    const fighters = [...new Set(z.today.fighters ?? [])];

    // Combat : chaque heure de combat fait reculer les monstres ; à plusieurs, c'est bien plus efficace.
    if (z.today.fights > 0) {
      const coop = fighters.length >= 2;
      const start = z.monsterPressure;
      if (!coop && start >= SOLO_LIMIT) {
        z.monsterPressure = clamp(start - 2);
        events.push(ctx.event('retreat', z, { label: z.label, who: fighters, pressure: start, fix: 'groupe' }));
      } else {
        const drop = Math.round(z.today.fights * rng.int(4, 6) * (coop ? 1.5 : 1));
        z.monsterPressure = clamp(start - drop);
        if (start >= 30 && z.monsterPressure < 30) {
          events.push(ctx.event('zone_cleared', z, { label: z.label, who: fighters, from: start, to: z.monsterPressure }));
        } else if (drop >= 10) {
          events.push(ctx.event('monsters_pushed', z, { label: z.label, who: fighters, from: start, to: z.monsterPressure }));
        }
      }
    } else if (z.today.visits === 0) {
      // Personne : la pression monte vers le plafond (moins vite sous l'œil d'une tour de guet),
      // ou reflue lentement si un débordement l'a poussée au-dessus.
      const cap = capacity(z);
      if (z.monsterPressure < cap) {
        let growth = (Math.max(1, (cap - z.monsterPressure) * 0.2) + rng.int(0, 1)) * rate;
        if (hasIntactWatchtower(z)) growth /= 2;
        z.monsterPressure = clamp(Math.min(cap, z.monsterPressure + growth));
      } else if (z.monsterPressure > cap) {
        z.monsterPressure = clamp(z.monsterPressure - 2);
      }
    }

    // Débordement : une zone saturée pousse ses monstres vers une zone voisine plus proche du village.
    if (z.monsterPressure >= OVERFLOW) {
      const inward = neighbors(state, z).filter((n) => !n.isVillage && !n.closed && n.dist < z.dist && n.monsterPressure < z.monsterPressure);
      if (inward.length) {
        const n = rng.pick(inward);
        spill.set(n.id, (spill.get(n.id) ?? 0) + rng.int(1, 3));
      }
    }
  }

  // Horde : au plus une par jour. La zone la plus saturée se vide en partie vers le village.
  const saturated = state.zones.filter((z) => !z.isVillage && !z.closed && z.monsterPressure >= HORDE);
  if (saturated.length > 0 && rng.chance(0.5)) {
    const z = rng.pick(saturated);
    const towards = neighbors(state, z).filter((n) => !n.isVillage && !n.closed && n.dist < z.dist);
    const target = towards.length ? rng.pick(towards) : null;
    if (target) {
      z.monsterPressure = clamp(z.monsterPressure - 30);
      spill.set(target.id, (spill.get(target.id) ?? 0) + rng.int(20, 30));
      events.push(ctx.event('horde', z, { label: z.label, target: target.label, dist: target.dist, fix: 'groupe' }));
    }
  }

  for (const [id, amount] of spill) {
    const z = state.zones[id];
    z.monsterPressure = clamp(z.monsterPressure + amount);
  }

  // Changements d'état notables.
  for (const z of state.zones) {
    if (z.isVillage) continue;
    const was = before.get(z.id);
    if (!z.overflowing && z.monsterPressure >= OVERFLOW) {
      z.overflowing = true;
      // Les terres lointaines sont infestées par nature : on ne signale que ce qui approche.
      if (z.dist <= 3) {
        events.push(ctx.event('overflow', z, { label: z.label, pressure: z.monsterPressure, dist: z.dist, fix: 'groupe' }));
      }
    } else if (z.overflowing && z.monsterPressure < CALM) {
      z.overflowing = false;
    }
    if (z.isField && was < FIELD_ALERT && z.monsterPressure >= FIELD_ALERT) {
      events.push(ctx.event('fields_threatened', z, { label: z.label, pressure: z.monsterPressure, fix: 'patrouiller' }));
    }
  }
  return events;
}
