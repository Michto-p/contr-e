import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { simulate } from '../src/sim/tick.js';
import { addPlayers, agentsAct, SCENARIOS } from '../src/sim/agents.js';

function run(scenario, days, seed = 42) {
  const w = createWorld(seed);
  const rng = createRng(seed);
  addPlayers(w, rng, scenario);
  return simulate(w, rng, { days, beforeTick: agentsAct });
}

test('scénarios disponibles', () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), ['absents', 'assidus', 'aucun', 'mixte']);
  assert.throws(() => addPlayers(createWorld(1), createRng(1), 'inconnu'));
});

test('simulation avec agents déterministe', () => {
  assert.deepEqual(run('mixte', 5), run('mixte', 5));
});

test('les absents ne se connectent qu\'au jour 1 et au jour 7', () => {
  const { events } = run('absents', 7);
  const days = new Set(events.filter((e) => e.type === 'quest_done').map((e) => e.day));
  for (const d of days) assert.ok(d === 1 || d === 7, `jour ${d}`);
  assert.ok(events.some((e) => e.type === 'player_return' && e.day === 7));
});

test('des joueurs assidus protègent mieux les récoltes que des absents', () => {
  const losses = (sc) => run(sc, 14).events.filter((e) => e.type === 'harvest_loss').length;
  assert.ok(losses('assidus') < losses('absents'));
});

test('les maisons des joueurs sont au village et ne se dégradent pas', () => {
  const { state } = run('absents', 10);
  const houses = state.zones[state.villageId].structures.filter((s) => s.type.startsWith('maison de'));
  assert.equal(houses.length, 8);
  assert.ok(houses.every((h) => h.condition === 100 && h.protected));
});

test('la présence des joueurs trace des chemins', () => {
  const { events } = run('assidus', 7);
  assert.ok(events.some((e) => e.type === 'path_formed'));
});
