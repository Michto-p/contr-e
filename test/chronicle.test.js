import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChronicle, joinFr, joinPlaces, dePlaces, linesFor, dayLines } from '../src/chronicle/chronicle.js';
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

test('dePlaces met « de » devant chaque groupe de lieux', () => {
  assert.equal(dePlaces(['les marais du Nord', 'les prés du Sud', "les marais de l'Est"]), "des marais du Nord et de l'Est et des prés du Sud");
});

test('une nouvelle déjà racontée la veille est reformulée', () => {
  const ev = (day) => ({ day, tick: day * 24, type: 'path_lost', zone: day, data: { label: `les bois ${day}`, dist: 2 } });
  const first = dayLines([ev(1), ev(2)], 1)[0];
  const second = dayLines([ev(1), ev(2)], 2)[0];
  assert.match(first, /a disparu sous la végétation/);
  assert.match(second, /à son tour/);
});

test('les combats du jour tiennent en une ligne', () => {
  const evs = ['du Nord', "de l'Est", 'du Sud'].map((r, i) => ({ day: 1, tick: i, zone: i, type: 'monsters_pushed', data: { who: [`J${i}`], label: `les bois ${r}` } }));
  const lines = linesFor(evs);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /J0, J1 et J2 ont repoussé les monstres des bois du Nord, de l'Est et du Sud/);
});

test('un joueur à terre est raconté sans le punir', () => {
  const lines = linesFor([{ day: 1, tick: 3, zone: 5, type: 'player_down', data: { who: ['Dany'], label: 'les collines du Nord' } }]);
  assert.match(lines[0], /À bout de forces face aux monstres des collines du Nord, Dany a dû rentrer au village/);
});
