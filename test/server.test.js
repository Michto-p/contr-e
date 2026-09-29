// Tests du serveur de jeu avec de vrais clients Colyseus (réseau local).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { Client } from '@colyseus/sdk';
import { createGameServer } from '../server/index.js';

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

async function join(nom) {
  const room = await new Client(url).join('contree', { nom });
  const inbox = {};
  for (const type of ['monde', 'chronique', 'bienvenue', 'absence']) room.onMessage(type, (m) => { inbox[type] = m; });
  return { room, inbox };
}

before(async () => {
  game = await createGameServer({ port: 0, heureMs: 25, bots: 'aucun', graine: 7, fichier: pathJoin(dir, 'contree.json') });
  url = `http://localhost:${game.port}`;
});

after(async () => {
  await game.close();
  rmSync(dir, { recursive: true, force: true });
});

test('deux joueurs se voient bouger', async () => {
  const a = await join('Alix');
  const b = await join('Bea');
  assert.ok(await until(() => a.inbox.monde && b.room.state.joueurs?.size === 2));
  assert.equal(a.inbox.monde.zones.length, 144);
  const aId = a.room.sessionId;
  const x0 = b.room.state.joueurs.get(aId).x;
  a.room.send('deplacement', { x: 1, y: 0 });
  assert.ok(await until(() => b.room.state.joueurs.get(aId).x > x0 + 1), 'B voit A avancer');
  a.room.send('deplacement', { x: 0, y: 0 });
  assert.ok(await until(() => !b.room.state.joueurs.get(aId).bouge));
  await a.room.leave();
  await b.room.leave();
});

test('au retour, un joueur reçoit le résumé de ce qu\'il a manqué', async () => {
  const first = await join('Dany');
  assert.ok(await until(() => first.inbox.bienvenue));
  const day = game.room.sim.day;
  await first.room.leave();
  assert.ok(await until(() => game.room.sim.day >= day + 2), 'deux jours passent');
  const back = await join('Dany');
  assert.ok(await until(() => back.inbox.absence), 'message d\'absence reçu');
  assert.equal(back.inbox.absence.depuis, day);
  assert.ok(back.inbox.absence.lignes.length >= 1);
  await back.room.leave();
});

test('la chronique du jour est diffusée à chaque fin de journée', async () => {
  const e = await join('Eden');
  const day = game.room.sim.day;
  e.inbox.chronique = null;
  assert.ok(await until(() => e.inbox.chronique && e.inbox.chronique[0]?.jour === day), 'chronique reçue');
  assert.ok(e.inbox.chronique[0].lignes.length >= 1);
  await e.room.leave();
});

test('deux joueurs du même nom sont distingués', async () => {
  const a = await join('Lou');
  const b = await join('Lou');
  const names = () => [...(a.room.state.joueurs?.values() ?? [])].map((p) => p.nom).sort().join(',');
  assert.ok(await until(() => names() === 'Lou,Lou 2'), names());
  await a.room.leave();
  await b.room.leave();
});

test('le serveur sert la page du jeu et ses fichiers', async () => {
  for (const [path, needle] of [['/', '<canvas'], ['/game.js', 'Colyseus.Client'], ['/render.js', 'drawWorld'], ['/shared/monde.js', 'ZONE_TILES'], ['/vendor/colyseus.js', 'Colyseus']]) {
    const res = await fetch(`${url}${path}`);
    assert.equal(res.status, 200, path);
    assert.ok((await res.text()).includes(needle), path);
  }
});
