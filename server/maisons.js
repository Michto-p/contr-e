// L'auberge et les maisons des joueurs. Tout le monde commence à l'auberge ; plus tard, un joueur
// bâtit sa maison sur un terrain libre du village (avec ce qu'il a rapporté et le bois du village).
// La maison a un coffre, commun à tous les personnages du joueur, et c'est là qu'il reprend ses
// esprits quand il tombe. Une maison au village est protégée : elle ne s'abîme jamais.
import { ZONE_TILES, INN_DOOR, HOUSE_LOTS, houseDoor } from '../shared/monde.js';
import { clamp } from '../src/sim/world.js';
import { bagCount, addItem } from './objets.js';
import { pushEvent, announce } from './evenements.js';
import { setFoyer } from '../src/sim/systems/population.js';

export const HOUSE_COST = { cuir: 4, minerai: 4 };
export const HOUSE_WOOD = 10;
const REACH = 1.6;

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
}

export function syncHouses(room) {
  for (const [joueur, account] of Object.entries(room.players)) {
    if (account.maison != null) setFoyer(room.sim, joueur); // avec une maison, on peut fonder une famille
    if (account.maison != null && room.state.maisons.get(String(account.maison)) !== joueur) room.state.maisons.set(String(account.maison), joueur);
  }
}

export function freeLot(room) {
  const used = new Set(Object.values(room.players).map((a) => a.maison).filter((m) => m != null));
  const i = HOUSE_LOTS.findIndex((_, k) => !used.has(k));
  return i < 0 ? null : i;
}

// Où l'on apparaît (et où l'on revient à bout de forces) : devant sa maison, sinon à l'auberge.
export function spawnPoint(room, joueur) {
  const c = villageCorner(room);
  const lot = room.players[joueur]?.maison;
  const [dx, dy] = lot != null ? houseDoor(lot) : INN_DOOR;
  return { x: c.x + dx, y: c.y + dy };
}

// Action de la touche E près d'une maison : entrer chez soi (coffre), ou bâtir sur un terrain libre.
export function houseActionAt(room, p) {
  const c = villageCorner(room);
  const account = room.players[p.joueur];
  if (!account) return null;
  if (account.maison != null) {
    const [dx, dy] = houseDoor(account.maison);
    if (Math.hypot(c.x + dx - p.x, c.y + dy - p.y) <= REACH) return { kind: 'coffre', label: 'ouvrir le coffre de votre maison' };
    return null;
  }
  const used = new Set(Object.values(room.players).map((a) => a.maison).filter((m) => m != null));
  for (let lot = 0; lot < HOUSE_LOTS.length; lot++) {
    if (used.has(lot)) continue;
    const [dx, dy] = houseDoor(lot);
    if (Math.hypot(c.x + dx - p.x, c.y + dy - p.y) <= REACH) {
      return { kind: 'maison', lot, label: `bâtir votre maison ici (${HOUSE_COST.cuir} cuir, ${HOUSE_COST.minerai} minerai, ${HOUSE_WOOD} bois du village)` };
    }
  }
  return null;
}

export function buildHouse(room, p, lot, tell) {
  const account = room.players[p.joueur];
  if (!account || account.maison != null) return;
  if (freeLot(room) == null || Object.values(room.players).some((a) => a.maison === lot)) return tell('Ce terrain est déjà pris.');
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

// Déposer ou reprendre un objet ; seulement devant chez soi.
export function chestMove(room, p, { sens, objet, n } = {}, tell) {
  const action = houseActionAt(room, p);
  if (action?.kind !== 'coffre') return tell('Il faut être devant votre maison.');
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
