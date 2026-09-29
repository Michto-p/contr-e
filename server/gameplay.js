// Gameplay temps réel du serveur : monstres qu'on combat, points de vie, touche E (réparer,
// bâtir, aider, ramasser du bois) et quêtes du village validées par les vrais joueurs.
// Tout ce qui se passe ici retombe dans la simulation : un monstre tué compte comme un combat
// dans sa zone, une réparation remet la structure en état, une quête terminée aide son métier.
import { createRng } from '../src/sim/rng.js';
import { clamp, neighbors, standing, OUTPOST } from '../src/sim/world.js';
import { TOWER } from '../src/sim/systems/village.js';
import { pushEvent, announce } from './evenements.js';
import { ZONE_TILES, zoneIndexAt, stepPosition, OUTPOST_SPOT, OUTPOST_SAFE } from '../shared/monde.js';
import { Monstre, Projectile } from './schema.js';
import { houseActionAt, buildHouse, spawnPoint } from './maisons.js';
import { lostNear, followPlayer } from './pnj.js';
import { dropLoot, isDashing, rareAt, extractRare, DAMAGE_BY_SWORD, addItem } from './objets.js';

import { damageBonus, regenFactor, woodPerCut, TIRED, HUNGRY } from '../shared/competences.js';
export const PLAYER_PV = 10;
const ATTACK_RANGE = 1.8; // tuiles
const ATTACK_ARC_COS = Math.cos(1.25); // environ 70° de part et d'autre du regard
const RESPAWN_MS = 3000;
const REGEN_VILLAGE_MS = 1000;
const REGEN_WILD_MS = 10_000;
const SPAWN_CHECK_MS = 500;
const SPAWN_GAP_MS = 5000; // entre deux apparitions dans une même zone
const SPAWN_REACH = 5; // tuiles : une zone voisine ne se peuple que si l'on s'approche de son bord
const KEEP_REACH = 10; // tuiles : au-delà, ses monstres retournent dans la pression de la zone
const RESPAWN_AFTER_KILL_MS = 15_000; // une zone nettoyée reste tranquille un moment
const AGGRO = 5; // tuiles
const AGGRO_NIGHT = 7; // la nuit, les monstres flairent de plus loin
const REACH = 0.9;
export const KILLS_PER_HOUR_CAP = 3; // au-delà, les monstres tués ne comptent plus pour la simulation
export const INTERACT_COOLDOWN_MS = 600;

export const REPAIR_WOOD = 2;
export const BUILD_WOOD = 3;
export const OUTPOST_STEP_WOOD = 4;
const OUTPOST_STEP = 25;
export const OUTPOST_MAX_PRESSURE = 30; // on ne s'installe que dans une zone dégagée
const REPAIR_STEP = 10;
const BUILD_STEP = 8;
export const TOWER_DONE = 75;
const REPAIRED = 60;
export const QUEST_KILLS = 4; // monstres à vaincre pour une patrouille ou une escorte
export const HELP_ACTS = 5; // coups de main pour aider un métier
const HELP_OUTPUT = { agriculteur: 'ble', boulanger: 'pain', forgeron: 'outils', bucheron_mineur: 'minerai' };

// Le cracheur garde ses distances et crache des projectiles qu'on esquive d'une roulade.
const SPITTER = { sorte: 'cracheur', min: 35, pv: 2, degats: 1, vitesse: 2.0, cadence: 1800, portee: 7 };
const SPITTER_BIOMES = new Set(['marais', 'colline', 'montagne']);
const PROJECTILE_SPEED = 6; // tuiles par seconde
const PROJECTILE_LIFE_MS = 1600;
const PROJECTILE_HIT = 0.55;

const KINDS = [
  { sorte: 'brute', min: 80, pv: 5, degats: 2, vitesse: 2.4, cadence: 1200 },
  { sorte: 'rodeur', min: 50, pv: 3, degats: 1, vitesse: 2.9, cadence: 850 },
  { sorte: 'gluant', min: 0, pv: 2, degats: 1, vitesse: 2.2, cadence: 1000 },
];

// Peu de monstres à la fois : de 1 (zone peu infestée) à 4 (zone saturée).
export const monsterCountFor = (p) => (p < 20 ? 0 : Math.min(4, Math.round(p / 22)));

// Ce qui est bâti dans une zone y retient les monstres.
// La nuit (21 h – 5 h), les monstres s'enhardissent : un de plus par zone infestée, et ils flairent
// de plus loin. Le village et les avant-postes restent sûrs.
export const isNightHour = (hour) => hour >= 21 || hour < 5;
const isNight = (room) => isNightHour(room.sim.tick % 24);

export function monsterTarget(zone, night = false) {
  let n = monsterCountFor(zone.monsterPressure);
  if (night && n > 0) n += 1;
  if (standing(zone, 'tour de guet')) n -= 1;
  if (standing(zone, OUTPOST)) n -= 2;
  return Math.max(0, n);
}

export function outpostPos(zone) {
  return { x: zone.x * ZONE_TILES + OUTPOST_SPOT[0] + 0.5, y: zone.y * ZONE_TILES + OUTPOST_SPOT[1] + 0.5 };
}

// Près d'un avant-poste debout : pas de monstre, et l'on reprend des forces comme au village.
export function nearOutpost(room, x, y) {
  const z = room.sim.zones[zoneOfPos(room, x, y)];
  if (!standing(z, OUTPOST)) return false;
  const o = outpostPos(z);
  return Math.hypot(o.x - x, o.y - y) <= OUTPOST_SAFE;
}
export const kindFor = (p) => KINDS.find((k) => p >= k.min);

