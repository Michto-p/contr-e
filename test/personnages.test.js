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
  const { ZONE_TILES, INN_DOOR, houseDoor, ROOM_FURNITURE } = await import('../shared/monde.js');
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
  // On entre chez soi, on va au coffre et on y dépose le cuir restant.
  assert.ok(await until(() => p.action === 'entrer chez vous'), p.action);
  await sleep(700); // une action à la fois (délai de la touche E)
  r.send('interagir');
  assert.ok(await until(() => p.interieur === lot), 'à l\'intérieur');
  [p.x, p.y] = ROOM_FURNITURE.coffre;
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
  q.interieur = lot; // on le fait entrer, devant le coffre
  [q.x, q.y] = ROOM_FURNITURE.coffre;
  r2.send('coffre', { sens: 'retirer', objet: 'cuir' });
  assert.ok(await until(() => q.sac.get('cuir') === 1 && !q.coffre.has('cuir')), 'repris');
  await r2.leave();
});

test('chacun travaille selon son métier : l\'agriculteur récolte, le boulanger cuit le pain', async () => {
  const { ZONE_TILES } = await import('../shared/monde.js');
  const sim = room().sim;
  const r = await join({ joueur: 'Dora', nouveau: { prenom: 'Blé', metier: 'agriculteur', classe: 'herboriste' } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Blé'));
  const p = room().state.joueurs.get(r.sessionId);
  const field = sim.zones.find((z) => z.isField);
  p.x = (field.x + 0.3) * ZONE_TILES;
  p.y = (field.y + 0.3) * ZONE_TILES;
  assert.ok(await until(() => p.action === 'récolter le blé'), p.action);
  const before = sim.village.jobs.agriculteur.stock.ble ?? 0;
  r.send('interagir');
  assert.ok(await until(() => (room().sim.village.jobs.agriculteur.stock.ble ?? 0) > before), 'blé récolté');
  await r.leave();
  const r2 = await join({ joueur: 'Dora', nouveau: { prenom: 'Mie', metier: 'boulanger', classe: 'herboriste' } });
  assert.ok(await until(() => room().state.joueurs.get(r2.sessionId)?.nom === 'Mie'));
  const q = room().state.joueurs.get(r2.sessionId);
  const v = sim.zones[sim.villageId];
  q.x = v.x * ZONE_TILES + 8; // sur la place, loin des terrains à bâtir
  q.y = v.y * ZONE_TILES + 9.5;
  room().sim.village.jobs.agriculteur.stock.ble = 10;
  const pain = room().sim.village.jobs.boulanger.stock.pain ?? 0;
  assert.ok(await until(() => q.action.startsWith('cuire du pain')), q.action);
  r2.send('interagir');
  assert.ok(await until(() => (room().sim.village.jobs.boulanger.stock.pain ?? 0) > pain), 'pain cuit');
  assert.equal(room().sim.village.jobs.agriculteur.stock.ble, 8);
  await r2.leave();
});

test('faim et fatigue : le pain apaise la faim, une nuit à l\'auberge efface la fatigue', async () => {
  const { ZONE_TILES, INN_DOOR } = await import('../shared/monde.js');
  const sim = room().sim;
  const v = sim.zones[sim.villageId];
  const r = await join({ joueur: 'Eli', nouveau: { prenom: 'Nox', metier: 'garde', classe: 'gardien' } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Nox'));
  const p = room().state.joueurs.get(r.sessionId);
  assert.equal(p.faim, 0);
  // Affamé : pas de récupération naturelle.
  p.faim = 85;
  p.pv = p.pvMax - 2;
  room().play.regenAt.set(r.sessionId, 0);
  await sleep(1300);
  assert.equal(p.pv, p.pvMax - 2, 'le ventre creux, on ne récupère pas');
  sim.village.jobs.boulanger.stock.pain = 5;
  r.send('manger');
  assert.ok(await until(() => p.faim === 50), `faim ${p.faim}`);
  // Fatigué : on dort à l'auberge.
  p.fatigue = 80;
  p.x = v.x * ZONE_TILES + INN_DOOR[0];
  p.y = v.y * ZONE_TILES + INN_DOOR[1];
  assert.ok(await until(() => p.action === 'dormir à l\'auberge'), p.action);
  r.send('interagir');
  assert.ok(await until(() => p.fatigue === 0), 'reposé');
  await r.leave();
});

test('chez soi : un lit pour dormir, un panier pour adopter un compagnon, une porte pour sortir', async () => {
  const { ROOM_FURNITURE } = await import('../shared/monde.js');
  const r = await join({ joueur: 'Cleo', perso: 'Iris' });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Iris'));
  const p = room().state.joueurs.get(r.sessionId);
  r.send('interagir'); // elle apparaît devant sa porte
  assert.ok(await until(() => p.interieur >= 0), 'entrée');
  const flair = p.flair;
  [p.x, p.y] = ROOM_FURNITURE.panier;
  assert.ok(await until(() => p.action === 'adopter un chien'), p.action);
  await sleep(700);
  r.send('interagir');
  assert.ok(await until(() => p.compagnon === 'chien'));
  assert.equal(p.flair, flair + 5);
  p.fatigue = 50;
  [p.x, p.y] = ROOM_FURNITURE.lit;
  assert.ok(await until(() => p.action === 'dormir dans votre lit'), p.action);
  await sleep(700);
  r.send('interagir');
  assert.ok(await until(() => p.fatigue === 0), 'reposée');
  [p.x, p.y] = ROOM_FURNITURE.porte;
  assert.ok(await until(() => p.action === 'sortir'), p.action);
  await sleep(700);
  r.send('interagir');
  assert.ok(await until(() => p.interieur === -1), 'sortie');
  await r.leave();
  assert.equal(room().registry.Iris.compagnon, 'chien', 'le compagnon est gardé');
});

test('une maison abandonnée devient un repaire ; on la remet en état', async () => {
  const { villagerHouseTile } = await import('../shared/monde.js');
  const sim = room().sim;
  const geo = { villageId: sim.villageId, width: sim.width, faubourgs: sim.village.faubourgs ?? [] };
  sim.village.ruines = [{ id: 99, kind: 'maison', index: 2, condition: 30 }];
  const houses = sim.village.population.houses;
  const r = await join({ joueur: 'Fey', nouveau: { prenom: 'Orin', metier: 'garde', classe: 'guerrier' } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Orin'));
  const p = room().state.joueurs.get(r.sessionId);
  const [tx, ty] = villagerHouseTile(2, geo);
  p.x = tx + 0.5;
  p.y = ty + 1.3;
  // Un repaire : des bêtes en sortent, en plein village.
  assert.ok(await until(() => [...room().play.monsters.values()].some((d) => d.ruin === 99), 3000), 'une bête sort du repaire');
  assert.ok(await until(() => p.action.startsWith('remettre en état')), p.action);
  sim.village.jobs.bucheron_mineur.stock.bois = 50;
  for (let i = 0; i < 4; i++) { r.send('interagir'); await sleep(700); }
  assert.ok(await until(() => !(room().sim.village.ruines ?? []).some((x) => x.id === 99)), 'remise en état');
  assert.equal(room().sim.village.population.houses, houses + 1, 'une famille peut s\'y installer');
  assert.ok(room().world.events.some((e) => e.type === 'ruin_restored' && e.data.who.includes('Orin')));
  await r.leave();
});

test('la maison d\'un joueur qu\'on ne voit plus est laissée à l\'abandon', async () => {
  const lot = room().players.Cleo.maison;
  assert.ok(lot != null, 'Cléo a une maison');
  for (const e of Object.values(room().registry)) if (e.owner === 'Cleo') e.lastPlayedAt = Date.now() - 31 * 24 * 3600 * 1000;
  room().gameHour();
  assert.equal(room().players.Cleo.maison, null);
  assert.ok(room().sim.village.ruines.some((r) => r.kind === 'lot' && r.index === lot && r.owner === 'Cleo'));
  assert.ok(!room().state.maisons.has(String(lot)));
  assert.ok(room().world.events.some((e) => e.type === 'house_abandoned' && e.data.owner === 'Cleo'));
});

test('chez soi, on aménage : sol, murs, meubles déplacés, décorations fabriquées', async () => {
  const { lotDoor } = await import('../shared/monde.js');
  const { freeLot, geoOf } = await import('../server/maisons.js');
  const sim = room().sim;
  const r = await join({ joueur: 'Gus', nouveau: { prenom: 'Tobie', metier: 'forgeron', classe: 'gardien' } });
  assert.ok(await until(() => room().state.joueurs.get(r.sessionId)?.nom === 'Tobie'));
  const p = room().state.joueurs.get(r.sessionId);
  const lot = freeLot(room());
  [p.x, p.y] = lotDoor(lot, geoOf(room()));
  p.sac.set('cuir', 6);
  p.sac.set('minerai', 4);
  sim.village.jobs.bucheron_mineur.stock.bois = 40;
  assert.ok(await until(() => p.action.startsWith('bâtir votre maison')), p.action);
  r.send('interagir');
  assert.ok(await until(() => room().players.Gus.maison === lot));
  await sleep(700);
  r.send('interagir'); // entrer
  assert.ok(await until(() => p.interieur === lot));
  r.send('amenager', { sol: 'pierre' });
  r.send('amenager', { mur: 2 });
  r.send('amenager', { deplacer: 'lit', x: 8.2, y: 5.1 });
  r.send('amenager', { fabriquer: 'plante' });
  r.send('amenager', { fabriquer: 'tapis' });
  const lay = () => JSON.parse(room().state.interieurs.get(String(lot)) ?? '{}');
  assert.ok(await until(() => lay().deco?.length === 2), JSON.stringify(lay()));
  assert.equal(lay().sol, 'pierre');
  assert.equal(lay().mur, 2);
  assert.deepEqual(lay().meubles.lit, [8, 5]);
  assert.ok(!p.sac.has('cuir'), 'la maison a coûté 4 cuir, le tapis 2');
  // Le lit a bougé : on y dort à sa nouvelle place.
  p.fatigue = 40;
  [p.x, p.y] = [8, 5];
  assert.ok(await until(() => p.action === 'dormir dans votre lit'), p.action);
  await r.leave();
});
