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

test('weighted respecte les poids', () => {
  const r = createRng(3);
  const n = { a: 0, b: 0 };
  for (let i = 0; i < 4000; i++) n[r.weighted({ a: 3, b: 1 })] += 1;
  assert.ok(n.a > n.b * 2.5 && n.a < n.b * 3.5, JSON.stringify(n));
});
