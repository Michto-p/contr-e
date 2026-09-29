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

// « de » devant chaque groupe de lieux : « des marais du Nord et des prés de l'Est ».
export function dePlaces(labels) {
  const groups = new Map();
  for (const label of new Set(labels)) {
    const m = label.match(/^(.*?) ((?:du |de l'|de la |des ).*)$/);
    const noun = m ? m[1] : label;
    if (!groups.has(noun)) groups.set(noun, []);
    if (m) groups.get(noun).push(m[2]);
  }
  return joinFr([...groups].map(([noun, rests]) => deLabel(rests.length ? `${noun} ${joinFr(rests)}` : noun)));
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
  'tour de guet': 'la', pont: 'le', 'cabane de chasseur': 'la', palissade: 'la', 'vieux moulin': 'le', 'avant-poste': "l'",
};
const theStructure = (t) => {
  const art = STRUCTURE_ARTICLE[t] ?? 'la';
  return art.endsWith("'") ? `${art}${t}` : `${art} ${t}`;
};

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
  construire: (e) => `des bâtisseurs pour élever une tour de guet dans ${e.data.label}`,
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

// ---------- Vie du village ----------

const deN = (name) => (/^[AEIOUYÉÈH]/i.test(name) ? `d'${name}` : `de ${name}`);
const JOB_AT = {
  agriculteur: 'aux champs', boulanger: 'au fournil', forgeron: 'à la forge', bucheron_mineur: 'à la coupe et à la mine',
  eleveur: 'auprès des bêtes', enseignant: "à l'école", garde: 'à la garde du village', ancien: 'au coin du feu',
};
const TALENT_TEXT = {
  forestier: 'saura replanter et choisir ses arbres',
  agronome: 'sait lire la terre et agrandir les champs',
  inventeur: "a l'esprit à inventer",
  bouvier: 'sait mener les bêtes',
  'maître des levains': 'a le secret des levains',
  érudit: 'transmet son savoir mieux que personne',
  "maître d'armes": 'manie la lance mieux que personne',
};
const RUMEURS = {
  menace: {
    bavard: (e) => `Au lavoir, ${e.data.who} ne parle que des bêtes qui rôdent autour ${deLabel(e.data.label)}.`,
    prudent: (e) => `${e.data.who} conseille de ne plus s'aventurer seul vers ${e.data.label}.`,
    audacieux: (e) => `${e.data.who} parle d'aller chasser les monstres ${deLabel(e.data.label).replace(/^de[s]? |^du /, (m) => `près ${m}`)} dès que possible.`,
    _: (e) => `${e.data.who} s'inquiète des monstres qui rôdent autour ${deLabel(e.data.label)}.`,
  },
  faim: {
    travailleur: (e) => `${e.data.who} promet de redoubler d'efforts pour que le pain revienne.`,
    _: (e) => `${e.data.who} partage son dernier quignon avec les voisins.`,
  },
  rares: {
    curieux: (e) => `${e.data.who} passe ses soirées à examiner les matériaux rapportés de loin.`,
    _: (e) => `On se presse devant la forge pour voir les matériaux rapportés de loin.`,
  },
  calme: {
    rêveur: (e) => `${e.data.who} rêve tout haut des contrées au-delà des hauteurs.`,
    patient: (e) => `${e.data.who} greffe tranquillement les pommiers derrière sa maison.`,
    bavard: (e) => `${e.data.who} raconte à qui veut l'entendre les histoires des anciens.`,
    têtu: (e) => `${e.data.who} refuse toujours de changer sa façon de faire, et ça marche.`,
    travailleur: (e) => `${e.data.who} a travaillé du lever au coucher du soleil, comme toujours.`,
    _: (e) => `${e.data.who} profite d'une journée tranquille.`,
  },
};

const RENDERERS = {
  villager_defense: {
    key: (e) => e.data.label,
    priority: () => 4,
    text: (evs) => `D'un naturel audacieux, ${who(evs)} ${plural(evs) ? 'ont' : 'a'} prêté main-forte contre les monstres ${deLabel(evs[0].data.label)}.`,
  },
  guard_patrol: {
    priority: () => 3,
    text: (evs) => {
      const e = evs[0];
      const n = e.data.who.length;
      return `${cap(joinFr(e.data.who))}, de garde, ${n > 1 ? 'ont' : 'a'} patrouillé dans ${joinFr(e.data.labels)}.`;
    },
  },
  villager_hurt: {
    key: (e) => e.data.who,
    priority: () => 5,
    text: (evs) => `${evs[0].data.who} revient avec une vilaine blessure, reçue face aux monstres ${deLabel(evs[0].data.label)}. Quelques jours de repos suffiront ; la prochaine fois, mieux vaut y aller à plusieurs.`,
  },
  villager_found: {
    key: (e) => e.data.who,
    priority: () => 6,
    text: (evs) => `Par curiosité, ${evs[0].data.who} a exploré ${evs[0].data.label} et en a rapporté ${PARTITIVE[evs[0].data.materiau] ?? evs[0].data.materiau} pour la forge.`,
  },
  villager_explore: {
    priority: () => 2,
    text: (evs) => `Par curiosité, ${joinFr(evs.map((e) => `${e.data.who} a exploré ${e.data.label}`))}.`,
  },
  birth: {
    priority: () => 6,
    text: (evs) => evs.map((e) => `Naissance ${deN(e.data.name)}, enfant ${deN(e.data.parents[0])} et ${deN(e.data.parents[1])}.`).join(' '),
  },
  couple: {
    priority: () => 3,
    text: (evs) => evs.map((e) => `${e.data.names[0]} et ${e.data.names[1]} ont uni leurs vies.`).join(' '),
  },
  coming_of_age: {
    key: (e) => e.data.name,
    priority: (e) => (e.data.talent ? 7 : 5),
    text: (evs) => {
      const e = evs[0];
      const where = JOB_AT[e.data.job] ?? '';
      const base = e.data.heir
        ? `À seize ans, ${e.data.prenom} reprend le flambeau ${deN(e.data.heir)}, ${where}.`
        : `À seize ans, ${e.data.prenom} choisit de travailler ${where}.`;
      return e.data.talent ? `${base} Avec tout ce qu'on lui a transmis, ${e.data.prenom} ${TALENT_TEXT[e.data.talent]}.` : base;
    },
  },
  death: {
    key: (e) => e.data.name,
    priority: () => 6,
    text: (evs, debug) => {
      const e = evs[0];
      const heirs = e.data.heirs.length ? ` Son savoir vit en ${joinFr(e.data.heirs)}.` : '';
      const age = e.data.age >= 80 ? 'à un très grand âge' : e.data.age >= 70 ? 'à un grand âge' : 'à un âge respectable';
      return `Décès ${deN(e.data.name)}, ${age}.${heirs}${debug ? ` [${e.data.age} ans]` : ''}`;
    },
  },
  house_built: {
    priority: () => 5,
    text: () => 'Une nouvelle maison s\'élève au village : la population s\'agrandit.',
  },
  newcomers: {
    priority: () => 7,
    text: (evs) => `La famille ${evs[0].data.famille} vient s'installer au village : ${joinFr(evs[0].data.names)} apportent des bras bienvenus.`,
  },
  replant: {
    key: (e) => e.data.label,
    priority: () => 4,
    text: (evs) => `${evs[0].data.who} a replanté dans ${evs[0].data.label} : la forêt se referme doucement.`,
  },
  passage: {
    key: (e) => e.data.label,
    priority: () => 4,
    text: (evs) => `${evs[0].data.who} a ouvert un passage à travers ${evs[0].data.label}, en choisissant les arbres à abattre.`,
  },
  new_field: {
    key: (e) => e.data.label,
    priority: () => 8,
    text: (evs) => `${evs[0].data.who[0]}, aux champs, et ${evs[0].data.who[1]}, auprès des bêtes, ont défriché un pré : ${evs[0].data.label} nourriront le village. Il faudra les garder, eux aussi.`,
  },
  invention: {
    key: (e) => e.data.plan,
    priority: () => 8,
    text: (evs) => `${evs[0].data.who}, à la forge, a mis au point un nouveau plan grâce ${PARTITIVE[evs[0].data.materiau] ? `au ${evs[0].data.materiau}` : `à ${evs[0].data.materiau}`} rapporté de loin : « ${evs[0].data.plan} ».`,
  },
  offering: {
    key: (e) => e.data.materiau,
    priority: () => 5,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'ont rapporté' : 'a rapporté'} ${PARTITIVE[evs[0].data.materiau] ?? evs[0].data.materiau} au village.`,
  },
  rumor: {
    priority: () => 2,
    text: (evs) => {
      const e = evs[0];
      const table = RUMEURS[e.data.topic] ?? RUMEURS.calme;
      return (table[e.data.trait] ?? table._)(e);
    },
  },
  forged: {
    key: (e) => e.data.item,
    priority: () => 5,
    text: (evs) => `Le forgeron a forgé ${evs.length > 1 ? 'des pièces' : 'une pièce'} « ${evs[0].data.item} » pour ${who(evs)}.`,
  },
  player_down: {
    key: (e) => e.data.label,
    priority: () => 5,
    text: (evs) => `À bout de forces face aux monstres ${deLabel(evs[0].data.label)}, ${who(evs)} ${plural(evs) ? 'ont dû' : 'a dû'} rentrer au village se soigner. ${FIX.groupe}`,
  },
  construction_started: {
    key: (e) => e.data.label,
    priority: () => 5,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'ont posé' : 'a posé'} les premières pierres d'une tour de guet dans ${evs[0].data.label}.`,
  },
  structure_built: {
    key: (e) => e.data.label,
    priority: () => 8,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'ont achevé' : 'a achevé'} une tour de guet dans ${evs[0].data.label} : les monstres y proliféreront moins vite. Exposée aux intempéries et aux hordes, elle demandera de l'entretien.`,
  },
  outpost_built: {
    key: (e) => e.data.label,
    priority: () => 8,
    text: (evs) => {
      const e = evs[0];
      const by = e.data.who.length ? `${cap(joinFr(e.data.who))} ${e.data.who.length > 1 ? 'ont dressé' : 'a dressé'}` : 'Les habitants ont dressé';
      return `${by} un avant-poste dans ${e.data.label} : on y travaillera plus sûrement, et les monstres s'y installeront moins. Il faudra l'entretenir.`;
    },
  },
  structure_raided: {
    key: (e) => e.data.label,
    priority: () => 7,
    text: (evs) => {
      const e = evs[0];
      const what = e.data.building ? 'le chantier de la tour de guet' : joinFr(e.data.structures.map(theStructure));
      return `La horde a saccagé ${what} ${deLabel(e.data.label)}. ${FIX.reparer}`;
    },
  },
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
      const where = dePlaces(labels(evs));
      const how = evs.length === 1 ? lossWord(worst) : `jusqu'à ${lossWord(worst)}`;
      return `Les nuisibles ont ravagé ${how} de la récolte ${where}. ${FIX.patrouiller}${debug ? dbg(evs, ['lossPct', 'threat']) : ''}`;
    },
    repeat: {
      priority: () => 9,
      text: (evs, debug) => {
        const worst = Math.max(...evs.map((e) => e.data.lossPct));
        return `Les nuisibles s'acharnent sur les récoltes ${dePlaces(labels(evs))} : ${evs.length === 1 ? '' : "jusqu'à "}${lossWord(worst)} de perdu cette fois encore. Sans patrouille, cela continuera.${debug ? dbg(evs, ['lossPct', 'threat']) : ''}`;
      },
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
    repeat: { priority: () => 1 },
    priority: () => 2,
    text: (evs) => {
      // Les patrouilles sont regroupées : « des patrouilles dans les champs du Nord et de l'Est ».
      const patrols = evs.filter((e) => e.data.kind === 'patrouille');
      const parts = evs.filter((e) => e.data.kind !== 'patrouille').map((e) => QUEST_TEXT[e.data.kind](e));
      if (patrols.length === 1) parts.unshift(QUEST_TEXT.patrouille(patrols[0]));
      if (patrols.length > 1) parts.unshift(`des patrouilles dans ${joinPlaces(labels(patrols))}`);
      return `Au village, on cherche ${joinFr(parts)}.`;
    },
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
    repeat: {
      priority: (e) => (e.data.dist <= 2 ? 7 : 4),
      text: (evs, debug) => `Les monstres gagnent encore du terrain, ${somePlaces(labels(evs)).replace(/^(notamment )?/, (m, n) => (n ? 'notamment dans ' : 'cette fois dans '))}.${debug ? dbg(evs, ['pressure']) : ''}`,
    },
  },
  horde: {
    priority: (e) => (e.data.dist <= 3 ? 8 : 6),
    text: (evs) => evs.map((e) => (e.data.label === e.data.target
      ? `Une horde s'est formée dans ${e.data.label} et se rapproche du village.`
      : `Une horde a quitté ${e.data.label} et s'abat sur ${e.data.target}, un pas de plus vers le village.`)).join(' '),
  },
  fields_threatened: {
    priority: () => 9,
    text: (evs, debug) => `Des bêtes rôdent autour ${dePlaces(labels(evs))}. ${FIX.patrouiller}${debug ? dbg(evs, ['pressure']) : ''}`,
  },
  retreat: {
    key: (e) => e.data.label,
    priority: () => 6,
    text: (evs) => `${cap(who(evs))} ${plural(evs) ? 'ont dû' : 'a dû'} battre en retraite face aux monstres ${deLabel(evs[0].data.label)} : trop nombreux pour un combattant seul. ${FIX.groupe}`,
  },
  zone_cleared: {
    priority: () => 7,
    text: (evs, debug) => `${cap(who(evs))} ${plural(evs) ? 'ont nettoyé' : 'a nettoyé'} ${joinPlaces(labels(evs))} : les monstres n'y sont plus qu'une poignée.${debug ? dbg(evs, ['from', 'to']) : ''}`,
  },
  monsters_pushed: {
    priority: () => 4,
    text: (evs, debug) => `${cap(who(evs))} ${plural(evs) ? 'ont repoussé' : 'a repoussé'} les monstres ${dePlaces(labels(evs))}.${debug ? dbg(evs, ['from', 'to']) : ''}`,
  },
  path_formed: {
    priority: () => 3,
    text: (evs) => `À force de passages, un vrai sentier traverse désormais ${joinPlaces(labels(evs))}.`,
  },
  path_fading: {
    priority: () => 3,
    text: (evs, debug) => `${cap(evs.length > 1 ? 'les chemins' : 'le chemin')} ${dePlaces(labels(evs))} ${evs.length > 1 ? 'se couvrent' : 'se couvre'} d'herbes, faute de passage. ${FIX.emprunter(evs.length)}${debug ? dbg(evs, ['wear']) : ''}`,
    repeat: { priority: () => 1 },
  },
  path_lost: {
    priority: () => 4,
    text: (evs) => `${cap(evs.length > 1 ? 'les chemins' : 'le chemin')} ${dePlaces(labels(evs))} ${evs.length > 1 ? 'ont disparu' : 'a disparu'} sous la végétation. Il faudra ${evs.length > 1 ? 'les' : 'le'} rouvrir à pied.`,
    repeat: {
      priority: () => 2,
      text: (evs) => `La végétation continue d'effacer les chemins : ${evs.length > 1 ? 'ceux' : 'celui'} ${dePlaces(labels(evs))} ${evs.length > 1 ? 'ont disparu à leur tour' : 'a disparu à son tour'}.`,
    },
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

// `repeat` : le même genre de nouvelle a déjà été racontée la veille. On varie la tournure
// et on baisse l'importance, pour qu'un refrain ne mange pas la place des nouveautés.
function renderGroup(type, evs, debug, repeat = false) {
  const r = RENDERERS[type];
  if (!r) return { priority: 0, text: `(${type})${debug ? ` ${JSON.stringify(evs.map((e) => e.data))}` : ''}` };
  const rr = repeat && r.repeat ? { ...r, ...r.repeat } : r;
  return { priority: Math.max(...evs.map((e) => rr.priority(e))), text: rr.text(evs, debug) };
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
  const built = new Set(events.filter((e) => e.type === 'structure_built').map(key));
  return events.filter((e) => {
    if (e.type === 'construction_started' && built.has(key(e))) return false;
    if (e.type === 'path_fading' && lostPaths.has(`${e.day}|${e.data.label}`)) return false;
    if ((e.type === 'hunt' || e.type === 'exploration') && fought.has(key(e))) return false;
    if (COMBAT.has(e.type) && e.type !== 'retreat' && guarded.has(key(e))) return false;
    return true;
  });
}

// Actions des joueurs : dans le résumé « pendant votre absence », l'état du monde passe avant.
const PLAYER_ACTIONS = new Set(['zone_cleared', 'monsters_pushed', 'quest_done', 'hunt', 'exploration', 'player_return', 'retreat', 'player_down', 'forged']);

// Transforme les events d'une période en lignes triées par importance.
// Les traces lointaines laissées par les explorateurs s'effacent sans que cela intéresse le village.
const minor = (e) => (e.type === 'path_fading' || e.type === 'path_formed') && e.data.dist >= 4;

export function linesFor(events, { debug = false, max = MAX_LINES, worldFirst = false, previous = new Set() } = {}) {
  const lines = groupEvents(dedupe(events).filter((e) => e.type !== 'contree' && (RENDERERS[e.type] || debug) && (debug || !minor(e))))
    .map((g) => {
      const r = renderGroup(g.type, g.events, debug, previous.has(g.type));
      if (worldFirst && PLAYER_ACTIONS.has(g.type)) r.priority -= 4;
      return { ...r, first: g.first };
    })
    .filter((l) => l.text)
    .sort((a, b) => b.priority - a.priority || a.first - b.first);
  return lines.slice(0, max).map((l) => l.text);
}

// Lignes d'un jour donné, en tenant compte de ce qui a déjà été raconté la veille.
export function dayLines(events, day, { debug = false } = {}) {
  const previous = new Set(events.filter((e) => e.day === day - 1).map((e) => e.type));
  return linesFor(events.filter((e) => e.day === day), { debug, previous });
}

function header(events) {
  const c = events.find((e) => e.type === 'contree');
  if (!c) return [];
  const { name, biome, exclusives } = c.data;
  const BIOME_TERRE = { foret: 'de forêts', plaine: 'de plaines', colline: 'de collines', marais: 'de marais', montagne: 'de montagnes' };
  return [
    `# Chronique ${/^[AEIOUYÉÈ]/i.test(name) ? `d'${name}` : `de ${name}`}`,
    '',
    `Une terre ${BIOME_TERRE[biome]}. On y trouve ${joinFr(exclusives.map((x) => PARTITIVE[x] ?? x))}, introuvables ailleurs ; le reste devra venir d'autres contrées.`,
    '',
  ];
}

// Résumé « pendant votre absence » : l'état du monde d'abord, puis les faits des autres.
export function summarySince(events, since, { debug = false, max = MAX_LINES } = {}) {
  return linesFor(events.filter((e) => e.day >= since), { debug, max, worldFirst: true });
}

// Texte d'une quête du tableau du village (« une patrouille dans les champs du Nord »).
export function questText(q) {
  const f = QUEST_TEXT[q.kind];
  return f ? f({ data: { kind: q.kind, job: q.job ?? null, label: q.label ?? null, structure: q.structure ?? null } }) : q.kind;
}

export function formatChronicle(events, { debug = false, since = null, days: nbDays = null } = {}) {
  const out = header(events);
  const lastDay = nbDays ?? Math.max(0, ...events.map((e) => e.day));
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);

  if (since != null) {
    const last = Math.max(lastDay, since);
    out.push(`## Pendant votre absence (jours ${since} à ${last})`, '');
    const lines = summarySince(events, since, { debug });
    if (lines.length === 0) lines.push('Rien de notable ne s\'est produit.');
    for (const l of lines) out.push(`- ${l}`);
    return out.join('\n');
  }

  for (const day of days) {
    const dayEvents = events.filter((e) => e.day === day);
    const lines = dayLines(events, day, { debug });
    if (lines.length === 0) lines.push('Journée calme dans la contrée.');
    const start = dayEvents.find((e) => e.type === 'day_start');
    out.push(start ? `## Jour ${day} — ${start.data.season}, ${start.data.weather}` : `## Jour ${day}`, '');
    for (const l of lines) out.push(`- ${l}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}
