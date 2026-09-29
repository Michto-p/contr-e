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

test('le rythme de vie se règle : à une saison par jour, on vieillit quatre fois moins vite', () => {
  const run2 = (yearsPerDay) => {
    const w = createWorld(42, { yearsPerDay });
    const rng = createRng(42);
    addPlayers(w, rng, 'aucun');
    return simulate(w, rng, { days: 8 });
  };
  const fast = run2(1).state.village.population.people.find((p) => p.id === 1);
  const slow = run2(0.25).state.village.population.people.find((p) => p.id === 1);
  const start = createPopulation(42).people.find((p) => p.id === 1).age;
  assert.equal(fast.age - start, 8);
  assert.equal(slow.age - start, 2);
});

test('les habitants gardent leurs dates de naissance et de décès (pour l\'arbre des familles)', () => {
  const { state } = run('mixte', 60);
  const pop = state.village.population;
  const dead = pop.people.filter((p) => !p.alive);
  assert.ok(dead.length > 0);
  for (const p of dead) assert.ok(Number.isInteger(p.died) && p.died > p.born);
  for (const p of pop.people.filter((q) => q.parents.length && q.born > 1)) {
    for (const id of p.parents) assert.ok(pop.people.find((q) => q.id === id).born < p.born);
  }
});

test('l\'audacieux part défendre les champs, le curieux explore', () => {
  const s = createWorld(42);
  const pop = s.village.population;
  for (const p of pop.people) if (p.age >= ADULT && p.metier !== 'ancien') p.traits = ['audacieux', 'curieux'];
  for (const z of s.zones) if (!z.isVillage && !z.isField && z.dist === 2) z.monsterPressure = 60;
  let events = [];
  for (let d = 0; d < 10; d++) {
    const ctx = { ...makeCtx(s, 24), hour: 9, dayEnd: false };
    events = events.concat(population(s, createRng(d + 1), ctx));
  }
  assert.ok(events.some((e) => e.type === 'villager_defense' || e.type === 'villager_hurt'));
  assert.ok(events.some((e) => e.type === 'villager_explore' || e.type === 'villager_found'));
  const out = pop.people.find((p) => p.outing);
  assert.ok(out, 'un habitant est dehors');
  population(s, createRng(99), { ...makeCtx(s, 24), hour: 18, dayEnd: false });
  assert.ok(!pop.people.some((p) => p.outing), 'tout le monde est rentré le soir');
});

test('les habitants partent travailler hors du village et y dressent des avant-postes', () => {
  const rng = createRng(42);
  const { state, events } = simulate(createWorld(42), rng, { days: 30 });
  assert.ok(events.some((e) => e.type === 'outpost_built'), 'au moins un avant-poste en un mois');
  // Le matin suivant, à 9 h : des habitants partent aux champs, aux bois ou aux pâtures.
  const ctx = { ...makeCtx(state, 24), hour: 9, dayEnd: false };
  population(state, rng, ctx);
  const out = alive(state).filter((p) => p.outing?.kind === 'travail');
  assert.ok(out.length >= 2, `${out.length} au travail`);
  for (const p of out) {
    const z = state.zones[p.outing.zone];
    assert.ok(!z.isVillage);
    assert.ok(['agriculteur', 'bucheron_mineur', 'eleveur'].includes(p.metier));
    assert.ok(z.today.workers >= 1);
  }
});

test('un avant-poste abaisse le plafond de monstres de sa zone', async () => {
  const { capacity } = await import('../src/sim/systems/monsters.js');
  const z = createWorld(42).zones.find((x) => x.dist === 3);
  const before = capacity(z);
  z.structures.push({ type: 'avant-poste', condition: 80 });
  assert.ok(capacity(z) < before);
});

test('des voyageurs s\'égarent : un habitant curieux les ramène, ou ils reprennent leur route', () => {
  const { events } = simulate(createWorld(42), createRng(42), { days: 60 });
  const seen = events.filter((e) => e.type === 'wanderer_seen');
  const outcome = events.filter((e) => e.type === 'wanderer_rescued' || e.type === 'wanderer_gone');
  assert.ok(seen.length >= 2, `${seen.length} égarés`);
  assert.ok(outcome.length >= seen.length - 1); // le dernier peut encore attendre
  for (const e of seen) assert.equal(e.data.fix, 'ramener');
});

test('un personnage de joueur avec une maison fonde une famille ; ses enfants portent son nom', async () => {
  const { createHero, setFoyer } = await import('../src/sim/systems/population.js');
  const w = createWorld(42);
  const h = createHero(w, { prenom: 'Paul', metier: 'forgeron', owner: 'Alix' }, makeCtx(w, 24)).person;
  const without = simulate(structuredClone(w), createRng(1), { days: 20 }).state.village.population.people.find((p) => p.prenom === 'Paul' && p.hero);
  assert.equal(without.partner, null, 'sans maison, pas de famille');
  // Avec une maison, il trouve quelqu'un au village.
  setFoyer(w, 'Alix');
  w.village.population.houses = 40; // de la place pour tout le monde : on ne teste ici que la famille
  let state = w;
  const rng = createRng(1);
  for (let d = 0; d < 60 && !state.village.population.people.find((p) => p.id === h.id).partner; d++) {
    state = simulate(state, rng, { days: 1 }).state;
  }
  const paul = state.village.population.people.find((p) => p.id === h.id);
  assert.ok(paul.partner, 'en couple');
  assert.equal(paul.age, h.age, 'il ne vieillit pas');
  // Un couple jeune, du pain en réserve : des enfants, qui portent le nom du joueur.
  const kidsOf = (st) => st.village.population.people.filter((p) => p.parents.includes(paul.id));
  for (let d = 0; d < 60 && !kidsOf(state).length; d++) {
    const partner = state.village.population.people.find((p) => p.id === paul.partner);
    partner.age = 25; // le conjoint, lui, vieillit : on le garde jeune pour ce test
    partner.lastChild = null;
    state.village.jobs.boulanger.stock.pain = Math.max(state.village.jobs.boulanger.stock.pain, 40);
    state = simulate(state, rng, { days: 1 }).state;
  }
  const kids = state.village.population.people.filter((p) => p.parents.includes(paul.id));
  assert.ok(kids.length >= 1, `${kids.length} enfant(s)`);
  for (const k of kids) assert.equal(k.famille, 'Alix');
});