// Sorte d'un monstre qui apparaît : les marais, collines et hauteurs abritent aussi des cracheurs.
function pickKind(room, zone) {
  if (SPITTER_BIOMES.has(zone.biome) && zone.monsterPressure >= SPITTER.min && room.play.rng.next() < 0.35) return SPITTER;
  return kindFor(zone.monsterPressure);
}

// ---------- Outils ----------

export function initGameplay(room) {
  room.play = {
    rng: createRng(Date.now() >>> 0),
    monsters: new Map(), // id -> données internes (zone, errance, cadence…)
    nextId: 1,
    lastSpawnCheck: 0,
    spawnAt: new Map(), // zone -> prochaine apparition possible
    downAt: new Map(), // sessionId -> instant de la chute
    regenAt: new Map(), // sessionId -> prochain point de vie regagné
    lastInteract: new Map(),
    questProgress: new Map(), // id de quête -> { points, who: Set }
    repairers: new Map(), // "zone|type" -> Set de noms
    projectiles: new Map(), // id -> { vx, vy, until, degats }
    needs: new Map(), // sessionId -> prochaines hausses de faim et de fatigue
    fatigueAcc: new WeakMap(), // joueur -> fatigue accumulée (fractions)
    hordes: new Map(), // id -> horde en marche (voir startHorde)
  };
}

export { pushEvent };

// ---------- Hordes ----------

// Quand la simulation annonce une horde et que des joueurs sont là, elle se matérialise : une bande
// de monstres part de la zone touchée et marche sur le village. Repoussée à temps, elle recule ;
// sinon elle pille une partie des réserves (jamais tout) et se disperse.
export const HORDE_SIZE = 6;
const HORDE_MARCH = 0.9; // tuiles par seconde : le temps d'accourir
const HORDE_KINDS = ['brute', 'brute', 'rodeur', 'rodeur', 'gluant', 'gluant'];
const HORDE_LOOT = 3; // pains pillés par monstre qui atteint le village

export function startHorde(room, fromLabel, targetId, t = Date.now()) {
  const { play, sim } = room;
  const z = sim.zones[targetId];
  if (!z || z.isVillage) return null;
  const hid = play.nextHorde = (play.nextHorde ?? 0) + 1;
  const horde = { id: hid, zone: targetId, label: z.label, from: fromLabel, alive: 0, raided: 0, who: new Set() };
  play.hordes.set(hid, horde);
  for (let i = 0; i < HORDE_SIZE; i++) {
    const kind = KINDS.find((k) => k.sorte === HORDE_KINDS[i % HORDE_KINDS.length]);
    const pos = randomPointIn(room, targetId);
    const id = `m${play.nextId++}`;
    const m = new Monstre();
    Object.assign(m, { sorte: kind.sorte, x: pos.x, y: pos.y, pv: kind.pv, pvMax: kind.pv, coup: 0, touche: 0, horde: true });
    room.state.monstres.set(id, m);
    play.monsters.set(id, { zone: targetId, kind, goal: pos, nextGoal: 0, lastHit: 0, horde: hid });
    horde.alive += 1;
  }
  room.broadcast('annonce', `Une horde venue ${deLabelFr(fromLabel)} marche sur le village depuis ${z.label} ! Repoussez-la ensemble.`);
  return horde;
}

const deLabelFr = (label) => (label.startsWith('les ') ? `des ${label.slice(4)}` : label.startsWith('le ') ? `du ${label.slice(3)}` : `de ${label}`);

function marchHorde(room, id, m, data, target, best, dt, t) {
  let goal;
  let speed = data.kind.vitesse;
  if (target && best <= REACH) {
    goal = null;
    if (t - data.lastHit >= data.kind.cadence) {
      data.lastHit = t;
      m.coup = (m.coup + 1) % 65536;
      if (target[0]) hurtPlayer(room, target[0], target[1], data.kind.degats, t);
      else { target[1].pv = Math.max(0, target[1].pv - data.kind.degats); target[1].touche = (target[1].touche + 1) % 65536; }
    }
  } else if (target) {
    goal = target[1];
  } else {
    const v = room.sim.zones[room.sim.villageId];
    goal = { x: (v.x + 0.5) * ZONE_TILES, y: (v.y + 0.5) * ZONE_TILES };
    speed = HORDE_MARCH;
  }
  if (goal) {
    const next = stepPosition(m.x, m.y, { x: goal.x - m.x, y: goal.y - m.y }, dt * (speed / 5));
    m.x = next.x;
    m.y = next.y;
  }
  data.zone = zoneOfPos(room, m.x, m.y);
  if (data.zone === room.sim.villageId) raidVillage(room, id, data);
}

function raidVillage(room, id, data) {
  const horde = room.play.hordes.get(data.horde);
  room.state.monstres.delete(id);
  room.play.monsters.delete(id);
  const pain = room.sim.village.jobs.boulanger.stock;
  pain.pain = clamp((pain.pain ?? 0) - HORDE_LOOT);
  if (!horde) return;
  horde.alive -= 1;
  horde.raided += 1;
  if (horde.alive <= 0) endHorde(room, horde);
}

function hordeMemberDown(room, data, who) {
  const horde = room.play.hordes.get(data.horde);
  if (!horde) return;
  horde.alive -= 1;
  if (who) horde.who.add(who);
  if (horde.alive <= 0) endHorde(room, horde);
}

