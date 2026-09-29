// Butin, forge, pain, roulade, cracheurs et ressources rares, avec de vrais clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { Client } from '@colyseus/sdk';
import { createGameServer } from '../server/index.js';
import { Monstre } from '../server/schema.js';
import { ZONE_TILES } from '../shared/monde.js';
import { EAT_HEAL, EAT_COOLDOWN_MS } from '../server/objets.js';

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
  game = await createGameServer({ port: 0, heureMs: 3_600_000, bots: 'aucun', graine: 11, fichier: pathJoin(dir, 'contree.json') });
  url = `http://localhost:${game.port}`;
});
after(async () => {
  await game.close();
  rmSync(dir, { recursive: true, force: true });
});

const room = () => game.room;
const village = () => room().sim.zones[room().sim.villageId];
async function join(nom) {
  const r = await new Client(url).join('contree', { nom });
  const inbox = { annonce: [], info: [] };
  for (const type of ['monde', 'chronique', 'bienvenue', 'absence']) r.onMessage(type, (m) => { inbox[type] = m; });
  r.onMessage('annonce', (m) => inbox.annonce.push(m));
  r.onMessage('info', (m) => inbox.info.push(m));
  await until(() => room().state.joueurs.has(r.sessionId));
  return { r, inbox, p: () => room().state.joueurs.get(r.sessionId) };
}
function place(p, zone, dx = 0, dy = 0) {
  p.x = (zone.x + 0.5) * ZONE_TILES + dx;
  p.y = (zone.y + 0.5) * ZONE_TILES + dy;
}
let mid = 0;
function spawnMonster(zone, x, y, kind) {
  const m = new Monstre();
  Object.assign(m, { sorte: kind.sorte, x, y, pv: kind.pv, pvMax: kind.pv, coup: 0, touche: 0 });
  const id = `t${mid++}`;
  room().state.monstres.set(id, m);
  room().play.monsters.set(id, { zone: zone.id, kind: { vitesse: 0, cadence: 1e9, degats: 1, ...kind }, goal: { x, y }, nextGoal: Infinity, lastHit: 0 });
  return id;
}
function clearMonsters() {
  for (const id of [...room().play.monsters.keys()]) { room().play.monsters.delete(id); room().state.monstres.delete(id); }
}
const wildZone = () => room().sim.zones.find((z) => z.dist === 2 && !z.closed && !z.isField);

test('une brute vaincue lâche du cuir, qu\'on ramasse en marchant dessus', async () => {
  clearMonsters();
  const a = await join('Alix');
  const zone = wildZone();
  zone.monsterPressure = 20;
  place(a.p(), zone);
  a.p().dir = 'droite';
  const id = spawnMonster(zone, a.p().x + 1, a.p().y, { sorte: 'brute', pv: 1 });
  a.r.send('attaque');
  assert.ok(await until(() => !room().state.monstres.has(id)));
  const loot = [...room().state.butins.values()].find((b) => b.sorte === 'cuir');
  assert.ok(loot, 'du cuir au sol');
  a.p().x = loot.x;
  a.p().y = loot.y;
  assert.ok(await until(() => (a.p().sac.get('cuir') ?? 0) >= 1), 'cuir ramassé');
  await a.r.leave();
});

test('la forge transforme le butin en épée, contre un outil du forgeron', async () => {
  clearMonsters();
  const b = await join('Bea');
  place(b.p(), village());
  b.p().sac.set('minerai', 3);
  b.p().sac.set('cuir', 1);
  const outils = room().sim.village.jobs.forgeron.stock.outils;
  b.r.send('fabriquer', { recette: 'epee2' });
  assert.ok(await until(() => b.p().epee === 2), 'épée niveau 2');
  assert.equal(room().sim.village.jobs.forgeron.stock.outils, outils - 1);
  assert.equal(b.p().sac.get('minerai') ?? 0, 0);
  assert.ok(room().world.events.some((e) => e.type === 'forged' && e.data.who.includes('Bea')));
  // Une épée de niveau 2 tue un monstre de 2 PV d'un seul coup.
  const zone = wildZone();
  place(b.p(), zone);
  b.p().dir = 'droite';
  const id = spawnMonster(zone, b.p().x + 1, b.p().y, { sorte: 'gluant', pv: 2 });
  await sleep(450);
  b.r.send('attaque');
  assert.ok(await until(() => !room().state.monstres.has(id)), 'vaincu d\'un coup');
  await b.r.leave();
});

test('l\'armure augmente la vie, et l\'équipement est gardé d\'une connexion à l\'autre', async () => {
  const c = await join('Cyan');
  place(c.p(), village());
  c.p().sac.set('cuir', 4);
  c.r.send('fabriquer', { recette: 'armure2' });
  assert.ok(await until(() => c.p().armure === 2));
  assert.equal(c.p().pvMax, 14);
  c.p().sac.set('minerai', 7);
  await c.r.leave();
  const again = await join('Cyan');
  assert.equal(again.p().armure, 2);
  assert.equal(again.p().pvMax, 14);
  assert.equal(again.p().sac.get('minerai'), 7);
  await again.r.leave();
});

