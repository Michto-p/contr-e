import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { makeCtx } from '../src/sim/tick.js';
import { monsters, SOLO_LIMIT } from '../src/sim/systems/monsters.js';

const endOfDay = (state) => ({ ...makeCtx(state, 24), dayEnd: true });

test('la pression monte dans une zone sans joueurs, jamais au village', () => {
  const s = createWorld(42);
  const z = s.zones.find((x) => x.dist === 2);
  const before = z.monsterPressure;
  monsters(s, createRng(1), endOfDay(s));
  assert.ok(z.monsterPressure > before);
  assert.equal(s.zones[s.villageId].monsterPressure, 0);
});

test('combattre fait reculer les monstres, mieux à plusieurs', () => {
  const solo = createWorld(42);
  const duo = createWorld(42);
  for (const s of [solo, duo]) {
    const z = s.zones.find((x) => x.dist === 3);
    z.monsterPressure = 60;
    z.today.fights = 2;
    z.today.visits = 2;
    z.today.fighters = s === solo ? ['A', 'A'] : ['A', 'B'];
  }
  monsters(solo, createRng(5), endOfDay(solo));
  monsters(duo, createRng(5), endOfDay(duo));
  const pSolo = solo.zones.find((x) => x.dist === 3).monsterPressure;
  const pDuo = duo.zones.find((x) => x.dist === 3).monsterPressure;
  assert.ok(pSolo < 60);
  assert.ok(pDuo < pSolo);
});

test('un combattant seul bat en retraite dans une zone très infestée', () => {
  const s = createWorld(42);
  const z = s.zones.find((x) => x.dist === 4);
  z.monsterPressure = SOLO_LIMIT + 5;
  z.today.fights = 3;
  z.today.visits = 3;
  z.today.fighters = ['A'];
  const events = monsters(s, createRng(1), endOfDay(s));
  assert.ok(events.some((e) => e.type === 'retreat' && e.data.fix));
  assert.ok(z.monsterPressure >= SOLO_LIMIT);
});

test('rien ne se passe hors fin de journée', () => {
  const s = createWorld(42);
  const snapshot = JSON.stringify(s.zones.map((z) => z.monsterPressure));
  assert.deepEqual(monsters(s, createRng(1), makeCtx(s, 24)), []);
  assert.equal(JSON.stringify(s.zones.map((z) => z.monsterPressure)), snapshot);
});
