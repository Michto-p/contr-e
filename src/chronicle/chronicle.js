// Chronique : transforme les events bruts en phrases lisibles, regroupées par jour.
// Ne lit QUE les events (jamais l'état de la simulation).

const MAX_LINES = 8;

// ---------- Outils de langue ----------

export function joinFr(items) {
  const list = [...new Set(items)];
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// « les champs du Nord », « les champs de l'Est » -> « les champs du Nord et de l'Est ».
export function joinPlaces(labels) {
  const groups = new Map();
  for (const label of new Set(labels)) {
    const m = label.match(/^(.*?) ((?:du |de l'|de la |des ).*)$/);
    const noun = m ? m[1] : label;
    const rest = m ? m[2] : '';
    if (!groups.has(noun)) groups.set(noun, []);
    if (rest) groups.get(noun).push(rest);
  }
  return joinFr([...groups].map(([noun, rests]) => (rests.length ? `${noun} ${joinFr(rests)}` : noun)));
}

// « les marais » -> « des marais » (complément du nom).
export function deLabel(label) {
  if (label.startsWith('les ')) return `des ${label.slice(4)}`;
  if (label.startsWith('le ')) return `du ${label.slice(3)}`;
  if (label.startsWith('la ')) return `de la ${label.slice(3)}`;
  return `de ${label}`;
}

// Articles des structures (« le pont », « la tour de guet »).
const STRUCTURE_ARTICLE = {
  'tour de guet': 'la', pont: 'le', 'cabane de chasseur': 'la', palissade: 'la', 'vieux moulin': 'le',
};
const theStructure = (t) => `${STRUCTURE_ARTICLE[t] ?? 'la'} ${t}`;

// Comment réparer chaque perte : la chronique le dit toujours.
const FIX = {
  emprunter: (n) => `Quelques allers-retours suffiraient à ${n > 1 ? 'les' : 'le'} retracer.`,
  reparer: 'Du bois et une journée de travail suffiront aux réparations.',
  groupe: 'Il faudra y retourner à plusieurs.',
  patrouiller: 'Une patrouille dans les champs protégera la prochaine récolte.',
};

const PARTITIVE = {
  cristal: 'du cristal', ambre: "de l'ambre", 'soie sauvage': 'de la soie sauvage', 'sel gemme': 'du sel gemme',
  'fer noir': 'du fer noir', 'résine dorée': 'de la résine dorée', 'perles de marais': 'des perles de marais',
};

const labels = (events) => events.map((e) => e.data.label);

// Liste de lieux raccourcie : au-delà de `max`, on n'en cite que quelques-uns, précédés de « notamment ».
function somePlaces(list, max = 3) {
  const uniq = [...new Set(list)];
  if (uniq.length <= max) return joinPlaces(uniq);
  return `notamment ${joinPlaces(uniq.slice(0, max))}`;
}

const who = (evs) => joinFr(evs.flatMap((e) => e.data.who ?? []));
const plural = (evs) => new Set(evs.flatMap((e) => e.data.who ?? [])).size > 1;
const dbg = (events, fields) => ` [${events.map((e) => fields.map((f) => `${f}=${e.data[f]}`).join(' ')).join(' ; ')}]`;

// ---------- Village ----------

const JOB_THE = {
  agriculteur: "l'agriculteur", boulanger: 'le boulanger', forgeron: 'le forgeron', bucheron_mineur: 'le bûcheron-mineur',
};
const JOB_TO = {
  agriculteur: "à l'agriculteur", boulanger: 'au boulanger', forgeron: 'au forgeron', bucheron_mineur: 'au bûcheron-mineur',
};
const RANK = ['', 'apprenti', 'compagnon', 'artisan confirmé', 'maître', 'grand maître'];
const deRank = (level) => (/^[aeiou]/.test(RANK[level]) ? `d'${RANK[level]}` : `de ${RANK[level]}`);
const GOOD_DE = { ble: 'de blé', pain: 'de pain', outils: "d'outils", minerai: 'de minerai', charbon: 'de charbon', bois: 'de bois' };
const NEEDS_FIX = {
  ble: 'du blé en abondance', outils: 'des outils neufs', minerai: 'du minerai', charbon: 'du charbon',
};
const SHORTAGE_FIX = {
  champs: 'Des champs bien gardés rendront du blé.',
  forge: 'Le forgeron doit être approvisionné en minerai et en charbon.',
  mine: 'Il faut remettre la mine en activité.',
};
function lossWord(pct) {
  if (pct <= 27) return 'un quart';
  if (pct <= 40) return 'un tiers';
  return 'près de la moitié';
}
const CALM_VILLAGE = [
  'Au village, tout tourne rondement : le four fume et l\'enclume sonne.',
  'Journée ordinaire au village : on moud, on forge, on fend du bois.',
  'Au village, les greniers tiennent et les outils ne manquent pas.',
  'Le village vaque à ses affaires, sans inquiétude.',
];
const QUEST_TEXT = {
  patrouille: (e) => `une patrouille dans ${e.data.label}`,
  escorte: (e) => `une escorte pour les mineurs dans ${e.data.label}`,
  reparer: (e) => `des bras pour réparer ${theStructure(e.data.structure)} ${deLabel(e.data.label)}`,
  aide: (e) => `un coup de main pour ${JOB_THE[e.data.job]}`,
};

// ---------- Rendus par type d'event ----------
// key : regroupe les events d'un même jour ; priority : importance (10 = majeur) ; text : phrase.

const SEASON_TEXT = {
  printemps: 'Le printemps s\'installe : la sève remonte et les champs reverdissent.',
  'été': 'L\'été arrive : les journées s\'allongent et les bêtes s\'agitent.',
  automne: 'L\'automne tombe sur la contrée : les récoltes ralentissent, les monstres s\'enhardissent.',
  hiver: 'L\'hiver est là : la croissance s\'arrête presque et les monstres s\'engourdissent.',
};

const QUEST_DONE = {
  patrouille: (e, w, pl) => `${w} ${pl ? 'ont gardé' : 'a gardé'} ${e.data.label} et chassé les bêtes qui les guettaient.`,
  escorte: (e, w, pl) => `${w} ${pl ? 'ont escorté' : 'a escorté'} les mineurs jusqu'${e.data.label.startsWith('les ') ? 'aux ' + e.data.label.slice(4) : 'à ' + e.data.label}.`,
  reparer: (e, w, pl) => `${w} ${pl ? 'ont remis' : 'a remis'} en état ${theStructure(e.data.structure)} ${deLabel(e.data.label)}.`,
  aide: (e, w, pl) => `${w} ${pl ? 'ont prêté' : 'a prêté'} main-forte ${JOB_TO[e.data.job]}.`,
};

const RENDERERS = {
  quest_done: {
    key: (e) => (e.data.kind === 'patrouille' ? 'patrouille' : `${e.data.kind}|${e.data.label}|${e.data.job}`),
    priority: (e) => (e.data.kind === 'aide' ? 4 : 6),
    text: (evs) => {
      if (evs[0].data.kind === 'patrouille') {
        const pl = evs.length > 1;
        return `${cap(joinPlaces(labels(evs)))} ${pl ? 'ont été gardés' : 'ont été gardés'} par ${who(evs)}, qui ${plural(evs) ? 'ont' : 'a'} aussi chassé les bêtes alentour.`;
      }
      return QUEST_DONE[evs[0].data.kind](evs[0], cap(who(evs)), plural(evs));
    },
  },
  discovery: {
    key: (e) => e.data.label,
    priority: () => 7,
    text: (evs) => `En explorant ${evs[0].data.label}, ${who(evs)} ${plural(evs) ? 'ont' : 'a'} découvert un gisement ${joinFr(evs[0].data.resources.map((r) => (PARTITIVE[r] ?? r).replace(/^(du|de la|des) /, 'de ').replace(/^de l'/, "d'")))}.`,
  },
  exploration: {
    priority: () => 3,
    text: (evs) => `${cap(joinFr(evs.map((e) => `${who([e])} a exploré ${e.data.label}`)))}, et en a rapporté du bois.`,
  },
  hunt: {
    priority: () => 3,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'sont allés' : 'est allé'} chasser dans ${joinPlaces(labels(evs))}.`,
  },
  player_return: {
    priority: () => 4,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'sont de retour' : 'est de retour'} après une longue absence.`,
  },
  season_change: {
    priority: () => 10,
    text: (evs) => SEASON_TEXT[evs[0].data.season],
  },
  zones_closed: {
    priority: () => 8,
    text: (evs) => `La neige ferme ${somePlaces(evs[0].data.labels, 3)} jusqu'au printemps.`,
  },
  zones_opened: {
    priority: () => 8,
    text: (evs) => `Le dégel rouvre ${somePlaces(evs[0].data.labels, 3)}.`,
  },
  day_start: {
    // Seul l'orage mérite une ligne ; le reste de la météo va dans le titre du jour.
    priority: () => 3,
    text: (evs) => (evs[0].data.weather === 'orage' ? 'Un violent orage a malmené les constructions exposées.' : null),
  },
  harvest_loss: {
    priority: () => 9,
    text: (evs, debug) => {
      const worst = Math.max(...evs.map((e) => e.data.lossPct));
      const where = deLabel(joinPlaces(labels(evs)));
      const how = evs.length === 1 ? lossWord(worst) : `jusqu'à ${lossWord(worst)}`;
      return `Les nuisibles ont ravagé ${how} de la récolte ${where}. ${FIX.patrouiller}${debug ? dbg(evs, ['lossPct', 'threat']) : ''}`;
    },
  },
  bread_shortage: {
    priority: () => 8,
    text: () => 'Le pain vient à manquer au village : les villageois se serrent la ceinture.',
  },
  shortage: {
    key: (e) => e.data.job,
    priority: () => 7,
    text: (evs, debug) => `${cap(JOB_THE[evs[0].data.job])} manque ${GOOD_DE[evs[0].data.good]}. ${SHORTAGE_FIX[evs[0].data.fix]}${debug ? dbg(evs, ['got', 'need']) : ''}`,
  },
  shortage_end: {
    key: (e) => e.data.job,
    priority: () => 4,
    text: (evs) => `${cap(JOB_THE[evs[0].data.job])} ne manque plus ${GOOD_DE[evs[0].data.good]}.`,
  },
  bread_back: {
    priority: () => 5,
    text: () => 'Le pain est revenu sur les tables du village.',
  },
  level_down: {
    key: (e) => e.data.job,
    priority: () => 9,
    text: (evs) => {
      const e = evs[0];
      return `Faute de soutien, ${JOB_THE[e.data.job]} redescend au rang ${deRank(e.data.level)}. ${cap(joinFr(e.data.needs.map((n) => NEEDS_FIX[n] ?? n)))} et un peu d'aide lui rendront vite son rang.`;
    },
  },
  level_up: {
    key: (e) => e.data.job,
    priority: (e) => (e.data.regained ? 7 : 8),
    text: (evs) => {
      const e = evs[0];
      return e.data.regained
        ? `${cap(JOB_THE[e.data.job])} a retrouvé son rang ${deRank(e.data.level)}.`
        : `Grâce à l'aide reçue, ${JOB_THE[e.data.job]} devient ${RANK[e.data.level]}.`;
    },
  },
  mine_unsafe: {
    priority: () => 8,
    text: (evs) => (evs[0].data.reason === 'monstres'
      ? `Les mineurs n'osent plus s'aventurer dans ${evs[0].data.label} : les monstres y rôdent. Une escorte leur rendrait courage.`
      : `La neige a fermé l'accès à la mine ${deLabel(evs[0].data.label)} ; le minerai se fera rare jusqu'au printemps.`),
  },
  mine_safe: {
    priority: () => 5,
    text: (evs) => `Les mineurs ont repris le chemin ${deLabel(evs[0].data.label)}.`,
  },
  quest_open: {
    priority: () => 2,
    text: (evs) => `Au village, on cherche ${joinFr(evs.map((e) => QUEST_TEXT[e.data.kind](e)))}.`,
  },
  village_status: {
    priority: () => 1,
    text: (evs) => {
      const e = evs[0];
      const worst = Object.entries(e.data.satisfaction).sort((a, b) => a[1] - b[1])[0];
      if (worst[1] >= 60) return CALM_VILLAGE[e.day % CALM_VILLAGE.length];
      return `Au village, ${JOB_THE[worst[0]]} fait grise mine.`;
    },
  },
  overflow: {
    // Plus c'est proche du village, plus c'est grave.
    priority: (e) => (e.data.dist <= 2 ? 8 : 6),
    text: (evs, debug) => `Les monstres pullulent ${somePlaces(labels(evs)).replace(/^(notamment )?/, '$1dans ')} et débordent sur les terres voisines. ${FIX.groupe}${debug ? dbg(evs, ['pressure']) : ''}`,
  },
  horde: {
    priority: (e) => (e.data.dist <= 3 ? 8 : 6),
    text: (evs) => evs.map((e) => (e.data.label === e.data.target
      ? `Une horde s'est formée dans ${e.data.label} et se rapproche du village.`
      : `Une horde a quitté ${e.data.label} et s'abat sur ${e.data.target}, un pas de plus vers le village.`)).join(' '),
  },
  fields_threatened: {
    priority: () => 9,
    text: (evs, debug) => `Des bêtes rôdent autour ${deLabel(joinPlaces(labels(evs)))}. ${FIX.patrouiller}${debug ? dbg(evs, ['pressure']) : ''}`,
  },
  retreat: {
    key: (e) => e.data.label,
    priority: () => 6,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'ont dû' : 'a dû'} battre en retraite face aux monstres ${deLabel(evs[0].data.label)} : trop nombreux pour un combattant seul. ${FIX.groupe}`,
  },
  zone_cleared: {
    key: (e) => e.data.label,
    priority: () => 7,
    text: (evs, debug) => `${cap(who(evs))} ${plural(evs) ? 'ont nettoyé' : 'a nettoyé'} ${evs[0].data.label} : les monstres n'y sont plus qu'une poignée.${debug ? dbg(evs, ['from', 'to']) : ''}`,
  },
  monsters_pushed: {
    key: (e) => e.data.label,
    priority: () => 4,
    text: (evs, debug) => `${cap(who(evs))} ${plural(evs) ? 'ont repoussé' : 'a repoussé'} les monstres ${deLabel(evs[0].data.label)}.${debug ? dbg(evs, ['from', 'to']) : ''}`,
  },
  path_formed: {
    priority: () => 3,
    text: (evs) => `À force de passages, un vrai sentier traverse désormais ${joinPlaces(labels(evs))}.`,
  },
  path_fading: {
    priority: () => 3,
    text: (evs, debug) => `${cap(evs.length > 1 ? 'les chemins' : 'le chemin')} ${deLabel(joinPlaces(labels(evs)))} ${evs.length > 1 ? 'se couvrent' : 'se couvre'} d'herbes, faute de passage. ${FIX.emprunter(evs.length)}${debug ? dbg(evs, ['wear']) : ''}`,
  },
  path_lost: {
    priority: () => 5,
    text: (evs) => `${cap(evs.length > 1 ? 'les chemins' : 'le chemin')} ${deLabel(joinPlaces(labels(evs)))} ${evs.length > 1 ? 'ont disparu' : 'a disparu'} sous la végétation. Il faudra ${evs.length > 1 ? 'les' : 'le'} rouvrir à pied.`,
  },
  structure_decay: {
    key: (e) => `${e.data.level}`,
    priority: (e) => ({ abimee: 4, menace: 6, ruine: 7 })[e.data.level],
    text: (evs, debug) => {
      const what = joinFr(evs.map((e) => `${theStructure(e.data.structure)} ${deLabel(e.data.label)}`));
      const plural = evs.length > 1;
      const verb = {
        abimee: plural ? 'commencent à s\'abîmer' : 'commence à s\'abîmer',
        menace: plural ? 'menacent de s\'effondrer' : 'menace de s\'effondrer',
        ruine: plural ? 'sont tombés en ruine' : 'est tombé en ruine',
      }[evs[0].data.level];
      return `${cap(what)} ${verb}. ${FIX.reparer}${debug ? dbg(evs, ['condition']) : ''}`;
    },
  },
};

// ---------- Assemblage ----------

function renderGroup(type, evs, debug) {
  const r = RENDERERS[type];
  if (!r) return { priority: 0, text: `(${type})${debug ? ` ${JSON.stringify(evs.map((e) => e.data))}` : ''}` };
  return { priority: Math.max(...evs.map((e) => r.priority(e))), text: r.text(evs, debug) };
}

function groupEvents(events) {
  const groups = new Map();
  for (const e of events) {
    const r = RENDERERS[e.type];
    const k = `${e.type}|${r?.key ? r.key(e) : ''}`;
    if (!groups.has(k)) groups.set(k, { type: e.type, events: [], first: e.tick });
    groups.get(k).events.push(e);
  }
  return [...groups.values()];
}

// Une même action ne doit être racontée qu'une fois : le résultat d'un combat l'emporte sur
// « est allé chasser / a exploré », et la garde d'un champ l'emporte sur le combat dans ce champ.
const COMBAT = new Set(['zone_cleared', 'monsters_pushed', 'retreat']);
function dedupe(events) {
  const key = (e) => `${e.day}|${e.zone}`;
  const fought = new Set(events.filter((e) => COMBAT.has(e.type)).map(key));
  const guarded = new Set(events.filter((e) => e.type === 'quest_done' && e.zone != null).map(key));
  const lostPaths = new Set(events.filter((e) => e.type === 'path_lost').map((e) => `${e.day}|${e.data.label}`));
  return events.filter((e) => {
    if (e.type === 'path_fading' && lostPaths.has(`${e.day}|${e.data.label}`)) return false;
    if ((e.type === 'hunt' || e.type === 'exploration') && fought.has(key(e))) return false;
    if (COMBAT.has(e.type) && e.type !== 'retreat' && guarded.has(key(e))) return false;
    return true;
  });
}

// Actions des joueurs : dans le résumé « pendant votre absence », l'état du monde passe avant.
const PLAYER_ACTIONS = new Set(['zone_cleared', 'monsters_pushed', 'quest_done', 'hunt', 'exploration', 'player_return', 'retreat']);

// Transforme les events d'une période en lignes triées par importance.
export function linesFor(events, { debug = false, max = MAX_LINES, worldFirst = false } = {}) {
  const lines = groupEvents(dedupe(events).filter((e) => e.type !== 'contree' && (RENDERERS[e.type] || debug)))
    .map((g) => {
      const r = renderGroup(g.type, g.events, debug);
      if (worldFirst && PLAYER_ACTIONS.has(g.type)) r.priority -= 4;
      return { ...r, first: g.first };
    })
    .filter((l) => l.text)
    .sort((a, b) => b.priority - a.priority || a.first - b.first);
  return lines.slice(0, max).map((l) => l.text);
}

function header(events) {
  const c = events.find((e) => e.type === 'contree');
  if (!c) return [];
  const { name, biome, exclusives } = c.data;
  const BIOME_TERRE = { foret: 'de forêts', plaine: 'de plaines', colline: 'de collines', marais: 'de marais', montagne: 'de montagnes' };
  return [
    `# Chronique de ${name}`,
    '',
    `Une terre ${BIOME_TERRE[biome]}. On y trouve ${joinFr(exclusives.map((x) => PARTITIVE[x] ?? x))}, introuvables ailleurs ; le reste devra venir d'autres contrées.`,
    '',
  ];
}

export function formatChronicle(events, { debug = false, since = null, days: nbDays = null } = {}) {
  const out = header(events);
  const lastDay = nbDays ?? Math.max(0, ...events.map((e) => e.day));
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);

  if (since != null) {
    const last = Math.max(lastDay, since);
    const missed = events.filter((e) => e.day >= since);
    out.push(`## Pendant votre absence (jours ${since} à ${last})`, '');
    const lines = linesFor(missed, { debug, max: MAX_LINES, worldFirst: true });
    if (lines.length === 0) lines.push('Rien de notable ne s\'est produit.');
    for (const l of lines) out.push(`- ${l}`);
    return out.join('\n');
  }

  for (const day of days) {
    const dayEvents = events.filter((e) => e.day === day);
    const lines = linesFor(dayEvents, { debug });
    if (lines.length === 0) lines.push('Journée calme dans la contrée.');
    const start = dayEvents.find((e) => e.type === 'day_start');
    out.push(start ? `## Jour ${day} — ${start.data.season}, ${start.data.weather}` : `## Jour ${day}`, '');
    for (const l of lines) out.push(`- ${l}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}