test('le pain du boulanger soigne', async () => {
  const d = await join('Dany');
  place(d.p(), wildZone()); // hors du village, la vie ne remonte que lentement
  const stock = room().sim.village.jobs.boulanger.stock;
  stock.pain = 5;
  d.p().pv = 3;
  d.r.send('manger');
  assert.ok(await until(() => d.p().pv === 3 + EAT_HEAL));
  assert.equal(stock.pain, 4);
  await sleep(EAT_COOLDOWN_MS + 50);
  stock.pain = 0;
  d.p().pv = 3;
  d.r.send('manger');
  assert.ok(await until(() => d.inbox.info.some((m) => /Plus de pain/.test(m))));
  assert.equal(d.p().pv, 3);
  await d.r.leave();
});

test('un cracheur tire des projectiles ; la roulade les esquive', async () => {
  clearMonsters();
  const e = await join('Eden');
  const zone = wildZone();
  place(e.p(), zone, -3, 0);
  e.p().pv = 10;
  spawnMonster(zone, e.p().x + 4, e.p().y, { sorte: 'cracheur', pv: 2, cadence: 300 });
  assert.ok(await until(() => e.p().pv < 10, 3000), 'touché par un projectile');
  clearMonsters();

  // Roulade : on avance nettement plus vite pendant un court instant.
  place(e.p(), village());
  const x0 = e.p().x;
  e.r.send('deplacement', { x: 1, y: 0 });
  e.r.send('roulade');
  await sleep(260);
  e.r.send('deplacement', { x: 0, y: 0 });
  assert.ok(e.p().roulade >= 1);
  // Pendant la roulade, les coups ne portent pas.
  const { isDashing } = await import('../server/objets.js');
  room().objets.dashUntil.set(e.r.sessionId, Date.now() + 5000);
  assert.ok(isDashing(room(), e.r.sessionId));
  room().objets.dashUntil.delete(e.r.sessionId);
  assert.ok(e.p().x - x0 > 2, `déplacement ${e.p().x - x0}`);
  await e.r.leave();
});

test('un gisement rare s\'exploite dans une zone dégagée', async () => {
  clearMonsters();
  const f = await join('Fanny');
  const sim = room().sim;
  const rare = sim.signature.exclusives[0];
  const zone = sim.zones.find((z) => z.resources[rare] > 0);
  assert.ok(zone, 'gisement présent');
  zone.monsterPressure = 80;
  place(f.p(), zone);
  assert.ok(await until(() => f.p().action.startsWith('extraire')));
  f.r.send('interagir');
  assert.ok(await until(() => f.inbox.info.some((m) => /dégagez/.test(m))), 'refusé tant que la zone est infestée');
  assert.equal(f.p().sac.get(rare) ?? 0, 0);
  zone.monsterPressure = 10;
  await sleep(700);
  f.r.send('interagir');
  assert.ok(await until(() => (f.p().sac.get(rare) ?? 0) === 1), 'extrait');
  assert.ok(room().world.events.some((e) => e.type === 'discovery' && e.data.who.includes('Fanny')));
  await f.r.leave();
});

test('rapporter une ressource rare au village, puis forger d\'après un plan inventé', async () => {
  clearMonsters();
  const g = await join('Gaspard');
  const sim = room().sim;
  const pop = sim.village.population;
  const rare = sim.signature.exclusives[0];
  place(g.p(), village());
  g.p().sac.set(rare, 3);
  g.r.send('offrir', { rare });
  assert.ok(await until(() => (pop.rares[rare] ?? 0) >= 1), 'offrande reçue');
  assert.equal(g.p().sac.get(rare), 2);
  assert.ok(room().world.events.some((e) => e.type === 'offering' && e.data.who.includes('Gaspard')));
  assert.ok(await until(() => g.r.state.offrandes?.get(rare) >= 1), 'offrande visible des clients');

  // Le forgeron invente un talisman avec ce matériau : la recette apparaît à la forge.
  pop.plans.push({ id: 99, type: 'talisman', nom: `Talisman de ${rare}`, effet: '+4 points de vie', materiau: rare, auteur: 'Irène Vasseur', contree: sim.name, jour: sim.day });
  room().syncVillage();
  assert.ok(await until(() => g.r.state.plans?.length >= 1), 'plan synchronisé');
  g.p().sac.set('cuir', 2);
  const pvMax = g.p().pvMax;
  g.r.send('fabriquer', { recette: 'plan99' });
  assert.ok(await until(() => g.p().talisman === 1), 'talisman forgé');
  assert.equal(g.p().pvMax, pvMax + 4);
  await g.r.leave();
});

test('les habitants du village sont visibles des clients', async () => {
  const h = await join('Hélio');
  assert.ok(await until(() => (h.r.state.habitants?.length ?? 0) >= 10));
  const one = [...h.r.state.habitants][0];
  assert.ok(one.prenom && one.famille && one.traits.includes(','));
  await h.r.leave();
});
