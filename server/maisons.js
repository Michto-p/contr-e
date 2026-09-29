// L'auberge et les maisons des joueurs. Tout le monde commence à l'auberge ; plus tard, un joueur
// bâtit sa maison sur un terrain libre du village (avec ce qu'il a rapporté et le bois du village).
// La maison a un coffre, commun à tous les personnages du joueur, et c'est là qu'il reprend ses
// esprits quand il tombe. Une maison au village est protégée : elle ne s'abîme jamais.
import { ZONE_TILES, INN_DOOR, ROOM_W, ROOM_H, ROOM_FURNITURE, lotCount, lotDoor, ruinTile } from '../shared/monde.js';
import { clamp } from '../src/sim/world.js';
import { bagCount, addItem } from './objets.js';
import { pushEvent, announce } from './evenements.js';
import { setFoyer, restoreRuin } from '../src/sim/systems/population.js';

export const HOUSE_COST = { cuir: 4, minerai: 4 };
export const HOUSE_WOOD = 10;
const REACH = 1.6;

// Géométrie des terrains : le cœur du village, puis les faubourgs dans l'ordre où ils sont nés.
export const geoOf = (room) => ({ villageId: room.sim.villageId, width: room.sim.width, faubourgs: room.sim.village.faubourgs ?? [] });
// Un terrain est pris par une maison, ou par les ruines de celle d'un joueur parti.
const usedLots = (room) => new Set([
  ...Object.values(room.players).map((a) => a.maison).filter((m) => m != null),
  ...(room.sim.village.ruines ?? []).filter((r) => r.kind === 'lot').map((r) => r.index),
]);

function villageCorner(room) {
  const v = room.sim.zones[room.sim.villageId];
  return { x: v.x * ZONE_TILES, y: v.y * ZONE_TILES };
}

// Au chargement : les maisons se voient sur la carte ; les anciennes « maisons de X » (données
// d'office) deviennent de vraies maisons sur un terrain, tant qu'il en reste.
export function initHouses(room) {
  const v = room.sim.zones[room.sim.villageId];
  for (const st of v.structures.filter((s) => s.type.startsWith('maison de '))) {
    const joueur = st.type.slice('maison de '.length);
    const account = room.players[joueur];
    if (account && account.maison == null) {
      const lot = freeLot(room);
      if (lot != null) account.maison = lot;
    }
  }
  v.structures = v.structures.filter((s) => !s.type.startsWith('maison de ') || !room.players[s.type.slice('maison de '.length)]);
  syncHouses(room);
  syncRuins(room);
}

export function syncHouses(room) {
  room.sim.village.playerHouses = usedLots(room).size; // la simulation agrandit le village quand les terrains manquent
  for (const [joueur, account] of Object.entries(room.players)) {
    if (account.maison != null) setFoyer(room.sim, joueur); // avec une maison, on peut fonder une famille
    if (account.maison != null && room.state.maisons.get(String(account.maison)) !== joueur) room.state.maisons.set(String(account.maison), joueur);
  }
}

export function freeLot(room) {
  const used = usedLots(room);
  for (let k = 0; k < lotCount(geoOf(room).faubourgs); k++) if (!used.has(k)) return k;
  return null;
}

// Où l'on apparaît (et où l'on revient à bout de forces) : devant sa maison, sinon à l'auberge.
export function spawnPoint(room, joueur) {
  const c = villageCorner(room);
  const lot = room.players[joueur]?.maison;
  const door = lot != null ? lotDoor(lot, geoOf(room)) : null;
  if (door) return { x: door[0], y: door[1] };
  return { x: c.x + INN_DOOR[0], y: c.y + INN_DOOR[1] };
}

