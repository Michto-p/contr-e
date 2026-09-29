import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';

test('même graine = même contrée', () => {
  assert.deepEqual(createWorld(42), createWorld(42));
});

test('graines différentes = contrées différentes', () => {
  assert.notDeepEqual(createWorld(1).zones, createWorld(2).zones);
});

test('grille 12x12 avec un village central sûr', () => {
  const w = createWorld(42);
  assert.equal(w.zones.length, 144);
  const villages = w.zones.filter((z) => z.isVillage);
  assert.equal(villages.length, 1);
  assert.equal(villages[0].monsterPressure, 0);
  assert.equal(w.zones.filter((z) => z.isField).length, 4);
});

test('signature : 2 ou 3 ressources exclusives présentes sur la carte', () => {
  const w = createWorld(42);
  const n = w.signature.exclusives.length;
  assert.ok(n >= 2 && n <= 3);
  for (const res of w.signature.exclusives) {
    assert.ok(w.zones.some((z) => z.resources[res] > 0), res);
  }
});

test('toutes les jauges sont des entiers 0-100', () => {
  const w = createWorld(7);
  for (const z of w.zones) {
    for (const k of ['vegetation', 'monsterPressure', 'pathWear']) {
      assert.ok(Number.isInteger(z[k]) && z[k] >= 0 && z[k] <= 100, `${k}=${z[k]}`);
    }
  }
});
