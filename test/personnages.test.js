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

test('compétences : 100 points par la classe et le métier, 10 points libres, secret de classe', async () => {
  const { computeSkills, FREE_POINTS } = await import('../shared/competences.js');
  const sum = (s) => Object.values(s).reduce((a, b) => a + b, 0);
  const plain = computeSkills('eclaireur', 'forgeron');
  assert.equal(sum(plain.skills), 100);
  assert.equal(plain.secret, '');
  const free = computeSkills('eclaireur', 'forgeron', { force: 6, flair: 4 });
  assert.equal(sum(free.skills), 100 + FREE_POINTS);
  assert.throws(() => computeSkills('eclaireur', 'forgeron', { force: 11 }), /10 points libres/);
  assert.throws(() => computeSkills('eclaireur', 'forgeron', { force: -2 }), /invalides/);
  const secret = computeSkills('guerrier', 'garde');
  assert.equal(secret.secret, 'Rempart du village');
  assert.ok(sum(secret.skills) > 100);
});

test('à la création, la classe, les points libres et le secret sont appliqués au personnage', async () => {
  const r = await join({ joueur: 'Bea', nouveau: { prenom: 'Rune', metier: 'garde', classe: 'guerrier', libres: { force: 10 } } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Rune'));
  const p = room().state.joueurs.get(r.sessionId);
  assert.equal(p.classe, 'guerrier');
  assert.equal(p.secret, 'Rempart du village');
  assert.equal(p.force, 25 + 15 + 10 + 10);
  assert.ok(p.pvMax > 10, `${p.pvMax} PV`);
  await assert.rejects(join({ joueur: 'Bea', nouveau: { prenom: 'Triche', metier: 'garde', classe: 'guerrier', libres: { force: 50 } } }), /10 points libres/);
  await r.leave();
});

test('on commence à l\'auberge ; on bâtit sa maison, dont le coffre sert à tous ses personnages', async () => {
  const { ZONE_TILES, INN_DOOR, houseDoor } = await import('../shared/monde.js');
  const { HOUSE_COST, HOUSE_WOOD } = await import('../server/maisons.js');
  const sim = room().sim;
  const v = sim.zones[sim.villageId];
  const r = await join({ joueur: 'Cleo', nouveau: { prenom: 'Iris', metier: 'forgeron', classe: 'gardien' } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Iris'));
  const p = room().state.joueurs.get(r.sessionId);
  assert.ok(Math.hypot(p.x - (v.x * ZONE_TILES + INN_DOOR[0]), p.y - (v.y * ZONE_TILES + INN_DOOR[1])) < 1.5, 'à l\'auberge');
  // Devant un terrain libre, avec de quoi bâtir.
  const lot = 0;
  const [dx, dy] = houseDoor(lot);
  p.x = v.x * ZONE_TILES + dx;
  p.y = v.y * ZONE_TILES + dy;
  p.sac.set('cuir', HOUSE_COST.cuir + 1);
  p.sac.set('minerai', HOUSE_COST.minerai);
  sim.village.jobs.bucheron_mineur.stock.bois = HOUSE_WOOD + 5;
  assert.ok(await until(() => p.action.startsWith('bâtir votre maison')), p.action);
  r.send('interagir');
  assert.ok(await until(() => room().players.Cleo.maison === lot), 'maison bâtie');
  assert.equal(room().state.maisons.get('0'), 'Cleo');
  assert.equal(p.sac.get('cuir'), 1);
  assert.ok(room().world.events.some((e) => e.type === 'house_player' && e.data.who === 'Cleo'));
  // Le coffre : on dépose le cuir restant.
  assert.ok(await until(() => p.action === 'ouvrir le coffre de votre maison'), p.action);
  r.send('coffre', { sens: 'deposer', objet: 'cuir' });
  assert.ok(await until(() => p.coffre.get('cuir') === 1 && !p.sac.has('cuir')), 'déposé');
  await r.leave();
  // Un autre personnage de Cléo arrive devant la maison et retrouve le coffre.
  const r2 = await join({ joueur: 'Cleo', nouveau: { prenom: 'Soren', metier: 'garde' } });
  assert.ok(await until(() => room().state.joueurs.get(r2.sessionId)?.nom === 'Soren'));
  const q = room().state.joueurs.get(r2.sessionId);
  assert.ok(Math.hypot(q.x - (v.x * ZONE_TILES + dx), q.y - (v.y * ZONE_TILES + dy)) < 1.5, 'devant sa maison');
  assert.equal(q.coffre.get('cuir'), 1);
  r2.send('coffre', { sens: 'retirer', objet: 'cuir' });
  assert.ok(await until(() => q.sac.get('cuir') === 1 && !q.coffre.has('cuir')), 'repris');
  await r2.leave();
});