function endHorde(room, horde) {
  room.play.hordes.delete(horde.id);
  const target = room.sim.zones[horde.zone];
  let e;
  if (horde.raided === 0) {
    // Repoussée : la zone d'où elle venait se calme nettement.
    if (target) { target.monsterPressure = clamp(target.monsterPressure - 15); room.syncZone(target.id); }
    e = pushEvent(room, 'horde_repelled', target?.id ?? null, { who: [...horde.who], label: horde.label });
  } else {
    e = pushEvent(room, 'horde_raid', null, { raided: horde.raided, who: [...horde.who], label: horde.label, fix: 'groupe' });
  }
  announce(room, e);
}

const zoneOfPos = (room, x, y) => zoneIndexAt(x, y, room.sim.width, room.sim.height);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function wood(room) {
  return room.sim.village.jobs.bucheron_mineur.stock;
}

function livingPlayers(room) {
  const out = [];
  room.state.joueurs.forEach((p, sid) => { if (!p.aTerre) out.push([sid, p]); });
  return out;
}

// ---------- Monstres ----------

function zoneBounds(room, zoneId) {
  const z = room.sim.zones[zoneId];
  return { x0: z.x * ZONE_TILES + 0.5, x1: (z.x + 1) * ZONE_TILES - 0.5, y0: z.y * ZONE_TILES + 0.5, y1: (z.y + 1) * ZONE_TILES - 0.5 };
}

// Distance d'un point au carré d'une zone (0 dedans).
function distToZone(room, zoneId, p) {
  const z = room.sim.zones[zoneId];
  const x0 = z.x * ZONE_TILES;
  const y0 = z.y * ZONE_TILES;
  const dx = Math.max(x0 - p.x, 0, p.x - (x0 + ZONE_TILES));
  const dy = Math.max(y0 - p.y, 0, p.y - (y0 + ZONE_TILES));
  return Math.hypot(dx, dy);
}

function randomPointIn(room, zoneId) {
  const b = zoneBounds(room, zoneId);
  const r = room.play.rng;
  return { x: b.x0 + r.next() * (b.x1 - b.x0), y: b.y0 + r.next() * (b.y1 - b.y0) };
}

function spawnMonsters(room, t) {
  const { play, sim } = room;
  const players = livingPlayers(room);
  // Zones actives : celle de chaque joueur, et les voisines dont il approche du bord.
  const active = new Set();
  const kept = new Set();
  for (const [, p] of players) {
    const z = sim.zones[zoneOfPos(room, p.x, p.y)];
    active.add(z.id);
    kept.add(z.id);
    for (const n of neighbors(sim, z)) {
      const d = distToZone(room, n.id, p);
      if (d <= SPAWN_REACH) active.add(n.id);
      if (d <= KEEP_REACH) kept.add(n.id);
    }
  }
  const counts = new Map();
  for (const [id, m] of play.monsters) {
    if (m.horde) continue; // une horde marche, qu'on la voie ou non
    if (!kept.has(m.zone)) { // plus personne autour : le monstre retourne dans la pression de sa zone
      play.monsters.delete(id);
      room.state.monstres.delete(id);
      continue;
    }
    counts.set(m.zone, (counts.get(m.zone) ?? 0) + 1);
  }
  for (const zoneId of active) {
    const z = sim.zones[zoneId];
    if (z.isVillage || z.closed) continue;
    const target = monsterTarget(z, isNight(room));
    const have = counts.get(zoneId) ?? 0;
    if (have >= target) continue;
    if ((play.spawnAt.get(zoneId) ?? 0) > t) continue;
    // Apparaît hors de vue immédiate des joueurs.
    let pos = null;
    for (let i = 0; i < 6 && !pos; i++) {
      const cand = randomPointIn(room, zoneId);
      if (players.every(([, p]) => dist(p, cand) >= 5) && !nearOutpost(room, cand.x, cand.y)) pos = cand;
    }
    if (!pos) continue;
    const kind = pickKind(room, z);
    const id = `m${play.nextId++}`;
    const m = new Monstre();
    m.sorte = kind.sorte;
    m.x = pos.x;
    m.y = pos.y;
    m.pv = kind.pv;
    m.pvMax = kind.pv;
    m.coup = 0;
    m.touche = 0;
    room.state.monstres.set(id, m);
    play.monsters.set(id, { zone: zoneId, kind, goal: pos, nextGoal: 0, lastHit: 0 });
    play.spawnAt.set(zoneId, t + SPAWN_GAP_MS);
  }
}

