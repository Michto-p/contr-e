import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { simulate } from '../src/sim/tick.js';
import { seasonIndex } from '../src/sim/systems/seasons.js';

test('le cycle dure 28 jours, 7 par saison', () => {
  const s = createWorld(42);
  s.season.startOffset = 0;
  assert.equal(seasonIndex(s, 1), 0);
  assert.equal(seasonIndex(s, 7), 0);
  assert.equal(seasonIndex(s, 8), 1);
  assert.equal(seasonIndex(s, 22), 3);
  assert.equal(seasonIndex(s, 29), 0);
});

test('l\'hiver ferme des zones puis le printemps les rouvre', () => {
  const s = createWorld(42);
  s.season.startOffset = 14; // jour 1 = automne, jour 8 = hiver, jour 15 = printemps
  const { state, events } = simulate(s, createRng(1), { days: 15 });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('zones_closed'));
  assert.ok(types.includes('zones_opened'));
  assert.equal(events.filter((e) => e.type === 'season_change').length, 2);
  assert.ok(state.zones.every((z) => !z.closed));
});

test('un event day_start par jour', () => {
  const { events } = simulate(createWorld(42), createRng(1), { days: 5 });
  assert.equal(events.filter((e) => e.type === 'day_start').length, 5);
});
