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
  reparer: 'Du bois et une journée de travail suffiront à la remettre en état.',
};

const PARTITIVE = {
  cristal: 'du cristal', ambre: "de l'ambre", 'soie sauvage': 'de la soie sauvage', 'sel gemme': 'du sel gemme',
  'fer noir': 'du fer noir', 'résine dorée': 'de la résine dorée', 'perles de marais': 'des perles de marais',
};

const labels = (events) => events.map((e) => e.data.label);
const dbg = (events, fields) => ` [${events.map((e) => fields.map((f) => `${f}=${e.data[f]}`).join(' ')).join(' ; ')}]`;

// ---------- Rendus par type d'event ----------
// key : regroupe les events d'un même jour ; priority : importance (10 = majeur) ; text : phrase.

const RENDERERS = {
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
    text: (evs) => `${cap(evs.length > 1 ? 'les chemins' : 'le chemin')} ${deLabel(joinPlaces(labels(evs)))} ${evs.length > 1 ? 'ont disparu' : 'a disparu'} sous la végétation. Il faudra le rouvrir à pied.`,
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

// Transforme les events d'une période en lignes triées par importance.
export function linesFor(events, { debug = false, max = MAX_LINES } = {}) {
  const lines = groupEvents(events.filter((e) => RENDERERS[e.type] || debug))
    .map((g) => ({ ...renderGroup(g.type, g.events, debug), first: g.first }))
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
    const lines = linesFor(missed, { debug, max: MAX_LINES });
    if (lines.length === 0) lines.push('Rien de notable ne s\'est produit.');
    for (const l of lines) out.push(`- ${l}`);
    return out.join('\n');
  }

  for (const day of days) {
    const dayEvents = events.filter((e) => e.day === day);
    const lines = linesFor(dayEvents, { debug });
    if (lines.length === 0) lines.push('Journée calme dans la contrée.');
    out.push(`## Jour ${day}`, '');
    for (const l of lines) out.push(`- ${l}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}
