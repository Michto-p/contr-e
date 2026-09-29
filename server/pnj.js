// Habitants présents sur la carte du jeu, gérés par le serveur :
// - les gardes, qui partent le matin patrouiller là où la simulation les envoie et combattent
//   vraiment les monstres qu'ils croisent, puis rentrent le soir au village ;
// - le voyageur égaré, qui attend quelque part dans les terres lointaines qu'on vienne le chercher
//   (touche E), puis suit son sauveteur jusqu'au village où il s'installe.
import { Pnj } from './schema.js';
import { ZONE_TILES, zoneIndexAt, stepPosition, SPEED } from '../shared/monde.js';
import { defeatMonster } from './gameplay.js';
import { pushEvent, announce } from './evenements.js';
import { rescueLost } from '../src/sim/systems/population.js';
import { makeCtx } from '../src/sim/tick.js';

export const GUARD_PV = 6;
const GUARD_SPEED = 3.2; // tuiles par seconde
const GUARD_SIGHT = 6; // tuiles
const GUARD_REACH = 1.3;
const GUARD_HIT_MS = 800;
const GUARD_REGEN_MS = 5000;
const SYNC_MS = 500;
const FOLLOW_SPEED = 4.6; // un peu moins vite qu'un joueur : il faut l'attendre de temps en temps
const FOLLOW_GAP = 1.2;
export const RESCUE_REACH = 1.6;

export function initPnj(room) {
  room.pnj = { data: new Map(), lastSync: 0 };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const zoneOf = (room, x, y) => zoneIndexAt(x, y, room.sim.width, room.sim.height);

function center(room, zoneId) {
  const z = room.sim.zones[zoneId];
  return { x: (z.x + 0.5) * ZONE_TILES, y: (z.y + 0.5) * ZONE_TILES };
}

function person(room, hid) {
  return room.sim.village.population?.people.find((p) => p.id === hid) ?? null;
}

// ---------- Gardes ----------

// Les gardes en patrouille dans la simulation apparaissent au village et partent vers leur zone ;
// le soir (ou blessés), ils rentrent et disparaissent de la carte.
function syncGuards(room) {
  const pop = room.sim.village.population;
  if (!pop) return;
  const day = room.sim.day;
  const onDuty = new Map();
  for (const p of pop.people) {
    if (p.alive && p.metier === 'garde' && p.outing?.kind === 'garde' && !(p.hurtUntil > day)) onDuty.set(`g${p.id}`, p);
  }
  for (const [key, p] of onDuty) {
    let data = room.pnj.data.get(key);
    if (!data) {
      const g = new Pnj();
      const v = center(room, room.sim.villageId);
      Object.assign(g, { sorte: 'garde', prenom: p.prenom, famille: p.famille, x: v.x, y: v.y + 1, dir: 'bas', bouge: false, pv: GUARD_PV, pvMax: GUARD_PV, coup: 0, touche: 0, suit: '' });
      room.state.pnj.set(key, g);
      data = { hid: p.id, lastHit: 0, regenAt: 0, goal: null, nextGoal: 0 };
      room.pnj.data.set(key, data);
    }
    data.zone = p.outing.zone;
    data.home = false;
    data.talent = Boolean(p.talent);
  }
  for (const [key, data] of room.pnj.data) {
    if (key.startsWith('g') && !onDuty.has(key)) data.home = true;
  }
}

// ---------- Voyageur égaré ----------

function syncLost(room) {
  const lost = room.sim.village.population?.lost ?? null;
  const key = lost ? `e${lost.id}` : null;
  for (const [k] of room.pnj.data) if (k.startsWith('e') && k !== key) removePnj(room, k); // parti, ou ramené par un habitant
  if (!lost || room.state.pnj.has(key)) return;
  const z = room.sim.zones[lost.zone];
  const r = () => room.play.rng.next();
  const e = new Pnj();
  Object.assign(e, {
    sorte: 'egare', prenom: lost.prenom, famille: lost.famille, x: (z.x + 0.25 + r() * 0.5) * ZONE_TILES, y: (z.y + 0.25 + r() * 0.5) * ZONE_TILES,
    dir: 'bas', bouge: false, pv: 1, pvMax: 1, coup: 0, touche: 0, suit: '',
  });
  room.state.pnj.set(key, e);
  room.pnj.data.set(key, { follow: null, rescuers: new Set() });
}

// Touche E près de l'égaré : il suit ce joueur.
export function lostNear(room, p) {
  for (const [key, e] of room.state.pnj) {
    if (e.sorte === 'egare' && !e.suit && dist(e, p) <= RESCUE_REACH) return [key, e];
  }
  return null;
}

export function followPlayer(room, key, sid, p) {
  const e = room.state.pnj.get(key);
  const data = room.pnj.data.get(key);
  if (!e || !data) return;
  e.suit = p.nom;
  data.follow = sid;
  data.rescuers.add(p.nom);
}

function updateLost(room, key, e, data, dt) {
  const p = data.follow ? room.state.joueurs.get(data.follow) : null;
  if (!p || p.aTerre || p.interieur >= 0) {
    // Son guide est tombé ou parti : il attend là, qu'on revienne le chercher.
    if (e.suit) { e.suit = ''; data.follow = null; e.bouge = false; }
    return;
  }
  if (dist(e, p) > FOLLOW_GAP) moveTowards(e, p, FOLLOW_SPEED, dt);
  else e.bouge = false;
  if (zoneOf(room, e.x, e.y) !== room.sim.villageId) return;
  // Arrivé au village : il s'installe.
  const ctx = makeCtx(room.sim, 24);
  const event = rescueLost(room.sim, [...data.rescuers], ctx);
  removePnj(room, key);
  if (!event) return;
  const pushed = pushEvent(room, event.type, null, event.data);
  announce(room, pushed);
  room.syncVillage();
}

function removePnj(room, key) {
  room.state.pnj.delete(key);
  room.pnj.data.delete(key);
}

function moveTowards(g, goal, speed, dt) {
  const dx = goal.x - g.x;
  const dy = goal.y - g.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.15) { g.bouge = false; return d; }
  const next = stepPosition(g.x, g.y, { x: dx, y: dy }, dt, speed / SPEED);
  g.x = next.x;
  g.y = next.y;
  g.bouge = true;
  g.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'droite' : 'gauche') : (dy > 0 ? 'bas' : 'haut');
  return d;
}

