// Butin, sac, forge et soins : de quoi s'équiper en jouant, en s'appuyant sur le village.
// - Les monstres lâchent du minerai, du cuir et, là où la contrée en recèle, ses ressources rares.
// - La forge du village transforme le butin en épée, armure et bottes ; chaque objet consomme
//   un outil du forgeron (l'économie de la simulation compte donc aussi pour les joueurs).
// - Le pain du boulanger soigne. Sans champs gardés, plus de pain : tout se tient.
import { clamp } from '../src/sim/world.js';
import { zoneIndexAt } from '../shared/monde.js';
import { Butin } from './schema.js';
import { pushEvent, announce } from './evenements.js';

export const LOOT_LIFETIME_MS = 60_000;
const PICKUP_RADIUS = 0.9;
export const EAT_COOLDOWN_MS = 2500;
import { pvBonus, breadHeal, lootFactor } from '../shared/competences.js';
export const EAT_HEAL = 4;
export const DASH_COOLDOWN_MS = 1200;
export const EXTRACT_MAX_PRESSURE = 40; // un gisement ne s'exploite que dans une zone dégagée

export const PV_BY_ARMOR = [0, 10, 14, 18];
export const DAMAGE_BY_SWORD = [0, 1, 2, 3, 4];
export const TALISMAN_PV = 4;

// Recettes de la forge. `rares` : nombre de ressources rares (n'importe lesquelles de la contrée).
export const RECETTES = [
  { id: 'epee2', nom: 'Lame d\'acier', effet: 'épée niveau 2 : 2 dégâts par coup', slot: 'epee', niveau: 2, requis: { minerai: 3, cuir: 1 }, rares: 0 },
  { id: 'epee3', nom: 'Lame de légende', effet: 'épée niveau 3 : 3 dégâts par coup', slot: 'epee', niveau: 3, requis: { minerai: 4 }, rares: 2 },
  { id: 'armure2', nom: 'Cuirasse de cuir', effet: 'armure niveau 2 : 14 points de vie', slot: 'armure', niveau: 2, requis: { cuir: 4 }, rares: 0 },
  { id: 'armure3', nom: 'Cotte renforcée', effet: 'armure niveau 3 : 18 points de vie', slot: 'armure', niveau: 3, requis: { cuir: 3, minerai: 2 }, rares: 2 },
  { id: 'bottes', nom: 'Bottes de marche', effet: 'on se déplace plus vite', slot: 'bottes', niveau: 1, requis: { cuir: 3 }, rares: 0 },
];

// Recette tirée d'un plan inventé au village (voir src/sim/systems/population.js).
export function planRecipe(plan) {
  if (plan.type === 'lame') {
    return { id: `plan${plan.id}`, nom: plan.nom, effet: plan.effet, slot: 'epee', niveau: 4, prerequis: 2, requis: { minerai: 3 }, materiau: plan.materiau, rares: 0, auteur: plan.auteur };
  }
  return { id: `plan${plan.id}`, nom: plan.nom, effet: plan.effet, slot: 'talisman', niveau: 1, prerequis: 0, requis: { cuir: 2 }, materiau: plan.materiau, rares: 0, auteur: plan.auteur };
}

export function allRecipes(room) {
  return [...RECETTES, ...(room.sim.village.population?.plans ?? []).map(planRecipe)];
}

// Ce que lâche chaque sorte de monstre : [objet, chance].
const DROPS = {
  gluant: [['minerai', 0.3]],
  rodeur: [['cuir', 0.6]],
  brute: [['cuir', 1], ['minerai', 0.5]],
  cracheur: [['minerai', 0.4], ['cuir', 0.2]],
};
const RARE_DROP = 0.35;

export function initObjets(room) {
  room.objets = { nextId: 1, loot: new Map(), lastEat: new Map(), lastDash: new Map(), dashUntil: new Map(), dashDir: new Map() };
}

function tell(room, sid, text) {
  room.clients.find((c) => c.sessionId === sid)?.send('info', text);
}

export function bagCount(p, item) {
  return p.sac.get(item) ?? 0;
}

export function addItem(p, item, n = 1) {
  p.sac.set(item, Math.min(999, bagCount(p, item) + n));
}

function removeItem(p, item, n) {
  const left = bagCount(p, item) - n;
  if (left > 0) p.sac.set(item, left);
  else p.sac.delete(item);
}

export function raresIn(room, p) {
  return room.sim.signature.exclusives.reduce((sum, r) => sum + bagCount(p, r), 0);
}

// ---------- Butin ----------

