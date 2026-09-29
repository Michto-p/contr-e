// Un tick = 1 heure de jeu. Applique les systèmes dans l'ordre et renvoie les events produits.
import { nature } from './systems/nature.js';
import { monsters } from './systems/monsters.js';

// Ordre d'application des systèmes.
export const SYSTEMS = [nature, monsters];

export function makeCtx(state, ticksPerDay) {
  const hour = state.tick % ticksPerDay;
  return {
    day: state.day,
    tick: state.tick,
    hour,
    ticksPerDay,
    dayStart: hour === 0,
    dayEnd: hour === ticksPerDay - 1,
    // Fabrique un event au format commun { day, tick, type, zone?, data }.
    event(type, zone, data = {}) {
      const e = { day: state.day, tick: state.tick, type, data };
      if (zone != null) e.zone = typeof zone === 'object' ? zone.id : zone;
      return e;
    },
  };
}

export function tick(state, rng, { ticksPerDay = 24 } = {}) {
  const next = structuredClone(state);
  const ctx = makeCtx(next, ticksPerDay);
  const events = [];
  if (next.tick === 0) {
    events.push(ctx.event('contree', null, { name: next.name, ...next.signature }));
  }
  for (const system of SYSTEMS) events.push(...system(next, rng, ctx));

  next.tick += 1;
  if (ctx.dayEnd) {
    next.day += 1;
    for (const z of next.zones) z.today = { visits: 0, fights: 0, visitors: [], fighters: [] };
  }
  return { state: next, events };
}

// Fait tourner la simulation sur plusieurs jours. `beforeTick` permet aux agents d'agir entre les ticks.
export function simulate(state, rng, { days = 7, ticksPerDay = 24, beforeTick = null } = {}) {
  const events = [];
  let current = state;
  const total = days * ticksPerDay;
  for (let i = 0; i < total; i++) {
    if (beforeTick) {
      const res = beforeTick(current, rng, makeCtx(current, ticksPerDay));
      current = res.state;
      events.push(...res.events);
    }
    const res = tick(current, rng, { ticksPerDay });
    current = res.state;
    events.push(...res.events);
  }
  return { state: current, events };
}