function updateGuard(room, key, g, data, dt, t) {
  // À bout de forces : il rentre se soigner, et la simulation le sait (quelques jours de repos).
  if (g.pv === 0) {
    const p = person(room, data.hid);
    if (p) p.hurtUntil = room.sim.day + 1;
    const zone = room.sim.zones[zoneOf(room, g.x, g.y)];
    pushEvent(room, 'villager_hurt', zone.id, { who: g.prenom, label: zone.label, fix: 'groupe' });
    removePnj(room, key);
    return;
  }
  if (g.pv < g.pvMax && t >= data.regenAt) {
    if (data.regenAt) g.pv += 1;
    data.regenAt = t + GUARD_REGEN_MS;
  }
  if (data.home) {
    if (moveTowards(g, center(room, room.sim.villageId), GUARD_SPEED, dt) < 1) removePnj(room, key);
    return;
  }
  // Un monstre en vue : il fonce, et frappe à portée.
  let target = null;
  let best = GUARD_SIGHT;
  for (const [id, m] of room.state.monstres) {
    const d = dist(g, m);
    if (d < best) { best = d; target = [id, m]; }
  }
  if (target) {
    const [id, m] = target;
    if (best > GUARD_REACH) moveTowards(g, m, GUARD_SPEED, dt);
    else {
      g.bouge = false;
      g.dir = Math.abs(m.x - g.x) > Math.abs(m.y - g.y) ? (m.x > g.x ? 'droite' : 'gauche') : (m.y > g.y ? 'bas' : 'haut');
      if (t - data.lastHit >= GUARD_HIT_MS) {
        data.lastHit = t;
        g.coup = (g.coup + 1) % 65536;
        m.pv = Math.max(0, m.pv - (data.talent ? 2 : 1));
        m.touche = (m.touche + 1) % 65536;
        if (m.pv === 0) defeatMonster(room, id, t, g.prenom);
      }
    }
    return;
  }
  // Sinon : rejoindre sa zone, puis y faire des rondes.
  if (zoneOf(room, g.x, g.y) !== data.zone || !data.goal) {
    data.goal = zoneOf(room, g.x, g.y) === data.zone ? { x: g.x, y: g.y } : center(room, data.zone);
  }
  if (moveTowards(g, data.goal, GUARD_SPEED * (zoneOf(room, g.x, g.y) === data.zone ? 0.5 : 1), dt) < 0.3 && t >= data.nextGoal) {
    const c = center(room, data.zone);
    const r = () => room.play.rng.next();
    data.goal = { x: c.x + (r() * 2 - 1) * (ZONE_TILES / 2 - 2), y: c.y + (r() * 2 - 1) * (ZONE_TILES / 2 - 2) };
    data.nextGoal = t + 1500 + r() * 2500;
  }
}

export function updatePnj(room, dt, t = Date.now()) {
  if (t - room.pnj.lastSync >= SYNC_MS) {
    room.pnj.lastSync = t;
    syncGuards(room);
    syncLost(room);
  }
  for (const [key, data] of room.pnj.data) {
    const g = room.state.pnj.get(key);
    if (!g) { room.pnj.data.delete(key); continue; }
    if (g.sorte === 'garde') updateGuard(room, key, g, data, dt, t);
    else updateLost(room, key, g, data, dt);
  }
}
