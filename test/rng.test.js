import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';

test('même graine = même séquence', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('int reste dans les bornes', () => {
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(0, 100);
    assert.ok(v >= 0 && v <= 100);
  }
});