// `killer` : le joueur qui a vaincu le monstre (son flair rend le butin plus fréquent).
export function dropLoot(room, sorte, zoneId, x, y, t = Date.now(), killer = null) {
  const r = room.play.rng;
  const items = [];
  const luck = lootFactor(killer);
  // Le flair rend un butin incertain plus fréquent ; un butin certain le reste.
  for (const [item, chance] of DROPS[sorte] ?? []) if (r.next() < (chance >= 1 ? 1 : Math.min(0.95, chance * luck))) items.push(item);
  const zone = room.sim.zones[zoneId];
  const rares = room.sim.signature.exclusives.filter((res) => zone.resources[res] > 0);
  if (rares.length && r.next() < RARE_DROP) items.push(r.pick(rares));
  items.forEach((item, i) => {
    const id = `b${room.objets.nextId++}`;
    const b = new Butin();
    b.sorte = item;
    b.x = x + (i - (items.length - 1) / 2) * 0.5;
    b.y = y + 0.2;
    room.state.butins.set(id, b);
    room.objets.loot.set(id, { until: t + LOOT_LIFETIME_MS });
  });
}

function updateLoot(room, t) {
  for (const [id, info] of room.objets.loot) {
    const b = room.state.butins.get(id);
    if (!b || t >= info.until) {
      room.objets.loot.delete(id);
      room.state.butins.delete(id);
      continue;
    }
    for (const [sid, p] of room.state.joueurs) {
      if (p.aTerre || p.interieur >= 0 || Math.hypot(p.x - b.x, p.y - b.y) > PICKUP_RADIUS) continue;
      addItem(p, b.sorte);
      room.objets.loot.delete(id);
      room.state.butins.delete(id);
      tell(room, sid, `+1 ${b.sorte}`);
      break;
    }
  }
}

// ---------- Roulade ----------

export function isDashing(room, sid, t = Date.now()) {
  return (room.objets.dashUntil.get(sid) ?? 0) > t;
}

export function playerDash(room, sid, dashMs, t = Date.now()) {
  const p = room.state.joueurs.get(sid);
  if (!p || p.aTerre) return false;
  if (t - (room.objets.lastDash.get(sid) ?? 0) < DASH_COOLDOWN_MS) return false;
  room.objets.lastDash.set(sid, t);
  room.objets.dashUntil.set(sid, t + dashMs);
  p.roulade = (p.roulade + 1) % 65536;
  return true;
}

// ---------- Pain ----------

export function playerEat(room, sid, t = Date.now()) {
  const p = room.state.joueurs.get(sid);
  if (!p || p.aTerre) return;
  if (t - (room.objets.lastEat.get(sid) ?? 0) < EAT_COOLDOWN_MS) return;
  if (p.pv >= p.pvMax && p.faim < 15) return tell(room, sid, 'Vous n\'avez pas faim.');
  const stock = room.sim.village.jobs.boulanger.stock;
  if ((stock.pain ?? 0) < 1) return tell(room, sid, 'Plus de pain au village : il faut des champs bien gardés.');
  room.objets.lastEat.set(sid, t);
  stock.pain -= 1;
  room.state.pain = stock.pain;
  const heal = breadHeal(p.metier, p);
  p.pv = Math.min(p.pvMax, p.pv + heal);
  p.faim = Math.max(0, p.faim - 35);
  return tell(room, sid, `Un morceau de pain : +${heal} PV, la faim s'apaise`);
}

// ---------- Gisements rares ----------

export function rareAt(room, zone) {
  return room.sim.signature.exclusives.find((r) => zone.resources[r] > 0) ?? null;
}

export function extractRare(room, sid, zone, rare) {
  const p = room.state.joueurs.get(sid);
  if (zone.monsterPressure >= EXTRACT_MAX_PRESSURE) {
    return tell(room, sid, `Trop de monstres pour extraire ${rare} : dégagez d'abord la zone.`);
  }
  if (!room.registry[p.nom]) room.registry[p.nom] = { lastDay: room.sim.day };
  const known = room.registry[p.nom].rares ?? [];
  addItem(p, rare);
  zone.resources[rare] = clamp(zone.resources[rare] - 2, 0, 100);
  if (!known.includes(rare)) {
    room.registry[p.nom].rares = [...known, rare];
    announce(room, pushEvent(room, 'discovery', zone.id, { who: [p.nom], label: zone.label, resources: [rare] }));
  }
  return tell(room, sid, `+1 ${rare}`);
}

// ---------- Forge ----------

export function applyGear(p) {
  p.pvMax = (PV_BY_ARMOR[p.armure] ?? 10) + (p.talisman ? TALISMAN_PV : 0) + pvBonus(p);
  if (p.pv > p.pvMax) p.pv = p.pvMax;
}

