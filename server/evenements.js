// Events émis par le gameplay temps réel : même format que ceux de la simulation,
// pour que la chronique les raconte avec les autres.
import { linesFor } from '../src/chronicle/chronicle.js';

// Ce que rapportent en renommée les hauts faits des joueurs (leurs personnages sont des habitants).
const RENOWN = { quest_done: 3, horde_repelled: 6, wanderer_rescued: 5, outpost_built: 3, house_player: 2, ruin_restored: 4 };

export function pushEvent(room, type, zone, data) {
  const e = { day: room.sim.day, tick: room.sim.tick, type, data };
  if (zone != null) e.zone = zone;
  room.world.events.push(e);
  if (RENOWN[type]) {
    const names = Array.isArray(data?.who) ? data.who : [data?.prenom ?? data?.who];
    for (const name of names) {
      const hid = room.registry?.[name]?.hid;
      const p = hid != null ? room.sim.village.population?.people.find((q) => q.id === hid) : null;
      if (p) p.renommee = Math.min(100, (p.renommee ?? 0) + RENOWN[type]);
    }
  }
  return e;
}

// Annonce à tous, avec la phrase même de la chronique.
export function announce(room, event) {
  const [line] = linesFor([event]);
  if (line) room.broadcast('annonce', line);
}
