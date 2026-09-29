// Joueurs simulés : des bots avec un profil de connexion, qui agissent entre les ticks.
//  - assidu : connecté presque tous les jours, fait les quêtes du village ;
//  - occasionnel : 2–3 connexions par semaine, explore ;
//  - absent : se connecte au jour 1 puis revient au jour 7 (puis tous les 7 jours).
import { clamp, neighbors, zoneAt } from './world.js';
import { SOLO_LIMIT } from './systems/monsters.js';
import { questUrgency, TOWER } from './systems/village.js';

const TOWER_DONE = 75; // état d'une tour à la fin du chantier (environ 7 heures de travail)

const NAMES = ['Maël', 'Iris', 'Noé', 'Lou', 'Sacha', 'Alix', 'Camille', 'Eden', 'Robin', 'Yaël', 'Charlie', 'Morgan', 'Swann', 'Élie', 'Ange', 'Nour'];

export const SCENARIOS = {
  assidus: { assidu: 8 },
  mixte: { assidu: 3, occasionnel: 3, absent: 2 },
  absents: { absent: 8 },
  aucun: {},
};

const HELP_OUTPUT = { agriculteur: 'ble', boulanger: 'pain', forgeron: 'outils', bucheron_mineur: 'minerai' };

export function addPlayers(state, rng, scenario = 'mixte') {
  const mix = SCENARIOS[scenario];
  if (!mix) throw new Error(`Scénario inconnu : ${scenario} (choix : ${Object.keys(SCENARIOS).join(', ')})`);
  const names = [...NAMES];
  const players = [];
  for (const [profile, count] of Object.entries(mix)) {
    for (let i = 0; i < count; i++) {
      const name = names.splice(rng.int(0, names.length - 1), 1)[0];
      players.push({ name, profile, lastSeen: null, session: null, discovered: [] });
    }
  }
  // Chaque joueur a une maison au village : protégée, elle ne se dégrade jamais.
  const village = state.zones[state.villageId];
  for (const p of players) village.structures.push({ type: `maison de ${p.name}`, condition: 100, protected: true });
  state.players = players;
  return state;
}

function connectsToday(player, day, rng) {
  if (player.profile === 'assidu') return rng.chance(0.9);
  if (player.profile === 'occasionnel') return rng.chance(0.4);
  return day === 1 || day % 7 === 0; // absent
}

// Zones traversées en ligne droite depuis le village.
function route(state, target) {
  const v = state.zones[state.villageId];
  const out = [];
  let { x, y } = v;
  while (x !== target.x || y !== target.y) {
    x += Math.sign(target.x - x);
    y += Math.sign(target.y - y);
    out.push(zoneAt(state, x, y));
  }
  return out;
}

// Répartit le travail du jour entre les joueurs connectés : les quêtes urgentes d'abord,
// et à deux quand la zone est trop dangereuse pour un joueur seul.
function planDay(state, rng, online) {
  const quests = [...state.village.quests].sort((a, b) => questUrgency(state, b) - questUrgency(state, a));
  const takers = online.filter((p) => p.profile !== 'occasionnel');
  const explorers = online.filter((p) => p.profile === 'occasionnel');
  const plans = new Map();

  for (const q of quests) {
    if (takers.length === 0) break;
    const zone = q.zone != null ? state.zones[q.zone] : null;
    const danger = zone && (q.kind === 'patrouille' ? worstNeighbor(state, zone) : zone).monsterPressure >= SOLO_LIMIT;
    // Bâtir se fait à deux : seul, on ne lance pas le chantier.
    if (q.kind === 'construire' && takers.length < 2) continue;
    const team = takers.splice(0, danger || q.kind === 'construire' ? 2 : 1);
    for (const p of team) plans.set(p.name, { kind: q.kind, quest: q.id, zone: q.zone ?? null, job: q.job ?? null, team: team.map((t) => t.name) });
  }
  // Ceux qui restent vont chasser autour des champs, chacun du côté le plus menacé encore libre.
  const fronts = state.zones.filter((z) => z.isField)
    .map((f) => worstNeighbor(state, f))
    .sort((a, b) => b.monsterPressure - a.monsterPressure);
  takers.forEach((p, i) => {
    const target = fronts[i % fronts.length];
    plans.set(p.name, { kind: 'chasse', zone: target.id, team: [p.name] });
  });
  for (const p of explorers) {
    const choices = state.zones.filter((z) => !z.closed && z.dist >= 2 && z.dist <= 5);
    const target = rng.pick(choices);
    plans.set(p.name, { kind: 'exploration', zone: target.id, team: [p.name] });
  }
  return plans;
}

function worstNeighbor(state, zone) {
  const wild = neighbors(state, zone).filter((n) => !n.isVillage && !n.isField && !n.closed);
  return wild.sort((a, b) => b.monsterPressure - a.monsterPressure)[0] ?? zone;
}

function fight(zone, name) {
  zone.today.visits += 1;
  zone.today.fights += 1;
  zone.today.fighters.push(name);
}

