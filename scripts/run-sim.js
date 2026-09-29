#!/usr/bin/env node
// CLI : fait tourner la simulation et affiche la chronique.
// Usage : node scripts/run-sim.js --days 7 --seed 42 [--ticks-per-day 24] [--agents mixte] [--out data/run.json] [--debug] [--since 3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRng } from '../src/sim/rng.js';
import { createWorld } from '../src/sim/world.js';
import { simulate } from '../src/sim/tick.js';
import { formatChronicle } from '../src/chronicle/chronicle.js';
import { addPlayers, agentsAct } from '../src/sim/agents.js';

function parseArgs(argv) {
  const opts = { days: 7, seed: 42, ticksPerDay: 24, agents: 'mixte', out: null, debug: false, since: null, vie: 1 };
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
    else if (a === '--vie') opts.vie = Number(val()); // années de vie des habitants par jour de jeu
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
    console.log('Usage : npm run sim -- --days 7 --seed 42 [--ticks-per-day 24] [--agents assidus|mixte|absents] [--out fichier.json] [--debug] [--since jour] [--vie 0.25]');
    return;
  }

  if (!(opts.vie > 0 && opts.vie <= 4)) {
    console.error('--vie : nombre d\'années de vie par jour de jeu, entre 0.05 et 4 (0.25 = une saison)');
    process.exit(1);
  }
  const world = createWorld(opts.seed, { yearsPerDay: opts.vie });
  const rng = createRng(opts.seed);
  try {
    addPlayers(world, rng, opts.agents);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { state, events } = simulate(world, rng, {
    days: opts.days, ticksPerDay: opts.ticksPerDay, beforeTick: agentsAct,
  });

  console.log(formatChronicle(events, { debug: opts.debug, since: opts.since, days: opts.days }));

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify({ options: opts, state, events }, null, 2));
  }
}

main();
