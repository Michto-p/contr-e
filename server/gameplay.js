// Gameplay temps réel du serveur : monstres qu'on combat, points de vie, touche E (réparer,
// bâtir, aider, ramasser du bois) et quêtes du village validées par les vrais joueurs.
// Tout ce qui se passe ici retombe dans la simulation : un monstre tué compte comme un combat
// dans sa zone, une réparation remet la structure en état, une quête terminée aide son métier.
import { createRng } from '../src/sim/rng.js';
import { clamp, neighbors } from '../src/sim/world.js';
import { TOWER } from '../src/sim/systems/village.js';
import { pushEvent, announce } from './evenements.js';
import { ZONE_TILES, zoneIndexAt, stepPosition } from '../shared/monde.js';
import { Monstre, Projectile } from './schema.js';
import { dropLoot, isDashing, rareAt, extractRare, DAMAGE_BY_SWORD } from './objets.js';

export const PLAYER_PV = 10;
const ATTACK_RANGE = 1.8; // tuiles
const ATTACK_ARC_COS = Math.cos(1.25); // environ 70° de part et d'autre du regard
const RESPAWN_MS = 3000;
const REGEN_VILLAGE_MS = 1000;
const REGEN_WILD_MS = 10_000;
const SPAWN_CHECK_MS = 500;
const SPAWN_GAP_MS = 3000; // entre deux apparitions dans une même zone
const RESPAWN_AFTER_KILL_MS = 15_000; // une zone nettoyée reste tranquille un moment
const AGGRO = 5; // tuiles
const REACH = 0.9;
export const KILLS_PER_HOUR_CAP = 3; // au-delà, les monstres tués ne comptent plus pour la simulation
export const INTERACT_COOLDOWN_MS = 600;

export const REPAIR_WOOD = 2;
export const BUILD_WOOD = 3;
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

export const monsterCountFor = (p) => (p < 12 ? 0 : Math.min(6, Math.round(p / 15)));
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
  };
}

export { pushEvent };

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

function randomPointIn(room, zoneId) {
  const b = zoneBounds(room, zoneId);
  const r = room.play.rng;
  return { x: b.x0 + r.next() * (b.x1 - b.x0), y: b.y0 + r.next() * (b.y1 - b.y0) };
}

function spawnMonsters(room, t) {
  const { play, sim } = room;
  const players = livingPlayers(room);
  // Zones actives : celle de chaque joueur et ses voisines.
  const active = new Set();
  for (const [, p] of players) {
    const z = sim.zones[zoneOfPos(room, p.x, p.y)];
    active.add(z.id);
    for (const n of neighbors(sim, z)) active.add(n.id);
  }
  const counts = new Map();
  for (const [id, m] of play.monsters) {
    if (!active.has(m.zone)) { // plus personne autour : le monstre retourne dans la pression de sa zone
      play.monsters.delete(id);
      room.state.monstres.delete(id);
      continue;
    }
    counts.set(m.zone, (counts.get(m.zone) ?? 0) + 1);
  }
  for (const zoneId of active) {
    const z = sim.zones[zoneId];
    if (z.isVillage || z.closed) continue;
    const target = monsterCountFor(z.monsterPressure);
    const have = counts.get(zoneId) ?? 0;
    if (have >= target) continue;
    if ((play.spawnAt.get(zoneId) ?? 0) > t) continue;
    // Apparaît hors de vue immédiate des joueurs.
    let pos = null;
    for (let i = 0; i < 6 && !pos; i++) {
      const cand = randomPointIn(room, zoneId);
      if (players.every(([, p]) => dist(p, cand) >= 5)) pos = cand;
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
    let best = spitter ? (data.kind.portee ?? SPITTER.portee) : AGGRO;
    for (const [sid, p] of players) {
      const d = dist(m, p);
      if (d < best) { best = d; target = [sid, p]; }
    }
    let goal;
    let speed = data.kind.vitesse;
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
          hurtPlayer(room, target[0], target[1], data.kind.degats, t);
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
      // Chaque monstre reste sur son territoire (sa zone).
      m.x = Math.max(b.x0, Math.min(b.x1, next.x));
      m.y = Math.max(b.y0, Math.min(b.y1, next.y));
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

function villageSpawn(room, p) {
  const v = room.sim.zones[room.sim.villageId];
  p.x = (v.x + 0.5) * ZONE_TILES + (room.play.rng.next() * 2 - 1);
  p.y = (v.y + 0.5) * ZONE_TILES + 1.5;
}

function updatePlayers(room, t) {
  const { play } = room;
  room.state.joueurs.forEach((p, sid) => {
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
    if (p.pv < p.pvMax && t >= (play.regenAt.get(sid) ?? 0)) {
      p.pv += 1;
      const inVillage = zoneOfPos(room, p.x, p.y) === room.sim.villageId;
      play.regenAt.set(sid, t + (inVillage ? REGEN_VILLAGE_MS : REGEN_WILD_MS));
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
  const [fx, fy] = FACING[p.dir] ?? [0, 1];
  for (const [id, data] of room.play.monsters) {
    const m = room.state.monstres.get(id);
    if (!m) continue;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > ATTACK_RANGE) continue;
    if (d > 0.4 && (dx * fx + dy * fy) / d < ATTACK_ARC_COS) continue;
    m.pv = Math.max(0, m.pv - (DAMAGE_BY_SWORD[p.epee] ?? 1));
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

function killMonster(room, sid, p, id, data, t) {
  const m = room.state.monstres.get(id);
  dropLoot(room, data.kind.sorte, data.zone, m.x, m.y, t);
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

// Renvoie l'action possible à cet endroit (sans l'exécuter), ou null.
export function actionAt(room, p) {
  const { sim } = room;
  const zone = sim.zones[zoneOfPos(room, p.x, p.y)];
  const quests = sim.village.quests;
  const build = quests.find((q) => q.kind === 'construire' && q.zone === zone.id);
  if (build) return { kind: 'construire', zone, quest: build, label: `bâtir la tour de guet (${BUILD_WOOD} bois)` };
  const damaged = zone.structures.find((s) => !s.protected && !s.building && s.condition < 90);
  if (damaged) return { kind: 'reparer', zone, structure: damaged, label: `réparer : ${damaged.type} (${REPAIR_WOOD} bois)` };
  if (zone.isVillage) {
    const help = quests.find((q) => q.kind === 'aide');
    if (help) return { kind: 'aide', zone, quest: help, label: `donner un coup de main (${help.job.replace('_', '-')})` };
  }
  const rare = zone.isVillage || zone.isField ? null : rareAt(room, zone);
  if (rare && zone.resources[rare] > 0) return { kind: 'rare', zone, rare, label: `extraire : ${rare}${zone.monsterPressure >= 40 ? ' (zone à dégager)' : ''}` };
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

  if (a.kind === 'bois') {
    if ((stock.bois ?? 0) >= 100) return tell('La réserve de bois du village est pleine.');
    stock.bois = clamp((stock.bois ?? 0) + 1);
    a.zone.vegetation = clamp(a.zone.vegetation - 1);
    room.state.bois = stock.bois;
    return tell('+1 bois pour le village');
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
