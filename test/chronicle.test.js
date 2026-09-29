import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChronicle, joinFr, joinPlaces, linesFor } from '../src/chronicle/chronicle.js';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { simulate } from '../src/sim/tick.js';

test('joinFr et joinPlaces', () => {
  assert.equal(joinFr(['a']), 'a');
  assert.equal(joinFr(['a', 'b', 'c']), 'a, b et c');
  assert.equal(joinPlaces(['les champs du Nord', "les champs de l'Est"]), "les champs du Nord et de l'Est");
  assert.equal(joinPlaces(['les bois du Sud', 'les marais du Sud']), 'les bois du Sud et les marais du Sud');
});

test('les events semblables du même jour sont regroupés en une ligne', () => {
  const evs = ['du Nord', "de l'Est"].map((r, i) => ({ day: 1, tick: i, type: 'path_lost', data: { label: `les bois ${r}` } }));
  const lines = linesFor(evs);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /bois du Nord et de l'Est/);
});

test('les events les plus importants passent en premier, 8 lignes max', () => {
  const evs = [];
  for (let i = 0; i < 12; i++) {
    evs.push({ day: 1, tick: i, type: 'structure_decay', data: { label: `les bois ${i}`, structure: 'pont', level: i % 2 ? 'ruine' : 'abimee', condition: 0 } });
    evs.push({ day: 1, tick: i, type: 'path_formed', data: { label: `les prés ${i}` } });
  }
  const lines = linesFor(evs);
  assert.ok(lines.length <= 8);
  assert.match(lines[0], /ruine/);
});

test('pas de chiffres bruts sans --debug', () => {
  const { events } = simulate(createWorld(42), createRng(42), { days: 7 });
  const text = formatChronicle(events);
  const body = text.split('\n').filter((l) => l.startsWith('- ')).join('\n');
  assert.doesNotMatch(body, /\d/);
});

test('chaque jour apparaît dans la chronique', () => {
  const { events } = simulate(createWorld(42), createRng(42), { days: 7 });
  const text = formatChronicle(events, { days: 7 });
  for (let d = 1; d <= 7; d++) assert.match(text, new RegExp(`## Jour ${d}\\b`));
});

test('--since résume la période manquée', () => {
  const { events } = simulate(createWorld(42), createRng(42), { days: 7 });
  const text = formatChronicle(events, { since: 3, days: 7 });
  assert.match(text, /Pendant votre absence \(jours 3 à 7\)/);
  const lines = text.split('\n').filter((l) => l.startsWith('- '));
  assert.ok(lines.length >= 1 && lines.length <= 8);
});
