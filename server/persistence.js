// Sauvegarde de la contrée en JSON dans data/ (SQLite plus tard).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRng } from '../src/sim/rng.js';
import { createWorld } from '../src/sim/world.js';
import { advanceHour } from '../src/sim/tick.js';
import { addPlayers, agentsAct } from '../src/sim/agents.js';
import { createPopulation } from '../src/sim/systems/population.js';

export const EVENT_DAYS_KEPT = 30; // jours d'events gardés (chronique, résumés d'absence)

// Fait avancer le monde d'une heure et garde un historique d'events borné.
export function advanceWorld(world) {
  const res = advanceHour(world.sim, world.rng, { beforeTick: agentsAct });
  world.sim = res.state;
  world.events.push(...res.events);
  const oldest = world.sim.day - EVENT_DAYS_KEPT;
  if (world.events.length && world.events[0].day < oldest) {
    world.events = world.events.filter((e) => e.day >= oldest || e.type === 'contree');
  }
  return res.events;
}

// Ouvre la contrée : la recharge si elle existe (en rattrapant le temps passé serveur éteint),
// sinon la crée à partir de la graine.
export function openWorld({ fichier, graine = 42, bots = 'mixte', heureMs = 30_000, rattrapageMaxJours = 7, now = Date.now() }) {
  const saved = loadWorld(fichier);
  if (!saved) {
    const sim = createWorld(graine);
    const rng = createRng(graine);
    addPlayers(sim, rng, bots);
    return { sim, rng, events: [], registry: {}, created: true, caughtUp: 0 };
  }
  const world = { sim: saved.sim, rng: createRng(saved.rng), events: saved.events ?? [], registry: saved.registry ?? {}, created: false };
  // Migration : une contrée sauvegardée avant l'arrivée de la population reçoit ses habitants.
  if (!world.sim.village.population) world.sim.village.population = createPopulation(world.sim.seed);
  const missed = Math.floor((now - saved.savedAt) / heureMs);
  world.caughtUp = Math.max(0, Math.min(missed, rattrapageMaxJours * 24));
  for (let i = 0; i < world.caughtUp; i++) advanceWorld(world);
  return world;
}

export function snapshotWorld(world, now) {
  return { version: 1, savedAt: now, sim: world.sim, rng: world.rng.save(), events: world.events, registry: world.registry };
}

export function loadWorld(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Écriture atomique : on écrit à côté puis on renomme, pour ne jamais laisser un fichier à moitié écrit.
export function saveWorld(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}
