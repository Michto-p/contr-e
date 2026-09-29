import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { tick, simulate } from '../src/sim/tick.js';

test('tick avance l\'horloge sans muter l\'état d\'origine', () => {
  const w = createWorld(42);
  const before = structuredClone(w);
  const { state } = tick(w, createRng(1));
  assert.deepEqual(w, before);
  assert.equal(state.tick, 1);
});

test('24 ticks = un jour', () => {
  const { state } = simulate(createWorld(42), createRng(1), { days: 2 });
  assert.equal(state.day, 3);
  assert.equal(state.tick, 48);
});

test('simulation déterministe', () => {
  const a = simulate(createWorld(42), createRng(42), { days: 5 });
  const b = simulate(createWorld(42), createRng(42), { days: 5 });
  assert.deepEqual(a, b);
});

test('les events ont le format commun', () => {
  const { events } = simulate(createWorld(42), createRng(42), { days: 7 });
  for (const e of events) {
    assert.equal(typeof e.day, 'number');
    assert.equal(typeof e.tick, 'number');
    assert.equal(typeof e.type, 'string');
    assert.equal(typeof e.data, 'object');
  }
});

test('onDayEnd est appelé une fois par jour sans changer le résultat', () => {
  const days = [];
  const withHook = simulate(createWorld(42), createRng(42), { days: 4, onDayEnd: (s, d) => days.push([d, s.day]) });
  const without = simulate(createWorld(42), createRng(42), { days: 4 });
  assert.deepEqual(days, [[1, 2], [2, 3], [3, 4], [4, 5]]);
  assert.deepEqual(withHook, without);
});
