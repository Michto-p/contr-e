import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, neighbors } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { makeCtx, simulate } from '../src/sim/tick.js';
import { addPlayers, agentsAct } from '../src/sim/agents.js';
import { monsters } from '../src/sim/systems/monsters.js';

const endOfDay = (state) => ({ ...makeCtx(state, 24), dayEnd: true });

test('des joueurs assidus bâtissent une tour de guet devant un champ menacé', () => {
  const w = createWorld(42);
  const rng = createRng(42);
  addPlayers(w, rng, 'assidus');
  const { state, events } = simulate(w, rng, { days: 20, beforeTick: agentsAct });
  const built = events.filter((e) => e.type === 'structure_built');
  assert.ok(built.length >= 1);
  for (const e of built) {
    assert.ok(e.data.who.length >= 2, 'bâtir se fait à plusieurs');
    const zone = state.zones[e.zone];
    assert.ok(zone.structures.some((s) => s.type === 'tour de guet'));
    assert.ok(neighbors(state, zone).some((n) => n.isField), 'la tour garde un champ');
  }
});

test('une tour de guet intacte ralentit la montée des monstres', () => {
  const grow = (withTower) => {
    const s = createWorld(42);
    const z = s.zones.find((x) => x.dist === 4 && x.structures.length === 0);
    z.monsterPressure = 10;
    if (withTower) z.structures.push({ type: 'tour de guet', condition: 80 });
    monsters(s, createRng(9), endOfDay(s));
    return z.monsterPressure - 10;
  };
  assert.ok(grow(true) < grow(false));
});

test('une horde malmène les structures sur son passage', () => {
  let raided = null;
  for (let seed = 1; seed < 50 && !raided; seed++) {
    const s = createWorld(42);
    const src = s.zones.find((x) => x.dist === 5);
    src.monsterPressure = 100;
    for (const n of neighbors(s, src)) {
      if (n.dist < src.dist) n.structures.push({ type: 'palissade', condition: 90 });
    }
    const events = monsters(s, createRng(seed), endOfDay(s));
    raided = events.find((e) => e.type === 'structure_raided');
    if (raided) {
      const target = s.zones[raided.zone];
      assert.ok(target.structures.some((st) => st.type === 'palissade' && st.condition < 90));
      assert.equal(raided.data.fix, 'reparer');
    }
  }
  assert.ok(raided, 'aucune horde en 50 essais');
});

test('une tour achevée n\'est pas rebâtie par-dessus', () => {
  for (const sc of ['assidus', 'mixte']) {
    const w = createWorld(42);
    const rng = createRng(42);
    addPlayers(w, rng, sc);
    const { state, events } = simulate(w, rng, { days: 30, beforeTick: agentsAct });
    for (const z of state.zones) assert.ok(z.structures.filter((s) => s.type === 'tour de guet').length <= 1, z.label);
    const perZone = new Map();
    for (const e of events.filter((x) => x.type === 'structure_built')) perZone.set(e.zone, (perZone.get(e.zone) ?? 0) + 1);
    // Une même zone ne voit une seconde tour que si la première est tombée en ruine entre-temps.
    for (const [zone, n] of perZone) {
      const ruins = events.filter((x) => x.zone === zone && x.type === 'structure_decay' && x.data.level === 'ruine' && x.data.structure === 'tour de guet').length;
      assert.ok(n <= 1 + ruins, `zone ${zone} : ${n} tours`);
    }
  }
});
