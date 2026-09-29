#!/usr/bin/env node
// CLI : fait tourner la simulation et affiche la chronique.
// Usage : node scripts/run-sim.js --days 7 --seed 42 [--ticks-per-day 24] [--agents mixte] [--out data/run.json] [--debug] [--since 3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRng } from '../src/sim/rng.js';
import { createWorld } from '../src/sim/world.js';
import { simulate } from '../src/sim/tick.js';

function parseArgs(argv) {
  const opts = { days: 7, seed: 42, ticksPerDay: 24, agents: 'mixte', out: null, debug: false, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--days') opts.days = Number(val());
    else if (a === '--seed') opts.seed = Number(val());
    else if (a === '--ticks-per-day') opts.ticksPerDay = Number(val());
    else if (a === '--agents') opts.agents = val();
    else if (a === '--out') opts.out = val();
    else if (a === '--debug') opts.debug = true;
    else if (a === '--since') opts.since = Number(val());
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Option inconnue : ${a}`);
  }
  for (const k of ['days', 'seed', 'ticksPerDay']) {
    if (!Number.isInteger(opts[k]) || opts[k] < (k === 'seed' ? 0 : 1)) throw new Error(`Valeur invalide pour ${k}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (opts.help) {
    console.log('Usage : npm run sim -- --days 7 --seed 42 [--ticks-per-day 24] [--agents assidus|mixte|absents] [--out fichier.json] [--debug] [--since jour]');
    return;
  }

  const world = createWorld(opts.seed);
  const rng = createRng(opts.seed);
  const { state, events } = simulate(world, rng, { days: opts.days, ticksPerDay: opts.ticksPerDay });

  for (let d = 1; d <= opts.days; d++) {
    const dayEvents = events.filter((e) => e.day === d);
    console.log(`Jour ${d} : ${dayEvents.length} événements`);
    for (const e of dayEvents) console.log(`  ${e.type} ${JSON.stringify(e.data)}`);
  }

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify({ options: opts, state, events }, null, 2));
  }
}

main();