function moveMonsters(room, dt, t) {
  const { play } = room;
  const players = livingPlayers(room);
  for (const [id, data] of play.monsters) {
    const m = room.state.monstres.get(id);
    if (!m) { play.monsters.delete(id); continue; }
    const b = zoneBounds(room, data.zone);
    // Cible : le joueur vivant le plus proche, s'il est à portée de flair.
    let target = null;
    const spitter = data.kind.sorte === 'cracheur';
    let best = spitter ? (data.kind.portee ?? SPITTER.portee) : isNight(room) ? AGGRO_NIGHT : AGGRO;
    for (const [sid, p] of players) {
      const d = dist(m, p);
      if (d < best) { best = d; target = [sid, p]; }
    }
    // Les gardes en patrouille attirent aussi les monstres (les cracheurs ne visent que les joueurs).
    if (!spitter) {
      room.state.pnj?.forEach((g) => {
        if (g.sorte !== 'garde' || g.pv === 0) return;
        const d = dist(m, g);
        if (d < best) { best = d; target = [null, g]; }
      });
    }
    let goal;
    let speed = data.kind.vitesse;
    if (data.horde) { marchHorde(room, id, m, data, target, best, dt, t); continue; }
    if (target && spitter) {
      // Le cracheur recule s'il est serré de près, s'approche s'il est trop loin, et tire.
      const p = target[1];
      const d = best;
      if (d < 3) goal = { x: m.x + (m.x - p.x), y: m.y + (m.y - p.y) };
      else goal = null;
      if (t - data.lastHit >= data.kind.cadence) {
        data.lastHit = t;
        m.coup = (m.coup + 1) % 65536;
        shoot(room, m, p, data.kind.degats, t);
      }
    } else if (target) {
      goal = target[1];
      if (best <= REACH) {
        goal = null;
        if (t - data.lastHit >= data.kind.cadence) {
          data.lastHit = t;
          m.coup = (m.coup + 1) % 65536;
          if (target[0]) hurtPlayer(room, target[0], target[1], data.kind.degats, t);
          else { target[1].pv = Math.max(0, target[1].pv - data.kind.degats); target[1].touche = (target[1].touche + 1) % 65536; }
        }
      }
    } else {
      if (t >= data.nextGoal || dist(m, data.goal) < 0.3) {
        data.goal = randomPointIn(room, data.zone);
        data.nextGoal = t + 2000 + play.rng.next() * 3000;
      }
      goal = data.goal;
      speed *= 0.5; // errance tranquille
    }
    if (goal) {
      const next = stepPosition(m.x, m.y, { x: goal.x - m.x, y: goal.y - m.y }, dt * (speed / 5));
      // Chaque monstre reste sur son territoire (sa zone), et n'approche pas d'un avant-poste.
      const nx = Math.max(b.x0, Math.min(b.x1, next.x));
      const ny = Math.max(b.y0, Math.min(b.y1, next.y));
      if (!nearOutpost(room, nx, ny) || nearOutpost(room, m.x, m.y)) { m.x = nx; m.y = ny; }
    }
  }
}

// ---------- Projectiles ----------

function shoot(room, m, p, degats, t) {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const d = Math.hypot(dx, dy) || 1;
  const id = `p${room.play.nextId++}`;
  const pr = new Projectile();
  pr.x = m.x;
  pr.y = m.y;
  room.state.projectiles.set(id, pr);
  room.play.projectiles.set(id, { vx: (dx / d) * PROJECTILE_SPEED, vy: (dy / d) * PROJECTILE_SPEED, until: t + PROJECTILE_LIFE_MS, degats });
}

function moveProjectiles(room, dt, t) {
  for (const [id, data] of room.play.projectiles) {
    const pr = room.state.projectiles.get(id);
    if (!pr || t >= data.until) {
      room.play.projectiles.delete(id);
      room.state.projectiles.delete(id);
      continue;
    }
    pr.x += (data.vx * dt) / 1000;
    pr.y += (data.vy * dt) / 1000;
    for (const [sid, p] of room.state.joueurs) {
      if (p.aTerre || Math.hypot(p.x - pr.x, p.y - pr.y) > PROJECTILE_HIT) continue;
      if (!isDashing(room, sid, t)) hurtPlayer(room, sid, p, data.degats, t);
      room.play.projectiles.delete(id);
      room.state.projectiles.delete(id);
      break;
    }
  }
}

// ---------- Joueurs : vie, chute, relève ----------

function hurtPlayer(room, sid, p, amount, t) {
  if (p.aTerre || isDashing(room, sid, t)) return; // la roulade esquive les coups
  p.pv = Math.max(0, p.pv - amount);
  p.touche = (p.touche + 1) % 65536;
  room.play.regenAt.set(sid, t + REGEN_WILD_MS);
  if (p.pv === 0) {
    p.aTerre = true;
    p.bouge = false;
    room.play.downAt.set(sid, t);
    const zone = room.sim.zones[zoneOfPos(room, p.x, p.y)];
    pushEvent(room, 'player_down', zone.id, { who: [p.nom], label: zone.label });
  }
}

// À bout de forces, on se relève devant sa maison, ou à l'auberge.
function villageSpawn(room, p) {
  const s = spawnPoint(room, p.joueur);
  p.x = s.x + (room.play.rng.next() * 2 - 1) * 0.6;
  p.y = s.y;
}

// Faim et fatigue montent avec le temps de jeu ; l'effort fatigue aussi (voir addFatigue).
const HUNGER_MS = 18_000; // +1 de faim : environ une demi-heure de jeu pour avoir très faim
const TIREDNESS_MS = 25_000;
export function addFatigue(room, p, amount) {
  const acc = (room.play.fatigueAcc.get(p) ?? 0) + amount;
  const whole = Math.floor(acc);
  room.play.fatigueAcc.set(p, acc - whole);
  if (whole) setNeed(room, p, 'fatigue', p.fatigue + whole);
}
// Prévenir une fois quand une jauge franchit son seuil.
function setNeed(room, p, key, value) {
  const before = p[key];
  p[key] = Math.max(0, Math.min(100, value));
  const limit = key === 'faim' ? HUNGRY : TIRED;
  if (before < limit && p[key] >= limit) {
    const sid = [...room.state.joueurs.entries()].find(([, q]) => q === p)?.[0];
    const client = room.clients.find((c) => c.sessionId === sid);
    client?.send('info', key === 'faim' ? 'Vous avez faim : mangez un morceau de pain (R).' : 'Vous êtes fatigué : allez dormir (auberge ou maison).');
  }
}

