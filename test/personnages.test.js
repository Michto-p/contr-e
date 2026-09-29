// Personnages des joueurs : création, reprise, vie au village quand on ne les joue pas, abandon.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { Client } from '@colyseus/sdk';
import { createGameServer } from '../server/index.js';
import { workforceFactor } from '../src/sim/systems/population.js';

const dir = mkdtempSync(pathJoin(tmpdir(), 'contree-'));
let game;
let url;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (check()) return true;
    await sleep(10);
  }
  return false;
}

before(async () => {
  // Horloge très lente : le test déclenche les heures lui-même.
  game = await createGameServer({ port: 0, heureMs: 3_600_000, bots: 'aucun', graine: 5, fichier: pathJoin(dir, 'contree.json'), abandonJours: 30 });
  url = `http://localhost:${game.port}`;
});
after(async () => {
  await game.close();
  rmSync(dir, { recursive: true, force: true });
});

const room = () => game.room;
const persos = async (joueur) => (await fetch(`${url}/persos?joueur=${encodeURIComponent(joueur)}`)).json();
const hero = (name) => room().sim.village.population.people.find((p) => p.id === room().registry[name].hid);
const join = (options) => new Client(url).join('contree', options);

test('un joueur crée un personnage avec un métier ; laissé au village, il y travaille', async () => {
  assert.deepEqual((await persos('Alix')).persos, []);
  const before = workforceFactor(room().sim, 'forgeron');
  const r = await join({ joueur: 'Alix', nouveau: { prenom: 'Paul', metier: 'forgeron', couleur: 3 } });
  assert.ok(await until(() => r.state.joueurs?.get(r.sessionId)));
  const p = room().state.joueurs.get(r.sessionId);
  assert.equal(p.nom, 'Paul');
  assert.equal(p.joueur, 'Alix');
  assert.equal(p.couleur, 3);
  assert.equal(hero('Paul').metier, 'forgeron');
  assert.equal(hero('Paul').famille, 'Alix');
  assert.equal(hero('Paul').played, true, 'en jeu : il n\'est pas au village');
  assert.equal(workforceFactor(room().sim, 'forgeron'), before);
  const list = await persos('Alix');
  assert.equal(list.persos.length, 1);
  assert.equal(list.persos[0].enJeu, true);
  await r.leave();
  assert.ok(await until(() => hero('Paul').played === false), 'rendu au village');
  assert.ok(workforceFactor(room().sim, 'forgeron') > before, 'il travaille à la forge, avec un bonus');
  assert.ok(room().world.events.some((e) => e.type === 'hero_arrives' && e.data.prenom === 'Paul'));
});

test('on reprend son personnage à tout moment, pas celui d\'un autre', async () => {
  const r = await join({ joueur: 'Alix', perso: 'Paul' });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Paul'));
  await assert.rejects(join({ joueur: 'Alix', perso: 'Paul' }), /déjà en jeu/);
  await assert.rejects(join({ joueur: 'Bea', perso: 'Paul' }), /pas \(ou plus\)/);
  await assert.rejects(join({ joueur: 'Bea', nouveau: { prenom: 'Paul' } }), /déjà pris/);
  await r.leave();
});

test('trois personnages au plus par joueur', async () => {
  for (const prenom of ['Lina', 'Marius']) {
    const r = await join({ joueur: 'Alix', nouveau: { prenom, metier: 'garde' } });
    await r.leave();
  }
  assert.equal((await persos('Alix')).persos.length, 3);
  await assert.rejects(join({ joueur: 'Alix', nouveau: { prenom: 'Odon' } }), /déjà 3 personnages/);
});

test('délaissé trop longtemps, un personnage reste au village pour de bon', async () => {
  room().registry.Paul.lastPlayedAt = Date.now() - 31 * 24 * 3600 * 1000;
  room().gameHour();
  assert.equal(room().registry.Paul.perdu, true);
  const h = room().sim.village.population.people.find((p) => p.prenom === 'Paul' && p.ancienHeros === 'Alix');
  assert.ok(h, 'toujours au village');
  assert.equal(h.hero, null);
  assert.ok(room().world.events.some((e) => e.type === 'hero_settles' && e.data.prenom === 'Paul'));
  const list = await persos('Alix');
  assert.deepEqual(list.persos.map((p) => p.nom).sort(), ['Lina', 'Marius']);
  assert.deepEqual(list.perdus, ['Paul']);
  await assert.rejects(join({ joueur: 'Alix', perso: 'Paul' }), /pas \(ou plus\)/);
  // Une place s'est libérée : Alix peut créer un nouveau personnage.
  const r = await join({ joueur: 'Alix', nouveau: { prenom: 'Odon', metier: 'eleveur' } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Odon'));
  await r.leave();
});

test('une ancienne sauvegarde : chaque nom devient un joueur avec un personnage du même nom', async () => {
  const { initAccounts } = await import('../server/personnages.js');
  const world = { registry: { Lou: { lastDay: 4, gear: { epee: 2 } } }, sim: { village: { population: { people: [{ id: 1, played: true }] } } } };
  initAccounts(world, 1000);
  assert.deepEqual(world.players.Lou, { persos: ['Lou'], lastDay: 4 });
  assert.equal(world.registry.Lou.owner, 'Lou');
  assert.equal(world.registry.Lou.lastPlayedAt, 1000, 'le compte à rebours part du chargement');
  assert.equal(world.sim.village.population.people[0].played, false, 'personne n\'est en jeu au démarrage');
});
