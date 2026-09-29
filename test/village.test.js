import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { makeCtx, simulate } from '../src/sim/tick.js';
import { village, fieldThreat } from '../src/sim/systems/village.js';

const endOfDay = (state) => ({ ...makeCtx(state, 24), dayEnd: true, dayStart: false });

test('un champ menacé et non gardé perd 20 à 50 % de sa part, jamais tout', () => {
  const s = createWorld(42);
  for (const z of s.zones) if (!z.isVillage) z.monsterPressure = 90;
  const events = village(s, createRng(3), endOfDay(s));
  const losses = events.filter((e) => e.type === 'harvest_loss');
  assert.equal(losses.length, 4);
  for (const l of losses) {
    assert.ok(l.data.lossPct >= 20 && l.data.lossPct <= 50);
    assert.ok(l.data.fix);
  }
  // Une partie de la récolte arrive quand même au boulanger (20 de départ - 10 mangés + la farine du jour).
  assert.ok(s.village.jobs.boulanger.stock.pain > 10);
});

test('un champ gardé ne perd rien', () => {
  const s = createWorld(42);
  for (const z of s.zones) if (!z.isVillage) z.monsterPressure = 90;
  for (const f of s.zones.filter((z) => z.isField)) f.today.visits = 2;
  const events = village(s, createRng(3), endOfDay(s));
  assert.equal(events.filter((e) => e.type === 'harvest_loss').length, 0);
});

test('un métier ne descend jamais sous le niveau 1', () => {
  const s = createWorld(42);
  for (const z of s.zones) if (!z.isVillage) z.monsterPressure = 100;
  const { state } = simulate(s, createRng(1), { days: 40 });
  for (const job of Object.values(state.village.jobs)) {
    assert.ok(job.level >= 1 && job.level <= 5);
    for (const v of Object.values(job.stock)) assert.ok(v >= 0 && v <= 100);
  }
});

test('perdre un niveau prend plusieurs jours de négligence', () => {
  const s = createWorld(42);
  for (const z of s.zones) if (!z.isVillage) z.monsterPressure = 100;
  const { events } = simulate(s, createRng(1), { days: 2 });
  assert.equal(events.filter((e) => e.type === 'level_down').length, 0);
});

test('un niveau perdu se regagne en un jour d\'aide', () => {
  const s = createWorld(42);
  const job = s.village.jobs.boulanger;
  job.level = 1;
  job.maxLevel = 3;
  job.satisfaction = 70;
  job.helpedDay = s.day;
  const events = village(s, createRng(1), endOfDay(s));
  assert.ok(events.some((e) => e.type === 'level_up' && e.data.job === 'boulanger' && e.data.regained));
  assert.equal(job.level, 2);
});

test('fieldThreat tient compte des terres qui bordent le champ', () => {
  const s = createWorld(42);
  const f = s.zones.find((z) => z.isField);
  f.monsterPressure = 0;
  const wild = s.zones.find((z) => !z.isField && !z.isVillage && Math.abs(z.x - f.x) <= 1 && Math.abs(z.y - f.y) <= 1);
  wild.monsterPressure = 77;
  assert.equal(fieldThreat(s, f), 77);
});