function updateNeeds(room, p, sid, t) {
  const n = room.play.needs.get(sid) ?? { faim: t + HUNGER_MS, fatigue: t + TIREDNESS_MS };
  room.play.needs.set(sid, n);
  if (t >= n.faim) { n.faim = t + HUNGER_MS; setNeed(room, p, 'faim', p.faim + 1); }
  if (t >= n.fatigue) { n.fatigue = t + TIREDNESS_MS; setNeed(room, p, 'fatigue', p.fatigue + 1); }
}

function updatePlayers(room, t) {
  const { play } = room;
  room.state.joueurs.forEach((p, sid) => {
    updateNeeds(room, p, sid, t);
    if (p.aTerre) {
      // Revers, jamais de point de non-retour : on se relève au village, rien n'est perdu.
      if (t - (play.downAt.get(sid) ?? t) >= RESPAWN_MS) {
        villageSpawn(room, p);
        p.pv = p.pvMax;
        p.aTerre = false;
        play.downAt.delete(sid);
      }
      return;
    }
    // Le ventre creux, on ne reprend plus de forces tout seul (le pain, lui, soigne toujours).
    if (p.pv < p.pvMax && p.faim < HUNGRY && t >= (play.regenAt.get(sid) ?? 0)) {
      p.pv += 1;
      const safe = zoneOfPos(room, p.x, p.y) === room.sim.villageId || nearOutpost(room, p.x, p.y);
      play.regenAt.set(sid, t + (safe ? REGEN_VILLAGE_MS : REGEN_WILD_MS * regenFactor(p)));
    }
  });
}

export function updateGameplay(room, dt, t = Date.now()) {
  if (t - room.play.lastSpawnCheck >= SPAWN_CHECK_MS) {
    room.play.lastSpawnCheck = t;
    spawnMonsters(room, t);
  }
  moveMonsters(room, dt, t);
  moveProjectiles(room, dt, t);
  updatePlayers(room, t);
}

// ---------- Attaque ----------

const FACING = { droite: [1, 0], gauche: [-1, 0], bas: [0, 1], haut: [0, -1] };

export function playerAttack(room, sid, t = Date.now()) {
  const p = room.state.joueurs.get(sid);
  if (!p || p.aTerre) return;
  p.attaque = (p.attaque + 1) % 65536;
  addFatigue(room, p, 0.15);
  const [fx, fy] = FACING[p.dir] ?? [0, 1];
  for (const [id, data] of room.play.monsters) {
    const m = room.state.monstres.get(id);
    if (!m) continue;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > ATTACK_RANGE) continue;
    if (d > 0.4 && (dx * fx + dy * fy) / d < ATTACK_ARC_COS) continue;
    const tired = p.fatigue >= TIRED ? 1 : 0; // fatigué, on frappe moins fort (jamais moins de 1)
    m.pv = Math.max(0, m.pv - Math.max(1, (DAMAGE_BY_SWORD[p.epee] ?? 1) + damageBonus(p) - tired));
    m.touche = (m.touche + 1) % 65536;
    // Recul : le monstre est repoussé, dans les limites de sa zone.
    if (d > 0.01) {
      const b = zoneBounds(room, data.zone);
      m.x = Math.max(b.x0, Math.min(b.x1, m.x + (dx / d) * 0.6));
      m.y = Math.max(b.y0, Math.min(b.y1, m.y + (dy / d) * 0.6));
    }
    data.lastHit = t; // sonné : il ne riposte pas tout de suite
    if (m.pv === 0) killMonster(room, sid, p, id, data, t);
  }
}

// Un monstre vaincu par un garde : la zone recule comme pour un joueur, mais sans butin.
export function defeatMonster(room, id, t, who = null) {
  const data = room.play.monsters.get(id);
  if (!data) return;
  if (data.horde) hordeMemberDown(room, data, who);
  room.state.monstres.delete(id);
  room.play.monsters.delete(id);
  room.play.spawnAt.set(data.zone, t + RESPAWN_AFTER_KILL_MS);
  const zone = room.sim.zones[data.zone];
  zone.monsterPressure = clamp(zone.monsterPressure - 1);
  room.syncZone(data.zone);
}

function killMonster(room, sid, p, id, data, t) {
  const m = room.state.monstres.get(id);
  if (data.horde) hordeMemberDown(room, data, p.nom);
  dropLoot(room, data.kind.sorte, data.zone, m.x, m.y, t, p);
  room.state.monstres.delete(id);
  room.play.monsters.delete(id);
  room.play.spawnAt.set(data.zone, t + RESPAWN_AFTER_KILL_MS);
  const zone = room.sim.zones[data.zone];
  zone.monsterPressure = clamp(zone.monsterPressure - 1); // effet immédiat, visible sur la jauge
  const act = room.activity.get(sid);
  if (act) act.kills.set(data.zone, (act.kills.get(data.zone) ?? 0) + 1);
  room.syncZone(data.zone);
  progressKillQuests(room, p.nom, data.zone);
}

// ---------- Quêtes ----------

function progressOf(room, q) {
  let pr = room.play.questProgress.get(q.id);
  if (!pr) { pr = { points: 0, who: new Set() }; room.play.questProgress.set(q.id, pr); }
  return pr;
}

