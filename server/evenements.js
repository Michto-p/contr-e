// Events émis par le gameplay temps réel : même format que ceux de la simulation,
// pour que la chronique les raconte avec les autres.
import { linesFor } from '../src/chronicle/chronicle.js';

export function pushEvent(room, type, zone, data) {
  const e = { day: room.sim.day, tick: room.sim.tick, type, data };
  if (zone != null) e.zone = zone;
  room.world.events.push(e);
  return e;
}

// Annonce à tous, avec la phrase même de la chronique.
export function announce(room, event) {
  const [line] = linesFor([event]);
  if (line) room.broadcast('annonce', line);
}