// Action de la touche E près d'une maison : entrer chez soi (coffre), ou bâtir sur un terrain libre.
export function houseActionAt(room, p) {
  const c = villageCorner(room);
  // L'auberge : on peut toujours y dormir.
  if (Math.hypot(c.x + INN_DOOR[0] - p.x, c.y + INN_DOOR[1] - 0.6 - p.y) <= REACH && p.fatigue >= 10) return { kind: 'dormir', label: 'dormir à l\'auberge' };
  const geo = geoOf(room);
  // Une maison abandonnée : tout le monde peut la remettre en état.
  for (const r of room.sim.village.ruines ?? []) {
    const tile = ruinTile(r, geo);
    if (tile && Math.hypot(tile[0] + 0.5 - p.x, tile[1] + 1.3 - p.y) <= REACH) {
      return { kind: 'restaurer', ruin: r.id, label: `remettre en état la maison abandonnée (${RESTORE_WOOD} bois)` };
    }
  }
  const account = room.players[p.joueur];
  if (!account) return null;
  if (account.maison != null) {
    const door = lotDoor(account.maison, geo);
    if (door && Math.hypot(door[0] - p.x, door[1] - p.y) <= REACH) return { kind: 'entrer', label: 'entrer chez vous' };
    return null;
  }
  const used = usedLots(room);
  for (let lot = 0; lot < lotCount(geo.faubourgs); lot++) {
    if (used.has(lot)) continue;
    const [dx, dy] = lotDoor(lot, geo);
    if (Math.hypot(dx - p.x, dy - p.y) <= REACH) {
      return { kind: 'maison', lot, label: `bâtir votre maison ici (${HOUSE_COST.cuir} cuir, ${HOUSE_COST.minerai} minerai, ${HOUSE_WOOD} bois du village)` };
    }
  }
  return null;
}

// Remettre en état une maison abandonnée : quelques coups de main, avec le bois du village.
export const RESTORE_WOOD = 3;
const RESTORE_STEP = 20;
export function restoreStep(room, p, id, tell) {
  const r = (room.sim.village.ruines ?? []).find((x) => x.id === id);
  if (!r) return undefined;
  const wood = room.sim.village.jobs.bucheron_mineur.stock;
  if ((wood.bois ?? 0) < RESTORE_WOOD) return tell(`Il faut ${RESTORE_WOOD} bois dans la réserve du village.`);
  wood.bois -= RESTORE_WOOD;
  room.state.bois = wood.bois;
  r.condition = clamp(r.condition + RESTORE_STEP);
  (r.who ??= []).includes(p.nom) || r.who.push(p.nom);
  if (r.condition < 100) { syncRuins(room); return tell(`Maison abandonnée : remise en état à ${r.condition} %`); }
  restoreRuin(room.sim, id);
  syncRuins(room);
  syncHouses(room);
  announce(room, pushEvent(room, 'ruin_restored', null, { who: r.who, kind: r.kind }));
  return tell('La maison est remise en état !');
}

export function syncRuins(room) {
  const list = (room.sim.village.ruines ?? []).map((r) => `${r.id}|${r.kind}|${r.index}|${r.condition}`);
  if (list.join(';') === [...room.state.ruines].join(';')) return;
  room.state.ruines.splice(0, room.state.ruines.length);
  for (const x of list) room.state.ruines.push(x);
}

// Un joueur qu'on ne voit plus depuis longtemps : sa maison est laissée à l'abandon (son coffre, lui,
// l'attend s'il revient un jour : il pourra rebâtir).
export function abandonHouses(room, now, abandonMs, playing) {
  for (const [joueur, account] of Object.entries(room.players)) {
    if (account.maison == null) continue;
    const mine = Object.entries(room.registry).filter(([, e]) => e.owner === joueur);
    if (mine.some(([name]) => playing.has(name))) continue;
    const lastSeen = Math.max(0, ...mine.map(([, e]) => e.lastPlayedAt ?? now));
    if (now - lastSeen < abandonMs) continue;
    const lot = account.maison;
    account.maison = null;
    room.state.maisons.delete(String(lot));
    room.sim.village.ruines ??= [];
    room.sim.village.nextRuinId = (room.sim.village.nextRuinId ?? 0) + 1;
    room.sim.village.ruines.push({ id: room.sim.village.nextRuinId, kind: 'lot', index: lot, condition: 70, owner: joueur });
    announce(room, pushEvent(room, 'house_abandoned', null, { owner: joueur, fix: 'reparer' }));
    syncHouses(room);
    syncRuins(room);
  }
}