export function questGoal(q) {
  if (q.kind === 'patrouille' || q.kind === 'escorte') return QUEST_KILLS;
  if (q.kind === 'aide') return HELP_ACTS;
  return 0; // réparer et construire : suivies par l'état de la structure
}

// Avancement 0–100 d'une quête, pour l'interface.
export function questPercent(room, q) {
  const goal = questGoal(q);
  if (goal) return Math.round((Math.min(goal, room.play.questProgress.get(q.id)?.points ?? 0) / goal) * 100);
  const zone = room.sim.zones[q.zone];
  if (q.kind === 'reparer') {
    const s = zone.structures.find((st) => st.type === q.structure);
    return s ? Math.round(Math.min(1, s.condition / REPAIRED) * 100) : 0;
  }
  if (q.kind === 'construire') {
    const s = zone.structures.find((st) => st.type === TOWER);
    return s ? Math.round(Math.min(1, (s.building ? s.condition : TOWER_DONE) / TOWER_DONE) * 100) : 0;
  }
  return 0;
}

function completeQuest(room, q, who) {
  const v = room.sim.village;
  v.quests = v.quests.filter((x) => x.id !== q.id);
  room.play.questProgress.delete(q.id);
  if (q.job) v.jobs[q.job].helpedDay = room.sim.day;
  const e = pushEvent(room, 'quest_done', q.zone ?? null, {
    who: [...who], kind: q.kind, job: q.job ?? null, label: q.label ?? null, structure: q.structure ?? null,
  });
  announce(room, e);
  room.syncQuests();
}

function progressKillQuests(room, name, zoneId) {
  const { sim } = room;
  for (const q of [...sim.village.quests]) {
    let counts = false;
    if (q.kind === 'escorte') counts = q.zone === zoneId;
    if (q.kind === 'patrouille') {
      const field = sim.zones[q.zone];
      counts = zoneId === field.id || neighbors(sim, field).some((n) => n.id === zoneId && !n.isVillage);
    }
    if (!counts) continue;
    const pr = progressOf(room, q);
    pr.points += 1;
    pr.who.add(name);
    if (pr.points >= QUEST_KILLS) completeQuest(room, q, pr.who);
  }
  room.syncQuests();
}

// ---------- Touche E : ce qu'on peut faire ici ----------

// Un avant-poste peut se dresser dans une terre sauvage qui n'en a pas encore (ou dont le chantier
// est commencé). Il rend la zone plus sûre : moins de monstres, et l'on s'y soigne.
function outpostSite(zone) {
  if (zone.isVillage || zone.isField || zone.closed) return false;
  const s = zone.structures.find((st) => st.type === OUTPOST);
  return !s || s.building;
}

// Dormir (à l'auberge, ou dans son lit) : la fatigue s'efface, et l'on reprend quelques forces.
export function sleep(room, p, sid, tell) {
  if (p.fatigue < 10) return tell('Vous n\'avez pas sommeil.');
  p.fatigue = 0;
  p.pv = p.pvMax;
  room.clients.find((c) => c.sessionId === sid)?.send('dormi', true);
  return tell('Une bonne nuit de sommeil : vous voilà reposé.');
}

// ---------- Le travail de chacun, selon son métier ----------

// Ce qu'un personnage sait faire ici grâce à son métier (en plus de ce que tout le monde peut faire).
const PASTURE = new Set(['plaine', 'colline']);
function jobActionAt(zone, p) {
  switch (p.metier) {
    case 'agriculteur': return zone.isField ? { kind: 'recolter', label: 'récolter le blé' } : null;
    case 'bucheron_mineur': return !zone.isVillage && !zone.isField && (zone.resources.minerai ?? 0) > 0 ? { kind: 'miner', label: 'miner le filon' } : null;
    case 'eleveur': return !zone.isVillage && !zone.isField && PASTURE.has(zone.biome) ? { kind: 'tondre', label: 'soigner et tondre les bêtes' } : null;
    case 'boulanger': return zone.isVillage ? { kind: 'cuire', label: 'cuire du pain au fournil (2 blé)' } : null;
    case 'forgeron': return zone.isVillage ? { kind: 'forger-outils', label: 'forger des outils (1 minerai, 1 charbon)' } : null;
    default: return null;
  }
}

