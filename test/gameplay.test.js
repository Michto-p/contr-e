// Gameplay temps réel : monstres, points de vie, touche E, quêtes validées par les vrais joueurs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { Client } from '@colyseus/sdk';
import { createGameServer } from '../server/index.js';
import { Monstre } from '../server/schema.js';
import { ZONE_TILES } from '../shared/monde.js';
import { QUEST_KILLS, REPAIR_WOOD, INTERACT_COOLDOWN_MS, monsterCountFor, kindFor } from '../server/gameplay.js';

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
  // Horloge du monde très lente : les tests déclenchent les heures eux-mêmes.
  game = await createGameServer({ port: 0, heureMs: 3_600_000, bots: 'aucun', graine: 11, fichier: pathJoin(dir, 'contree.json') });
  url = `http://localhost:${game.port}`;
});
after(async () => {
  await game.close();
  rmSync(dir, { recursive: true, force: true });
});

const room = () => game.room;
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
function spawnMonster(zone, x, y, { pv = 2, degats = 1, cadence = 1e9 } = {}) {
  const m = new Monstre();
  Object.assign(m, { sorte: 'gluant', x, y, pv, pvMax: pv, coup: 0, touche: 0 });
  const id = `t${mid++}`;
  room().state.monstres.set(id, m);
  room().play.monsters.set(id, { zone: zone.id, kind: { sorte: 'gluant', pv, degats, vitesse: 0, cadence }, goal: { x, y }, nextGoal: Infinity, lastHit: 0 });
  return id;
}
function clearMonsters() {
  for (const id of [...room().play.monsters.keys()]) { room().play.monsters.delete(id); room().state.monstres.delete(id); }
}

test('le nombre et la force des monstres suivent la pression', () => {
  assert.equal(monsterCountFor(5), 0);
  assert.ok(monsterCountFor(60) > monsterCountFor(30));
  assert.ok(monsterCountFor(100) <= 6);
  assert.equal(kindFor(20).sorte, 'gluant');
  assert.equal(kindFor(85).sorte, 'brute');
  assert.ok(kindFor(85).pv > kindFor(20).pv);
});

test('des monstres apparaissent autour d\'un joueur qui sort du village', async () => {
  const a = await join('Alix');
  const zone = room().sim.zones.find((z) => z.dist === 2 && !z.closed);
  zone.monsterPressure = 70;
  place(a.p(), zone);
  assert.ok(await until(() => [...room().play.monsters.values()].some((m) => m.zone === zone.id)), 'apparition');
  // De retour au village, les monstres des alentours disparaissent (ils retournent à la pression).
  place(a.p(), room().sim.zones[room().sim.villageId]);
  assert.ok(await until(() => ![...room().play.monsters.values()].some((m) => m.zone === zone.id)), 'disparition');
  await a.r.leave();
});

test('vaincre un monstre compte comme un combat dans sa zone', async () => {
  clearMonsters();
  const c = await join('Camille');
  const field = room().sim.zones.find((z) => z.isField);
  place(c.p(), field);
  c.p().dir = 'droite';
  const before = field.monsterPressure;
  const id = spawnMonster(field, c.p().x + 1, c.p().y);
  c.r.send('attaque');
  await sleep(450);
  c.r.send('attaque');
  assert.ok(await until(() => !room().state.monstres.has(id)), 'monstre vaincu');
  assert.ok(field.monsterPressure <= Math.max(0, before - 1), 'la jauge baisse tout de suite');
  room().gameHour();
  assert.ok(room().sim.zones[field.id].today.fighters.includes('Camille'));
  assert.ok(room().sim.zones[field.id].today.fights >= 1);
  await c.r.leave();
});

test('à terre, on se relève au village avec toute sa vie', async () => {
  clearMonsters();
  const d = await join('Dany');
  const zone = room().sim.zones.find((z) => z.dist === 3 && !z.closed);
  place(d.p(), zone);
  const n = room().world.events.length;
  spawnMonster(zone, d.p().x + 0.5, d.p().y, { degats: 20, cadence: 10 });
  assert.ok(await until(() => d.p().aTerre), 'à terre');
  assert.ok(room().world.events.slice(n).some((e) => e.type === 'player_down' && e.data.who.includes('Dany')));
  clearMonsters();
  assert.ok(await until(() => !d.p().aTerre, 5000), 'relevé');
  assert.equal(d.p().pv, d.p().pvMax);
  const v = room().sim.zones[room().sim.villageId];
  assert.equal(Math.floor(d.p().x / ZONE_TILES), v.x);
  await d.r.leave();
});

test('touche E : couper du bois puis réparer une structure abîmée', async () => {
  clearMonsters();
  const e = await join('Eden');
  const forest = room().sim.zones.find((z) => z.biome === 'foret' && !z.isField && !z.closed);
  assert.ok(forest, 'une forêt existe');
  const stock = room().sim.village.jobs.bucheron_mineur.stock;
  stock.bois = 0;
  place(e.p(), forest);
  for (let i = 0; i < 3; i++) { e.r.send('interagir'); await sleep(INTERACT_COOLDOWN_MS + 30); }
  assert.ok(await until(() => stock.bois === 3), `bois = ${stock.bois}`);

  // Une palissade abîmée dans une zone : Eden la répare avec le bois du village.
  const zone = room().sim.zones.find((z) => z.dist === 2 && !z.closed && z.structures.length === 0);
  zone.structures.push({ type: 'palissade', condition: 55, warned: 'abimee' });
  stock.bois = 10;
  place(e.p(), zone);
  assert.ok(await until(() => e.p().action.startsWith('réparer')), 'action proposée');
  e.r.send('interagir');
  await until(() => zone.structures[0].condition > 55);
  assert.equal(zone.structures[0].condition, 65);
  assert.equal(stock.bois, 10 - REPAIR_WOOD);
  assert.ok(room().world.events.some((x) => x.type === 'quest_done' && x.data.kind === 'reparer' && x.data.who.includes('Eden')));
  await e.r.leave();
});

test('une patrouille est validée en vainquant des monstres autour du champ', async () => {
  clearMonsters();
  const f = await join('Fanny');
  const field = room().sim.zones.find((z) => z.isField);
  const quest = { id: 9999, created: room().sim.day, kind: 'patrouille', job: 'agriculteur', zone: field.id, label: field.label };
  room().sim.village.quests.push(quest);
  place(f.p(), field);
  f.p().dir = 'droite';
  for (let i = 0; i < QUEST_KILLS; i++) {
    const id = spawnMonster(field, f.p().x + 1, f.p().y, { pv: 1 });
    f.r.send('attaque');
    assert.ok(await until(() => !room().state.monstres.has(id)), `monstre ${i}`);
    await sleep(420);
  }
  assert.ok(!room().sim.village.quests.some((q) => q.id === 9999), 'quête retirée du tableau');
  assert.equal(room().sim.village.jobs.agriculteur.helpedDay, room().sim.day);
  assert.ok(await until(() => f.inbox.annonce.some((l) => /gardés par Fanny/.test(l))), f.inbox.annonce.join(' / '));
  await f.r.leave();
});
