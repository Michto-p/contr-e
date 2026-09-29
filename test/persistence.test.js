import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorld, advanceWorld, snapshotWorld, saveWorld } from '../server/persistence.js';

test('une contrée sauvegardée reprend là où elle en était, puis rattrape le temps perdu', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contree-'));
  const fichier = join(dir, 'contree.json');
  try {
    const w = openWorld({ fichier, graine: 5, bots: 'mixte' });
    assert.equal(w.created, true);
    for (let i = 0; i < 30; i++) advanceWorld(w);
    saveWorld(fichier, snapshotWorld(w, 1_000_000));

    // Rechargé immédiatement : rien à rattraper, même état.
    const same = openWorld({ fichier, heureMs: 1000, now: 1_000_000 });
    assert.equal(same.created, false);
    assert.equal(same.caughtUp, 0);
    assert.deepEqual(same.sim, w.sim);

    // Rechargé 48 heures de jeu plus tard : le monde a vécu sans le serveur.
    const later = openWorld({ fichier, heureMs: 1000, now: 1_000_000 + 48 * 1000 });
    assert.equal(later.caughtUp, 48);
    assert.equal(later.sim.tick, w.sim.tick + 48);
    assert.equal(later.sim.day, w.sim.day + 2);

    // Le rattrapage est borné (7 jours par défaut).
    const much = openWorld({ fichier, heureMs: 1000, now: 1_000_000 + 1000 * 24 * 100 });
    assert.equal(much.caughtUp, 7 * 24);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le générateur reprend exactement la même suite après rechargement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contree-'));
  const fichier = join(dir, 'contree.json');
  try {
    const a = openWorld({ fichier, graine: 3, bots: 'mixte' });
    for (let i = 0; i < 10; i++) advanceWorld(a);
    saveWorld(fichier, snapshotWorld(a, 0));
    const b = openWorld({ fichier, heureMs: 1000, now: 0 });
    for (let i = 0; i < 40; i++) { advanceWorld(a); advanceWorld(b); }
    assert.deepEqual(b.sim, a.sim);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