// Le rendement grandit avec le savoir-faire. Tout va aux réserves du village ; le mineur et
// l'éleveur gardent aussi une part pour eux (minerai, cuir).
function doJob(room, p, a, tell) {
  const jobs = room.sim.village.jobs;
  const sf = p.savoirFaire ?? 0;
  const bonus = Math.floor(sf / 25);
  const add = (stock, good, n) => { stock[good] = clamp((stock[good] ?? 0) + n); };
  switch (a.kind) {
    case 'recolter': {
      add(jobs.agriculteur.stock, 'ble', 2 + bonus);
      a.zone.pathWear = clamp(a.zone.pathWear + 1);
      return tell(`+${2 + bonus} blé pour le village`);
    }
    case 'miner': {
      if ((a.zone.monsterPressure ?? 0) >= 60) return tell('Trop de monstres rôdent autour du filon : dégagez la zone.');
      add(jobs.bucheron_mineur.stock, 'minerai', 1 + bonus);
      add(jobs.bucheron_mineur.stock, 'charbon', 1);
      if (room.play.rng.next() < 0.4 + sf / 200) { addItem(p, 'minerai'); return tell(`+${1 + bonus} minerai au village, et un pour votre sac`); }
      return tell(`+${1 + bonus} minerai et du charbon pour le village`);
    }
    case 'tondre': {
      if (room.play.rng.next() < 0.3 + sf / 200) { addItem(p, 'cuir'); return tell('Les bêtes sont belles : +1 cuir pour votre sac'); }
      add(jobs.agriculteur.stock, 'ble', 1); // le fumier engraisse les champs
      return tell('Les bêtes sont soignées ; leur fumier enrichira les champs.');
    }
    case 'cuire': {
      if ((jobs.agriculteur.stock.ble ?? 0) < 2) return tell('Plus de blé au grenier : il faut récolter les champs.');
      jobs.agriculteur.stock.ble -= 2;
      add(jobs.boulanger.stock, 'pain', 2 + bonus);
      room.state.pain = jobs.boulanger.stock.pain;
      return tell(`+${2 + bonus} pains au fournil`);
    }
    case 'forger-outils': {
      const s = jobs.bucheron_mineur.stock;
      if ((s.minerai ?? 0) < 1 || (s.charbon ?? 0) < 1) return tell('Il faut du minerai et du charbon : la mine doit tourner.');
      s.minerai -= 1;
      s.charbon -= 1;
      add(jobs.forgeron.stock, 'outils', 1 + (bonus >= 2 ? 1 : 0));
      room.state.outils = jobs.forgeron.stock.outils;
      return tell(`+${1 + (bonus >= 2 ? 1 : 0)} outil${bonus >= 2 ? 's' : ''} à la forge du village`);
    }
    default: return undefined;
  }
}

// Renvoie l'action possible à cet endroit (sans l'exécuter), ou null.
export function actionAt(room, p) {
  const { sim } = room;
  const zone = sim.zones[zoneOfPos(room, p.x, p.y)];
  const lost = room.pnj ? lostNear(room, p) : null;
  if (lost) return { kind: 'egare', zone, key: lost[0], label: `secourir ${lost[1].prenom}` };
  if (zone.isVillage && room.players) {
    const house = houseActionAt(room, p);
    if (house) return { ...house, zone };
  }
  const quests = sim.village.quests;
  const build = quests.find((q) => q.kind === 'construire' && q.zone === zone.id);
  if (build) return { kind: 'construire', zone, quest: build, label: `bâtir la tour de guet (${BUILD_WOOD} bois)` };
  const damaged = zone.structures.find((s) => !s.protected && !s.building && s.condition < 90);
  if (damaged) return { kind: 'reparer', zone, structure: damaged, label: `réparer : ${damaged.type} (${REPAIR_WOOD} bois)` };
  const job = jobActionAt(zone, p);
  if (job) return { ...job, zone };
  if (zone.isVillage) {
    const help = quests.find((q) => q.kind === 'aide');
    if (help) return { kind: 'aide', zone, quest: help, label: `donner un coup de main (${help.job.replace('_', '-')})` };
  }
  const rare = zone.isVillage || zone.isField ? null : rareAt(room, zone);
  if (rare && zone.resources[rare] > 0) return { kind: 'rare', zone, rare, label: `extraire : ${rare}${zone.monsterPressure >= 40 ? ' (zone à dégager)' : ''}` };
  if (outpostSite(zone)) {
    const o = outpostPos(zone);
    if (Math.hypot(o.x - p.x, o.y - p.y) <= 2.5) {
      const label = zone.monsterPressure >= OUTPOST_MAX_PRESSURE ? 'avant-poste : dégagez d\'abord la zone' : `dresser un avant-poste (${OUTPOST_STEP_WOOD} bois)`;
      return { kind: 'avant-poste', zone, label };
    }
  }
  if (zone.biome === 'foret' && !zone.isField) return { kind: 'bois', zone, label: 'couper du bois' };
  return null;
}