// Une heure de jeu d'un joueur.
function actHour(state, rng, ctx, p, hourIndex, events) {
  const plan = p.session.plan;
  const zone = plan.zone != null ? state.zones[plan.zone] : null;

  // Première heure : le trajet. Les passages tracent les chemins et tiennent les monstres à distance.
  if (hourIndex === 0 && zone && !zone.isVillage) {
    for (const z of route(state, zone)) {
      z.pathWear = clamp(z.pathWear + 12);
      z.today.visits += 1;
    }
  }

  switch (plan.kind) {
    case 'patrouille': {
      // Une heure dans le champ pour le garder, puis la chasse chez le voisin le plus menaçant.
      if (hourIndex === 0) fight(zone, p.name);
      else fight(worstNeighbor(state, zone), p.name);
      break;
    }
    case 'escorte':
    case 'chasse':
    case 'exploration':
      if (zone.closed) break;
      fight(zone, p.name);
      break;
    case 'reparer': {
      zone.today.visits += 1;
      const wanted = state.village.quests.find((q) => q.id === plan.quest)?.structure ?? plan.structure;
      const damaged = zone.structures.filter((st) => !st.protected && !st.building && st.condition < 100);
      const s = damaged.find((st) => st.type === wanted) ?? damaged[0];
      if (!s) break;
      const wood = state.village.jobs.bucheron_mineur.stock;
      const used = Math.min(wood.bois ?? 0, 5);
      wood.bois -= used;
      s.condition = clamp(s.condition + (used >= 5 ? 20 : 10));
      s.maintainedDay = ctx.day;
      if (s.condition >= 50) s.warned = null;
      plan.structure = s.type;
      break;
    }
    case 'construire': {
      zone.today.visits += 1;
      let s = zone.structures.find((st) => st.type === TOWER);
      if (s && !s.building && s.condition > 0) break; // déjà debout : un équipier vient de la finir
      if (!s) {
        s = { type: TOWER, condition: 0, building: true, warned: null };
        zone.structures.push(s);
        events.push(ctx.event('construction_started', zone, { who: plan.team, label: zone.label, structure: TOWER }));
      } else if (!s.building) {
        s.building = true; // une tour en ruine se rebâtit
        s.condition = 0;
      }
      const wood = state.village.jobs.bucheron_mineur.stock;
      const used = Math.min(wood.bois ?? 0, 4);
      wood.bois -= used;
      s.condition = clamp(s.condition + (used >= 4 ? 12 : 4));
      s.maintainedDay = ctx.day;
      if (s.condition >= TOWER_DONE) {
        s.building = false;
        state.village.quests = state.village.quests.filter((q) => q.id !== plan.quest);
        events.push(ctx.event('structure_built', zone, { who: plan.team, label: zone.label, structure: TOWER }));
      }
      break;
    }
    case 'aide': {
      const job = state.village.jobs[plan.job];
      const good = HELP_OUTPUT[plan.job];
      job.stock[good] = clamp((job.stock[good] ?? 0) + 4);
      if (plan.job === 'bucheron_mineur') job.stock.charbon = clamp((job.stock.charbon ?? 0) + 4);
      break;
    }
    default:
      break;
  }
}

function finishSession(state, ctx, p, events) {
  const plan = p.session.plan;
  const zone = plan.zone != null ? state.zones[plan.zone] : null;
  const quest = state.village.quests.find((q) => q.id === plan.quest);
  if (plan.job) state.village.jobs[plan.job].helpedDay = ctx.day;

  if (plan.kind === 'exploration') {
    const exclusives = state.signature.exclusives.filter((r) => zone.resources[r] > 0 && !p.discovered.includes(r));
    if (exclusives.length) {
      p.discovered.push(...exclusives);
      events.push(ctx.event('discovery', zone, { who: [p.name], label: zone.label, resources: exclusives }));
    } else {
      events.push(ctx.event('exploration', zone, { who: [p.name], label: zone.label, closed: zone.closed }));
    }
    // L'explorateur rapporte du bois.
    const wood = state.village.jobs.bucheron_mineur.stock;
    wood.bois = clamp((wood.bois ?? 0) + 6);
    return;
  }
  if (plan.kind === 'chasse') {
    events.push(ctx.event('hunt', zone, { who: [p.name], label: zone.label }));
    return;
  }
  // Un chantier se poursuit d'une soirée à l'autre ; son achèvement est déjà raconté.
  if (plan.kind === 'construire') return;
  // Quête terminée par le dernier membre de l'équipe qui finit sa session.
  if (quest) {
    state.village.quests = state.village.quests.filter((q) => q.id !== quest.id);
    events.push(ctx.event('quest_done', zone, {
      who: plan.team, kind: plan.kind, job: plan.job, label: zone?.label ?? null, structure: plan.structure ?? quest.structure ?? null,
    }));
  }
}

// Appelé avant chaque tick : les joueurs se connectent, agissent heure par heure, puis se déconnectent.
export function agentsAct(state, rng, ctx) {
  if (!state.players.length) return { state, events: [] };
  const events = [];
  let next = state;

  // Le plan du jour est fait à 1 h, une fois que le village a publié ses quêtes du matin.
  if (ctx.hour === 1) {
    next = structuredClone(state);
    const online = next.players.filter((p) => connectsToday(p, ctx.day, rng));
    const plans = planDay(next, rng, online);
    for (const p of online) {
      const start = rng.int(17, 19);
      p.session = { start, end: start + rng.int(2, 4), plan: plans.get(p.name) };
      if (p.lastSeen != null && ctx.day - p.lastSeen >= 3) {
        events.push(ctx.event('player_return', null, { who: [p.name], away: ctx.day - p.lastSeen }));
      }
      p.lastSeen = ctx.day;
    }
  }

  const active = next.players.filter((p) => p.session && ctx.hour >= p.session.start && ctx.hour < p.session.end);
  if (!active.length) return { state: next, events };
  if (next === state) next = structuredClone(state);
  for (const p of next.players) {
    if (!p.session || ctx.hour < p.session.start || ctx.hour >= p.session.end) continue;
    actHour(next, rng, ctx, p, ctx.hour - p.session.start, events);
    if (ctx.hour === p.session.end - 1) {
      finishSession(next, ctx, p, events);
      p.session = null;
    }
  }
  return { state: next, events };
}
