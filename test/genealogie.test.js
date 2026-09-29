import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { simulate } from '../src/sim/tick.js';
import { addPlayers, agentsAct } from '../src/sim/agents.js';
import { buildTrees, describe } from '../shared/genealogie.js';

function people(days) {
  const w = createWorld(42);
  const rng = createRng(42);
  addPlayers(w, rng, 'assidus');
  const { state } = simulate(w, rng, { days, beforeTick: agentsAct });
  return state.village.population.people.map((q) => ({
    id: q.id, prenom: q.prenom, famille: q.famille, parents: q.parents, partenaire: q.partner, age: q.age,
    vivant: q.alive, ne: q.born, mort: q.died, metier: q.alive ? q.metier : (q.ancienMetier ?? q.metier), talent: q.talent,
  }));
}

test('chaque habitant apparaît une seule fois dans l\'arbre des familles', () => {
  const list = people(40);
  const trees = buildTrees(list);
  const seen = [];
  const partners = [];
  const walk = (n) => { seen.push(n.person.id); if (n.partner) partners.push(n.partner.id); n.children.forEach(walk); };
  trees.forEach(walk);
  assert.equal(new Set(seen).size, seen.length, 'pas de doublon');
  // Tous les descendants de fondateurs sont rattachés à un parent.
  const inTree = new Set([...seen, ...partners]);
  for (const p of list) if (p.parents.length) assert.ok(inTree.has(p.id), p.prenom);
});

test('trois générations apparaissent au bout de quelques dizaines de jours', () => {
  const trees = buildTrees(people(45));
  const depth = (n) => 1 + Math.max(0, ...n.children.map(depth));
  assert.ok(Math.max(...trees.map(depth)) >= 3);
});

test('description lisible d\'un habitant vivant ou disparu', () => {
  assert.match(describe({ prenom: 'Iris', famille: 'Roux', vivant: true, age: 34, metier: 'forgeron', talent: 'inventeur' }), /Iris Roux \(34 ans, à la forge, inventeur\)/);
  assert.match(describe({ prenom: 'Anselme', famille: 'Faure', vivant: false, mort: 12, metier: 'agriculteur' }), /✝ jour 12/);
});

test('un couple dont un membre est mort reste un couple dans l\'arbre', () => {
  const list = [
    { id: 1, prenom: 'A', famille: 'X', parents: [], partenaire: 2, vivant: false, ne: -40, mort: 5 },
    { id: 2, prenom: 'B', famille: 'X', parents: [], partenaire: null, vivant: false, ne: -45, mort: 9 },
    { id: 3, prenom: 'C', famille: 'X', parents: [1, 2], partenaire: null, vivant: true, ne: -10, age: 12 },
  ];
  const trees = buildTrees(list);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].children.length, 1);
  assert.deepEqual([trees[0].person.id, trees[0].partner.id].sort(), [1, 2]);
});