export function canCraft(room, p, recette) {
  const current = p[recette.slot] ?? 0;
  if (current >= recette.niveau) return 'déjà équipé';
  if (current < (recette.prerequis ?? recette.niveau - 1)) return 'il faut d\'abord le niveau précédent';
  for (const [item, n] of Object.entries(recette.requis)) if (bagCount(p, item) < n) return `il manque du ${item}`;
  if (recette.materiau && bagCount(p, recette.materiau) < 1) return `il faut du ${recette.materiau}`;
  if (raresIn(room, p) < recette.rares) return 'il manque des ressources rares';
  return null;
}

export function playerCraft(room, sid, recetteId) {
  const p = room.state.joueurs.get(sid);
  const recette = allRecipes(room).find((r) => r.id === recetteId);
  if (!p || !recette || p.aTerre) return;
  if (zoneIndexAt(p.x, p.y, room.sim.width, room.sim.height) !== room.sim.villageId) {
    return tell(room, sid, 'La forge est au village.');
  }
  const why = canCraft(room, p, recette);
  if (why) return tell(room, sid, `Impossible : ${why}.`);
  const forge = room.sim.village.jobs.forgeron;
  if ((forge.stock.outils ?? 0) < 1) return tell(room, sid, 'Le forgeron n\'a plus d\'outils : la mine doit tourner.');
  forge.stock.outils -= 1;
  room.state.outils = forge.stock.outils;
  for (const [item, n] of Object.entries(recette.requis)) removeItem(p, item, n);
  if (recette.materiau) removeItem(p, recette.materiau, 1);
  let rares = recette.rares;
  for (const r of room.sim.signature.exclusives) {
    const take = Math.min(rares, bagCount(p, r));
    if (take) removeItem(p, r, take);
    rares -= take;
  }
  p[recette.slot] = recette.niveau;
  applyGear(p);
  forge.helpedDay = room.sim.day; // commander au forgeron le fait travailler
  savePlayer(room, p);
  announce(room, pushEvent(room, 'forged', null, { who: [p.nom], item: recette.nom }));
  return tell(room, sid, `${recette.nom} : ${recette.effet}.`);
}

// ---------- Persistance de l'équipement ----------

export function savePlayer(room, p) {
  const entry = room.registry[p.nom] ?? { lastDay: room.sim.day };
  entry.gear = { epee: p.epee, armure: p.armure, bottes: p.bottes, talisman: p.talisman };
  entry.sac = Object.fromEntries(p.sac.entries());
  entry.faim = p.faim;
  entry.fatigue = p.fatigue;
  entry.savedAt = Date.now();
  room.registry[p.nom] = entry;
}

export function restorePlayer(room, p) {
  const entry = room.registry[p.nom];
  p.epee = entry?.gear?.epee ?? 1;
  p.armure = entry?.gear?.armure ?? 1;
  p.bottes = entry?.gear?.bottes ?? 0;
  p.talisman = entry?.gear?.talisman ?? 0;
  for (const [item, n] of Object.entries(entry?.sac ?? {})) p.sac.set(item, n);
  applyGear(p);
  p.pv = p.pvMax;
  // Resté longtemps au village, le personnage y a mangé et dormi.
  const rested = Date.now() - (entry?.savedAt ?? 0) > 10 * 60_000;
  p.faim = rested ? 0 : entry?.faim ?? 0;
  p.fatigue = rested ? 0 : entry?.fatigue ?? 0;
}

export function updateObjets(room, t = Date.now()) {
  updateLoot(room, t);
  const pain = room.sim.village.jobs.boulanger.stock.pain ?? 0;
  if (room.state.pain !== pain) room.state.pain = pain;
  const outils = room.sim.village.jobs.forgeron.stock.outils ?? 0;
  if (room.state.outils !== outils) room.state.outils = outils;
}

// ---------- Offrandes : rapporter au village ce qu'on trouve au loin ----------

export function playerOffer(room, sid, rare) {
  const p = room.state.joueurs.get(sid);
  const pop = room.sim.village.population;
  if (!p || p.aTerre || !pop) return;
  if (!room.sim.signature.exclusives.includes(rare) || bagCount(p, rare) < 1) return;
  if (zoneIndexAt(p.x, p.y, room.sim.width, room.sim.height) !== room.sim.villageId) {
    return tell(room, sid, 'C\'est au village qu\'on confie ses trouvailles.');
  }
  removeItem(p, rare, 1);
  pop.rares[rare] = (pop.rares[rare] ?? 0) + 1;
  savePlayer(room, p);
  announce(room, pushEvent(room, 'offering', null, { who: [p.nom], materiau: rare }));
  return tell(room, sid, 'Le forgeron examine votre trouvaille avec curiosité.');
}
