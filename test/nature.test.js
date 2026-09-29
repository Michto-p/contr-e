import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { simulate } from '../src/sim/tick.js';

test('un chemin non emprunté finit par disparaître', () => {
  const w = createWorld(42);
  // Les chemins des champs sont entretenus par les paysans.
  const withPath = w.zones.filter((z) => z.pathWear > 0 && !z.isField).map((z) => z.id);
  const { state, events } = simulate(w, createRng(1), { days: 20 });
  for (const id of withPath) assert.equal(state.zones[id].pathWear, 0);
  assert.ok(events.some((e) => e.type === 'path_lost' && e.data.fix));
});

test('les structures hors village se dégradent, jamais les maisons du village', () => {
  const w = createWorld(42);
  const { state, events } = simulate(w, createRng(1), { days: 10 });
  const village = state.zones[state.villageId];
  assert.ok(village.structures.every((s) => s.condition === 100));
  const outside = state.zones.filter((z) => !z.isVillage).flatMap((z) => z.structures);
  const outsideBefore = w.zones.filter((z) => !z.isVillage).flatMap((z) => z.structures);
  outside.forEach((s, i) => assert.ok(s.condition < outsideBefore[i].condition));
  assert.ok(events.some((e) => e.type === 'structure_decay'));
});

test('la végétation reste sous le maximum du biome', () => {
  const { state } = simulate(createWorld(3), createRng(3), { days: 30 });
  for (const z of state.zones) assert.ok(z.vegetation >= 0 && z.vegetation <= 100);
});