export function playerInteract(room, sid, t = Date.now()) {
  const p = room.state.joueurs.get(sid);
  const client = room.clients.find((c) => c.sessionId === sid);
  const tell = (text) => client?.send('info', text);
  if (!p || p.aTerre) return;
  if (t - (room.play.lastInteract.get(sid) ?? 0) < INTERACT_COOLDOWN_MS) return;
  room.play.lastInteract.set(sid, t);
  const a = actionAt(room, p);
  if (!a) return;
  const stock = wood(room);

  if (a.kind === 'rare') return extractRare(room, sid, a.zone, a.rare);

  if (a.kind === 'maison') return buildHouse(room, p, a.lot, tell);
  if (a.kind === 'coffre') { client?.send('coffre', true); return undefined; }

  if (a.kind === 'egare') {
    const e = room.state.pnj.get(a.key);
    followPlayer(room, a.key, sid, p);
    return tell(`${e.prenom} vous suit. Direction le village, à l'abri des monstres !`);
  }

  if (a.kind === 'dormir') return sleep(room, p, sid, tell);
  if (['recolter', 'miner', 'tondre', 'cuire', 'forger-outils'].includes(a.kind)) { addFatigue(room, p, 0.4); return doJob(room, p, a, tell); }

  if (a.kind === 'bois') addFatigue(room, p, 0.4);
  if (a.kind === 'bois') {
    if ((stock.bois ?? 0) >= 100) return tell('La réserve de bois du village est pleine.');
    const n = woodPerCut(p.metier, p);
    stock.bois = clamp((stock.bois ?? 0) + n);
    a.zone.vegetation = clamp(a.zone.vegetation - 1);
    room.state.bois = stock.bois;
    return tell(`+${n} bois pour le village`);
  }

  if (a.kind === 'aide') {
    const job = room.sim.village.jobs[a.quest.job];
    const good = HELP_OUTPUT[a.quest.job];
    job.stock[good] = clamp((job.stock[good] ?? 0) + 3);
    const pr = progressOf(room, a.quest);
    pr.points += 1;
    pr.who.add(p.nom);
    if (pr.points >= HELP_ACTS) completeQuest(room, a.quest, pr.who);
    else room.syncQuests();
    return tell('Un coup de main de plus au village');
  }

  if (a.kind === 'reparer') {
    if ((stock.bois ?? 0) < REPAIR_WOOD) return tell(`Il faut ${REPAIR_WOOD} bois : allez en couper en forêt.`);
    stock.bois -= REPAIR_WOOD;
    room.state.bois = stock.bois;
    const s = a.structure;
    const before = s.condition;
    s.condition = clamp(s.condition + REPAIR_STEP);
    s.maintainedDay = room.sim.day;
    if (s.condition >= 50) s.warned = null;
    const key = `${a.zone.id}|${s.type}`;
    if (!room.play.repairers.has(key)) room.play.repairers.set(key, new Set());
    room.play.repairers.get(key).add(p.nom);
    if (before < REPAIRED && s.condition >= REPAIRED) {
      const who = room.play.repairers.get(key);
      room.play.repairers.delete(key);
      const q = room.sim.village.quests.find((x) => x.kind === 'reparer' && x.zone === a.zone.id && x.structure === s.type);
      if (q) completeQuest(room, q, who);
      else announce(room, pushEvent(room, 'quest_done', a.zone.id, { who: [...who], kind: 'reparer', job: null, label: a.zone.label, structure: s.type }));
    }
    room.syncZone(a.zone.id);
    room.syncQuests();
    return tell(`${s.type} : réparé à ${s.condition} %`);
  }

  if (a.kind === 'avant-poste') {
    if (a.zone.monsterPressure >= OUTPOST_MAX_PRESSURE) return tell('Trop de monstres rôdent ici : dégagez la zone avant de vous y installer.');
    if ((stock.bois ?? 0) < OUTPOST_STEP_WOOD) return tell(`Il faut ${OUTPOST_STEP_WOOD} bois : allez en couper en forêt.`);
    stock.bois -= OUTPOST_STEP_WOOD;
    room.state.bois = stock.bois;
    let s = a.zone.structures.find((st) => st.type === OUTPOST);
    if (!s) {
      s = { type: OUTPOST, condition: 0, building: true, warned: null };
      a.zone.structures.push(s);
    }
    s.condition = clamp(s.condition + OUTPOST_STEP);
    s.maintainedDay = room.sim.day;
    const key = `${a.zone.id}|${OUTPOST}`;
    if (!room.play.repairers.has(key)) room.play.repairers.set(key, new Set());
    room.play.repairers.get(key).add(p.nom);
    if (s.condition >= TOWER_DONE) {
      s.building = false;
      const who = [...room.play.repairers.get(key)];
      room.play.repairers.delete(key);
      announce(room, pushEvent(room, 'outpost_built', a.zone.id, { who, label: a.zone.label, dist: a.zone.dist }));
    }
    room.syncZone(a.zone.id);
    return tell(s.building ? `Avant-poste : ${Math.round((s.condition / TOWER_DONE) * 100)} %` : 'L\'avant-poste est dressé : la zone est plus sûre.');
  }

  if (a.kind === 'construire') {
    if ((stock.bois ?? 0) < BUILD_WOOD) return tell(`Il faut ${BUILD_WOOD} bois : allez en couper en forêt.`);
    stock.bois -= BUILD_WOOD;
    room.state.bois = stock.bois;
    let s = a.zone.structures.find((st) => st.type === TOWER);
    if (s && !s.building && s.condition > 0) return; // déjà debout
    const pr = progressOf(room, a.quest);
    pr.who.add(p.nom);
    if (!s) {
      s = { type: TOWER, condition: 0, building: true, warned: null };
      a.zone.structures.push(s);
      pushEvent(room, 'construction_started', a.zone.id, { who: [p.nom], label: a.zone.label, structure: TOWER });
    } else if (!s.building) {
      s.building = true;
      s.condition = 0;
    }
    s.condition = clamp(s.condition + BUILD_STEP);
    s.maintainedDay = room.sim.day;
    if (s.condition >= TOWER_DONE) {
      s.building = false;
      const v = room.sim.village;
      v.quests = v.quests.filter((x) => x.id !== a.quest.id);
      room.play.questProgress.delete(a.quest.id);
      announce(room, pushEvent(room, 'structure_built', a.zone.id, { who: [...pr.who], label: a.zone.label, structure: TOWER }));
    }
    room.syncZone(a.zone.id);
    room.syncQuests();
    return tell(s.building ? `Chantier : ${Math.round((s.condition / TOWER_DONE) * 100)} %` : 'La tour de guet est debout !');
  }
  return undefined;
}

// Libellé de l'action E de chaque joueur (affiché par le client).
export function updateActions(room) {
  room.state.joueurs.forEach((p) => {
    const a = p.aTerre ? null : actionAt(room, p);
    const label = a ? a.label : '';
    if (p.action !== label) p.action = label;
  });
}
