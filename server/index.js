// Serveur de jeu : Colyseus (une room = une contrée) + la page du jeu, servies sur le même port.
// Lancement : npm start   (variables : PORT, HEURE_MS, BOTS, GRAINE, FICHIER, RATTRAPAGE_JOURS)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { makeContreeRoom } from './contree-room.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SDK_BUNDLE = join(dirname(require.resolve('@colyseus/sdk/package.json')), 'dist', 'colyseus.js');

export async function createGameServer({ port = 2567, ...config } = {}) {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      app.get('/', (req, res) => res.sendFile(join(ROOT, 'client', 'index.html')));
      app.get('/vendor/colyseus.js', (req, res) => res.sendFile(SDK_BUNDLE));
      app.use('/shared', express.static(join(ROOT, 'shared')));
      app.use(express.static(join(ROOT, 'client')));
    },
  });
  server.define('contree', makeContreeRoom(config));
  await server.listen(port);
  // La contrée est créée au démarrage : elle vit avant même l'arrivée du premier joueur.
  const listing = await matchMaker.createRoom('contree', {});
  const room = matchMaker.getLocalRoomById(listing.roomId);
  const actualPort = server.transport.server?.address()?.port ?? port;
  return {
    server,
    room,
    port: actualPort,
    async close() {
      room.save();
      await server.gracefullyShutdown(false);
    },
  };
}

// Lancement direct : node server/index.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const game = await createGameServer({
    port: Number(env.PORT ?? 2567),
    heureMs: Number(env.HEURE_MS ?? 30_000),
    bots: env.BOTS ?? 'mixte',
    graine: Number(env.GRAINE ?? 42),
    fichier: env.FICHIER ?? join(ROOT, 'data', 'contree.json'),
    rattrapageMaxJours: Number(env.RATTRAPAGE_JOURS ?? 7),
    log: (msg) => console.log(`[contrée] ${msg}`),
  });
  console.log(`[contrée] Serveur prêt sur http://localhost:${game.port} (1 heure de jeu = ${Number(env.HEURE_MS ?? 30_000) / 1000} s)`);
}