export function buildHouse(room, p, lot, tell) {
  const account = room.players[p.joueur];
  if (!account || account.maison != null) return;
  if (usedLots(room).has(lot)) return tell('Ce terrain est déjà pris.');
  for (const [item, n] of Object.entries(HOUSE_COST)) if (bagCount(p, item) < n) return tell(`Il vous faut ${HOUSE_COST.cuir} cuir et ${HOUSE_COST.minerai} minerai (les monstres en lâchent).`);
  const wood = room.sim.village.jobs.bucheron_mineur.stock;
  if ((wood.bois ?? 0) < HOUSE_WOOD) return tell(`Il faut ${HOUSE_WOOD} bois dans la réserve du village : allez en couper en forêt.`);
  for (const [item, n] of Object.entries(HOUSE_COST)) {
    const left = bagCount(p, item) - n;
    if (left > 0) p.sac.set(item, left); else p.sac.delete(item);
  }
  wood.bois = clamp(wood.bois - HOUSE_WOOD);
  room.state.bois = wood.bois;
  account.maison = lot;
  account.coffre ??= {};
  syncHouses(room);
  refreshChests(room, p.joueur);
  announce(room, pushEvent(room, 'house_player', null, { who: p.joueur, prenom: p.nom }));
  return tell('Votre maison est bâtie ! Son coffre garde vos affaires, pour tous vos personnages.');
}

// Le coffre est commun aux personnages d'un joueur : chaque personnage connecté en voit le contenu.
export function refreshChests(room, joueur) {
  const coffre = room.players[joueur]?.coffre ?? {};
  room.state.joueurs.forEach((p) => {
    if (p.joueur !== joueur) return;
    p.maison = room.players[joueur].maison ?? -1;
    for (const k of [...p.coffre.keys()]) if (!(k in coffre)) p.coffre.delete(k);
    for (const [k, n] of Object.entries(coffre)) if (p.coffre.get(k) !== n) p.coffre.set(k, n);
  });
}

// ---------- L'intérieur ----------

const near = (p, [x, y], r = REACH) => Math.hypot(p.x - x, p.y - y) <= r;

// Dans la pièce : se coucher, ouvrir le coffre, le panier du compagnon, ou sortir.
export function interiorActionAt(room, p) {
  const f = ROOM_FURNITURE;
  if (near(p, f.porte, 1.2)) return { kind: 'sortir', label: 'sortir' };
  if (near(p, f.lit)) return { kind: 'dormir', label: 'dormir dans votre lit' };
  if (near(p, f.coffre)) return { kind: 'coffre', label: 'ouvrir le coffre de votre maison' };
  if (near(p, f.panier)) {
    const next = { '': 'chien', chien: 'chat', chat: '' }[p.compagnon ?? ''];
    return { kind: 'compagnon', next, label: next ? `adopter un ${next}` : 'laisser votre compagnon à la maison' };
  }
  return null;
}

export function enterHouse(room, p) {
  const lot = room.players[p.joueur]?.maison;
  if (lot == null) return;
  p.interieur = lot;
  [p.x, p.y] = [ROOM_FURNITURE.porte[0], ROOM_FURNITURE.porte[1] - 1.8]; // assez loin de la porte pour ne pas ressortir aussitôt
  p.dir = 'haut';
}

export function leaveHouse(room, p) {
  if (p.interieur < 0) return;
  const [dx, dy] = lotDoor(p.interieur, geoOf(room));
  p.interieur = -1;
  p.x = dx;
  p.y = dy + 0.4;
  p.dir = 'bas';
}

// Déplacement dans la pièce : on reste entre les murs.
export function clampInRoom(next) {
  return { x: Math.max(0.6, Math.min(ROOM_W - 0.6, next.x)), y: Math.max(1.6, Math.min(ROOM_H - 0.4, next.y)) };
}

// Déposer ou reprendre un objet ; seulement devant son coffre, chez soi.
export function chestMove(room, p, { sens, objet, n } = {}, tell) {
  const action = p.interieur >= 0 ? interiorActionAt(room, p) : null;
  if (action?.kind !== 'coffre') return tell('Il faut être devant le coffre, chez vous.');
  const account = room.players[p.joueur];
  const coffre = account.coffre ??= {};
  const item = String(objet ?? '');
  if (sens === 'deposer') {
    const have = bagCount(p, item);
    const qty = Math.min(have, Math.max(1, Number(n) || have));
    if (!qty) return undefined;
    const left = have - qty;
    if (left > 0) p.sac.set(item, left); else p.sac.delete(item);
    coffre[item] = (coffre[item] ?? 0) + qty;
  } else if (sens === 'retirer') {
    const have = coffre[item] ?? 0;
    const qty = Math.min(have, Math.max(1, Number(n) || have));
    if (!qty) return undefined;
    if (have - qty > 0) coffre[item] = have - qty; else delete coffre[item];
    addItem(p, item, qty);
  }
  refreshChests(room, p.joueur);
  return undefined;
}
