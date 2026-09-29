import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { makeCtx, simulate } from '../src/sim/tick.js';
import { addPlayers, agentsAct } from '../src/sim/agents.js';
import { population, createPopulation, workforceFactor, ADULT, JOB_SKILL } from '../src/sim/systems/population.js';

const endOfDay = (state) => ({ ...makeCtx(state, 24), dayEnd: true });
const alive = (s) => s.village.population.people.filter((p) => p.alive);

function run(scenario, days, seed = 42) {
  const w = createWorld(seed);
  const rng = createRng(seed);
  addPlayers(w, rng, scenario);
  return simulate(w, rng, { days, beforeTick: agentsAct });
}

test('le village de départ : des foyers, des enfants, des anciens, tous les métiers', () => {
  const pop = createPopulation(42);
  const people = pop.people;
  assert.ok(people.length >= 12);
  assert.ok(people.some((p) => p.age < ADULT));
  assert.ok(people.some((p) => p.metier === 'ancien'));
  for (const job of Object.keys(JOB_SKILL)) assert.ok(people.some((p) => p.metier === job), job);
  for (const p of people) {
    assert.equal(p.traits.length, 2);
    assert.notEqual(p.traits[0], p.traits[1]);
    if (p.partner) assert.equal(people.find((q) => q.id === p.partner).partner, p.id);
  }
  assert.deepEqual(createPopulation(42), pop, 'déterministe');
});

test('la production d\'un métier dépend de ceux qui l\'exercent', () => {
  const w = createWorld(42);
  const f = workforceFactor(w, 'forgeron');
  assert.ok(f >= 0.6 && f <= 1.5);
  for (const p of w.village.population.people) if (p.metier === 'forgeron') p.skills.forge = 100;
  assert.ok(workforceFactor(w, 'forgeron') > f);
});

test('des enfants naissent, grandissent et prennent un métier, souvent celui de la famille', () => {
  const { state, events } = run('assidus', 40);
  const births = events.filter((e) => e.type === 'birth');
  const grown = events.filter((e) => e.type === 'coming_of_age');
  assert.ok(births.length >= 5, `naissances : ${births.length}`);
  assert.ok(grown.length >= 3);
  assert.ok(grown.some((e) => e.data.heir), 'au moins un reprend le flambeau familial');
  // Les nouveau-nés portent le nom d'un parent.
  const pop = state.village.population;
  const born = pop.people.filter((p) => p.parents.length && p.age < 40);
  for (const c of born) {
    const names = c.parents.map((id) => pop.people.find((q) => q.id === id).famille);
    assert.ok(names.includes(c.famille));
  }
});

test('un enfant apprend le métier de ses parents', () => {
  const s = createWorld(42);
  const pop = s.village.population;
  const child = pop.people.find((p) => p.age < 10 && p.parents.length);
  const parent = pop.people.find((p) => p.id === child.parents[0]);
  const skill = JOB_SKILL[parent.metier] ?? 'savoir';
  const before = child.skills[skill];
  population(s, createRng(1), endOfDay(s));
  assert.ok(child.skills[skill] > before);
});

test('le village ne disparaît jamais : des familles arrivent quand il se vide', () => {
  const s = createWorld(42);
  for (const p of s.village.population.people) if (p.age >= ADULT) p.alive = false;
  const events = population(s, createRng(1), endOfDay(s));
  assert.ok(events.some((e) => e.type === 'newcomers'));
  assert.ok(alive(s).filter((p) => p.age >= ADULT).length >= 2);
});

test('la population reste bornée par la nourriture', () => {
  for (const sc of ['assidus', 'absents']) {
    const { state } = run(sc, 90, 7);
    const n = alive(state).length;
    assert.ok(n >= 4 && n <= 60, `${sc} : ${n}`);
  }
});

test('avec des ressources rares rapportées, un forgeron savant invente un plan', () => {
  const s = createWorld(42);
  const pop = s.village.population;
  for (const p of pop.people) if (p.metier === 'forgeron') p.skills.savoir = 80;
  const rare = s.signature.exclusives[0];
  pop.rares[rare] = 4;
  let events = [];
  for (let d = 0; d < 20 && !pop.plans.length; d++) events = events.concat(population(s, createRng(d + 1), endOfDay(s)));
  assert.ok(pop.plans.length >= 1, 'un plan inventé');
  assert.equal(pop.plans[0].materiau, rare);
  assert.equal(pop.plans[0].contree, s.name);
  assert.ok(events.some((e) => e.type === 'invention'));
});

test('l\'agronome et l\'éleveur défrichent un pré voisin quand le pain manque', () => {
  const s = createWorld(42);
  const pop = s.village.population;
  for (const p of pop.people) {
    if (p.metier === 'agriculteur') p.skills.culture = 90;
    if (p.metier === 'eleveur') p.skills.elevage = 90;
  }
  s.village.jobs.boulanger.stock.pain = 0;
  for (const z of s.zones) if (z.dist <= 2) z.monsterPressure = 0;
  const before = s.zones.filter((z) => z.isField).length;
  let events = [];
  for (let d = 0; d < 40 && s.zones.filter((z) => z.isField).length === before; d++) {
    s.village.jobs.boulanger.stock.pain = 0;
    events = events.concat(population(s, createRng(d + 7), endOfDay(s)));
  }
  assert.equal(s.zones.filter((z) => z.isField).length, before + 1);
  const e = events.find((x) => x.type === 'new_field');
  assert.ok(e);
  assert.match(s.zones[e.zone].label, /^les champs/);
});
