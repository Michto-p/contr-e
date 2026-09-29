// Population du village : des habitants avec un nom, un âge, un métier, des compétences et un
// caractère. Ils forment des couples, ont des enfants qui apprennent de leurs parents, de leurs
// grands-parents et de l'enseignant, puis reprennent un métier (souvent celui de la famille) avec
// parfois un talent en plus. Les talents agissent sur le monde : replanter, ouvrir un passage,
// défricher un nouveau champ, inventer un plan à partir des ressources rares rapportées de loin.
//
// Par défaut, un jour de jeu = une année de vie ; `yearsPerDay` règle ce rythme (0,25 = une saison
// par jour). Le système a son propre générateur (sauvegardé dans l'état) pour ne pas bouleverser
// le tirage des autres systèmes.
import { createRng } from '../rng.js';
import { clamp, neighbors, zoneLabel, standing, OUTPOST } from '../world.js';

export const ADULT = 16;
export const ELDER = 62;
export const SKILLS = ['culture', 'cuisine', 'forge', 'bois', 'elevage', 'savoir', 'armes'];
export const JOB_SKILL = {
  agriculteur: 'culture', boulanger: 'cuisine', forgeron: 'forge', bucheron_mineur: 'bois', eleveur: 'elevage', enseignant: 'savoir', garde: 'armes',
};
export const TRAITS = ['travailleur', 'curieux', 'bavard', 'prudent', 'audacieux', 'rêveur', 'têtu', 'patient'];
// Un métier bien appris + du savoir = un talent.
export const TALENTS = {
  bucheron_mineur: 'forestier', agriculteur: 'agronome', forgeron: 'inventeur', eleveur: 'bouvier', boulanger: 'maître des levains', enseignant: 'érudit', garde: "maître d'armes",
};
const TALENT_SAVOIR = 50;
const TALENT_SKILL = 40;
const MAX_FIELDS = 6;
const BASE_HOUSES = 9;

const PRENOMS = [
  'Léna', 'Jules', 'Anna', 'Hugo', 'Rose', 'Louis', 'Marthe', 'Basile', 'Jeanne', 'Victor', 'Suzanne', 'Émile', 'Lucie',
  'Gabin', 'Ninon', 'Arthur', 'Margot', 'Léon', 'Adèle', 'Félix', 'Zoé', 'Anselme', 'Berthe', 'Firmin', 'Odile',
  'Augustin', 'Mathilde', 'Honoré', 'Colette', 'Paul', 'Clémence', 'Baptiste', 'Agathe', 'Octave', 'Irène', 'Lazare',
  'Salomé', 'Gustave', 'Blanche', 'Marius', 'Hortense', 'Jasmin', 'Céleste', 'Dominique', 'Claude', 'Andréa', 'Loïs', 'Gaël',
];
const FAMILLES = [
  'Meunier', 'Charron', 'Fabre', 'Berger', 'Morel', 'Garnier', 'Roux', 'Faure', 'Bonnet', 'Lefèvre', 'Tisserand',
  'Marchal', 'Chevalier', 'Vasseur', 'Delorme', 'Aubry', 'Perrin', 'Lemoine', 'Carpentier', 'Rolland',
];

// ---------- Création ----------

function newSkills(rng, job) {
  const skills = {};
  for (const k of SKILLS) skills[k] = rng.int(5, 30);
  if (job) skills[JOB_SKILL[job]] = rng.int(40, 70);
  return skills;
}

function twoTraits(rng) {
  const a = rng.pick(TRAITS);
  let b = rng.pick(TRAITS);
  while (b === a) b = rng.pick(TRAITS);
  return [a, b];
}

function freeName(rng, pop) {
  const used = new Set(pop.people.filter((p) => p.alive).map((p) => p.prenom));
  const free = PRENOMS.filter((n) => !used.has(n));
  return rng.pick(free.length ? free : PRENOMS);
}

function makePerson(pop, rng, { prenom, famille, age, metier = null, skills, traits, parents = [] }) {
  const p = {
    id: pop.nextId++, prenom: prenom ?? freeName(rng, pop), famille, age, metier, skills, traits,
    parents, partner: null, alive: true, talent: null, mood: 70,
    born: (pop.day ?? 1) - age, died: null, outing: null,
  };
  pop.people.push(p);
  return p;
}

// Village de départ : cinq foyers, des enfants, deux anciens.
export function createPopulation(seed, { yearsPerDay = 1 } = {}) {
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const pop = { people: [], nextId: 1, houses: BASE_HOUSES, rares: {}, plans: [], nextPlanId: 1, rng: 0, day: 1, yearsPerDay, yearClock: 0 };
  const jobs = ['agriculteur', 'agriculteur', 'boulanger', 'boulanger', 'forgeron', 'forgeron', 'bucheron_mineur', 'bucheron_mineur', 'eleveur', 'enseignant'];
  // Mélange déterministe des métiers.
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }
  const familles = [...FAMILLES];
  for (let c = 0; c < 5; c++) {
    const famille = familles.splice(rng.int(0, familles.length - 1), 1)[0];
    const a = makePerson(pop, rng, { famille, age: rng.int(25, 45), metier: jobs[c * 2], skills: newSkills(rng, jobs[c * 2]), traits: twoTraits(rng) });
    const b = makePerson(pop, rng, { famille: rng.chance(0.5) ? famille : familles.splice(rng.int(0, familles.length - 1), 1)[0], age: rng.int(25, 45), metier: jobs[c * 2 + 1], skills: newSkills(rng, jobs[c * 2 + 1]), traits: twoTraits(rng) });
    a.partner = b.id;
    b.partner = a.id;
    for (const p of [a, b]) if (p.metier === 'enseignant') p.skills.savoir = rng.int(60, 80);
    const kids = rng.int(0, 2);
    for (let k = 0; k < kids; k++) {
      makePerson(pop, rng, { famille, age: rng.int(2, 14), skills: newSkills(rng, null), traits: twoTraits(rng), parents: [a.id, b.id] });
    }
  }
  // Un garde, jeune et audacieux, veille déjà sur le village.
  {
    const skills = newSkills(rng, 'garde');
    const traits = ['audacieux', rng.pick(TRAITS.filter((t) => t !== 'audacieux'))];
    makePerson(pop, rng, { famille: rng.pick(FAMILLES), age: rng.int(20, 28), metier: 'garde', skills, traits });
  }
  for (let e = 0; e < 2; e++) {
    const job = rng.pick(['agriculteur', 'forgeron', 'bucheron_mineur', 'boulanger']);
    const elder = makePerson(pop, rng, { famille: rng.pick(FAMILLES), age: rng.int(63, 70), metier: 'ancien', skills: newSkills(rng, job), traits: twoTraits(rng) });
    elder.ancienMetier = job;
    elder.skills.savoir = rng.int(40, 60);
  }
  pop.rng = rng.save();
  return pop;
}

// ---------- Outils ----------

const living = (pop) => pop.people.filter((p) => p.alive);
// La renommée (0–100) : ce que le village retient des hauts faits de chacun.
export const fame = (p, n) => { if (p) p.renommee = clamp((p.renommee ?? 0) + n); };
// Présents au village : un personnage qu'un joueur incarne en ce moment est parti à l'aventure.
const present = (pop) => living(pop).filter((p) => !p.played);
const byId = (pop, id) => pop.people.find((p) => p.id === id);
export const fullName = (p) => `${p.prenom} ${p.famille}`;

export function workers(pop, job) {
  return present(pop).filter((p) => p.metier === job);
}

// Facteur de production d'un métier selon ceux qui l'exercent (0,6 à 1,5 ; environ 1 au départ).
export function workforceFactor(state, job) {
  const pop = state.village.population;
  if (!pop) return 1;
  const skill = JOB_SKILL[job];
  let sum = 0;
  for (const w of workers(pop, job)) {
    let v = w.skills[skill] / 100;
    if (w.traits.includes('travailleur')) v *= 1.15;
    if (w.talent) v += 0.15;
    if (w.hero || w.ancienHeros) v += w.heroBonus ?? 0.2; // le savoir-faire rapporté de ses aventures
    sum += v;
  }
  let factor = 0.6 + 0.4 * sum;
  // Un maître d'atelier fait mieux travailler tout le métier ; un chef écouté, tout le village.
  const master = pop.maitres?.[job] != null ? byId(pop, pop.maitres[job]) : null;
  if (master?.alive && !master.played && master.metier === job) factor += 0.1;
  if (pop.chef != null && byId(pop, pop.chef)?.alive) factor += 0.05;
  if (job === 'agriculteur' && workers(pop, 'eleveur').length) factor += 0.1; // le fumier des bêtes
  return Math.max(0.6, Math.min(1.5, factor));
}

export function capacityOf(pop, state) {
  const levels = Object.values(state.village.jobs).reduce((s, j) => s + j.level, 0);
  return pop.houses * 2 + levels;
}

function talentFor(p) {
  if (!p.metier || !TALENTS[p.metier]) return null;
  if (p.skills.savoir >= TALENT_SAVOIR && p.skills[JOB_SKILL[p.metier]] >= TALENT_SKILL) return TALENTS[p.metier];
  return null;
}

function childrenOf(pop, p) {
  return pop.people.filter((c) => c.parents.includes(p.id));
}

// ---------- Une journée (une année) ----------

function learn(pop, state) {
  const people = living(pop);
  const teacher = people.find((p) => p.metier === 'enseignant');
  for (const p of people) {
    if (p.age >= ADULT && p.metier && JOB_SKILL[p.metier]) {
      // On progresse en pratiquant.
      const k = JOB_SKILL[p.metier];
      p.skills[k] = clamp(p.skills[k] + (p.traits.includes('travailleur') ? 2 : 1));
      // Apprenti : un jeune qui travaille auprès d'un maître apprend plus vite.
      const master = pop.maitres?.[p.metier] != null ? byId(pop, pop.maitres[p.metier]) : null;
      if (p.age < 22 && master?.alive && master !== p) p.skills[k] = clamp(p.skills[k] + 2);
    }
    if (p.age >= ADULT) continue;
    // Les enfants apprennent de leurs parents, grands-parents et de l'enseignant.
    for (const pid of p.parents) {
      const parent = byId(pop, pid);
      if (!parent?.alive) continue;
      const job = parent.metier === 'ancien' ? parent.ancienMetier : parent.metier;
      if (job && JOB_SKILL[job]) p.skills[JOB_SKILL[job]] = clamp(p.skills[JOB_SKILL[job]] + 2 + (parent.traits.includes('bavard') ? 1 : 0));
      for (const gid of parent.parents) {
        const gp = byId(pop, gid);
        const gjob = gp?.alive ? (gp.metier === 'ancien' ? gp.ancienMetier : gp.metier) : null;
        if (gjob && JOB_SKILL[gjob]) p.skills[JOB_SKILL[gjob]] = clamp(p.skills[JOB_SKILL[gjob]] + 1);
      }
    }
    if (teacher) p.skills.savoir = clamp(p.skills.savoir + 2 + (teacher.talent ? 1 : 0));
    if (p.traits.includes('curieux')) p.skills.savoir = clamp(p.skills.savoir + 1);
  }
}

// À seize ans, on choisit un métier : l'héritage familial, ses dons et les besoins du village.
function comeOfAge(pop, state, rng, ctx, events) {
  for (const p of living(pop)) {
    if (p.age !== ADULT || p.metier) continue;
    const parentJobs = p.parents.map((id) => byId(pop, id)).filter(Boolean)
      .map((q) => (q.metier === 'ancien' ? q.ancienMetier : q.metier)).filter((j) => JOB_SKILL[j]);
    let best = null;
    let bestScore = -Infinity;
    for (const job of Object.keys(JOB_SKILL)) {
      const count = workers(pop, job).length;
      // Le village a besoin de monde partout, mais d'un seul enseignant et d'un ou deux éleveurs.
      let need;
      if (job === 'enseignant') need = count ? -60 : 30;
      else if (job === 'eleveur') need = count >= 2 ? -40 : count ? 0 : 35;
      else if (job === 'garde') need = count >= 3 ? -40 : 12 * (3 - count) + (p.traits.includes('audacieux') ? 15 : 0);
      else need = 15 * (3 - count);
      const sat = state.village.jobs[job]?.satisfaction ?? 60;
      // Le savoir sert partout : il compte moins pour choisir l'école.
      const skill = job === 'enseignant' ? p.skills.savoir * 0.5 : p.skills[JOB_SKILL[job]];
      const score = skill + (parentJobs.includes(job) ? 25 : 0) + need + (sat < 45 ? 10 : 0) + rng.int(0, 10);
      if (score > bestScore) { bestScore = score; best = job; }
    }
    p.metier = best;
    p.talent = talentFor(p);
    const heir = p.parents.map((id) => byId(pop, id)).find((q) => q && (q.metier === best || q.ancienMetier === best));
    events.push(ctx.event('coming_of_age', null, { name: fullName(p), prenom: p.prenom, job: best, heir: heir ? heir.prenom : null, talent: p.talent }));
  }
}

function retireAndDie(pop, state, rng, ctx, events) {
  for (const p of living(pop)) {
    if (p.hero) continue;
    if (p.age >= ELDER && p.metier && p.metier !== 'ancien') {
      p.ancienMetier = p.metier;
      p.metier = 'ancien';
    }
    if (p.age >= 65 && rng.chance((p.age - 60) * 0.02)) {
      p.alive = false;
      p.died = ctx.day;
      p.outing = null;
      const partner = byId(pop, p.partner);
      if (partner) partner.partner = null;
      const job = p.ancienMetier ?? p.metier;
      const heirs = childrenOf(pop, p).filter((c) => c.alive && c.metier === job).map((c) => c.prenom);
      events.push(ctx.event('death', null, { name: fullName(p), age: p.age, job, heirs }));
    }
  }
}

// Chaque célibataire peut rencontrer quelqu'un d'un âge proche (jamais un frère, une sœur ou un parent).
function formCouples(pop, rng, ctx, events) {
  const related = (x, y) => (x.parents.length && x.parents.some((id) => y.parents.includes(id))) || x.parents.includes(y.id) || y.parents.includes(x.id);
  for (const a of living(pop)) {
    if (a.hero && !a.foyer) continue; // un personnage de joueur fonde une famille quand il a une maison
    if (a.partner || a.age < 18 || a.age > 50 || !rng.chance(0.15)) continue;
    const others = living(pop).filter((b) => b !== a && !b.hero && !b.partner && b.age >= 18 && b.age <= 50 && Math.abs(a.age - b.age) <= 10 && !related(a, b));
    if (!others.length) continue;
    const b = rng.pick(others);
    a.partner = b.id;
    b.partner = a.id;
    events.push(ctx.event('couple', null, { names: [a.prenom, b.prenom] }));
  }
}

function births(pop, state, rng, ctx, events) {
  // Des enfants seulement quand il y a du pain d'avance : la prospérité fait la population.
  const bread = state.village.jobs.boulanger.stock.pain ?? 0;
  if (state.village.hungry || bread < Math.ceil(living(pop).length / 2)) return;
  if (living(pop).length >= capacityOf(pop, state)) return;
  const seen = new Set();
  for (const a of living(pop)) {
    if (!a.partner || seen.has(a.id)) continue;
    const b = byId(pop, a.partner);
    seen.add(a.id);
    seen.add(b.id);
    if (!b?.alive || a.age < 18 || b.age < 18 || a.age > 45 || b.age > 45) continue;
    // Au plus un enfant tous les deux ans par couple (compté sur l'habitant qui vieillit :
    // un personnage de joueur, lui, ne vieillit pas).
    const clock = a.hero ? b : a;
    if (clock.lastChild != null && clock.age - clock.lastChild < 2) continue;
    if (!rng.chance(0.2)) continue;
    clock.lastChild = clock.age;
    // Chaque enfant hérite un peu des dons de ses deux parents, et d'un trait de chacun.
    const skills = {};
    for (const k of SKILLS) skills[k] = clamp(Math.round((a.skills[k] + b.skills[k]) * 0.15 + Math.max(a.skills[k], b.skills[k]) * 0.2 + rng.int(0, 6)));
    const traits = [rng.chance(0.7) ? rng.pick(a.traits) : rng.pick(TRAITS)];
    let t2 = rng.chance(0.7) ? rng.pick(b.traits) : rng.pick(TRAITS);
    if (t2 === traits[0]) t2 = TRAITS.find((t) => t !== traits[0]);
    traits.push(t2);
    // L'enfant d'un personnage de joueur porte le nom de sa famille.
    const child = makePerson(pop, rng, { famille: (b.hero ? b : a).famille, age: 0, skills, traits, parents: [a.id, b.id] });
    events.push(ctx.event('birth', null, { name: fullName(child), prenom: child.prenom, parents: [a.prenom, b.prenom] }));
    if (living(pop).length >= capacityOf(pop, state)) break;
  }
}

// Quand les maisons manquent, on en bâtit une avec le bois du village.
function build(pop, state, ctx, events) {
  const wood = state.village.jobs.bucheron_mineur.stock;
  if (living(pop).length >= capacityOf(pop, state) - 1 && (wood.bois ?? 0) >= 15) {
    wood.bois -= 15;
    pop.houses += 1;
    events.push(ctx.event('house_built', null, { houses: pop.houses }));
  }
  extend(pop, state, ctx, events);
}

// Maisons abandonnées. Quand trop de maisons restent vides, l'une d'elles est laissée à l'abandon ;
// sans entretien, une maison abandonnée tombe en ruine et devient un repaire de bêtes, jusque dans le
// village. N'importe qui peut la remettre en état (voir le jeu) : elle est alors réhabitée.
export const RUIN_DECAY = 6; // par jour
export const RUIN_DANGER = 40; // en dessous : un repaire
function abandon(pop, state, rng, ctx, events) {
  const ruines = state.village.ruines ??= [];
  for (const r of ruines) {
    const before = r.condition;
    r.condition = clamp(r.condition - RUIN_DECAY);
    if (before >= RUIN_DANGER && r.condition < RUIN_DANGER) {
      events.push(ctx.event('ruin_dangerous', null, { owner: r.owner ?? null, fix: 'reparer' }));
    }
  }
  const empty = pop.houses * 2 - living(pop).length;
  if (empty < 8 || pop.houses <= 4 || !rng.chance(0.2)) return;
  const taken = new Set(ruines.filter((r) => r.kind === 'maison').map((r) => r.index));
  let index = Math.min(pop.houses - 1, VILLAGE_ROOM + (state.village.faubourgs?.length ?? 0) * FAUBOURG_ROOM - 1);
  while (index >= 0 && taken.has(index)) index -= 1;
  if (index < 0) return;
  pop.houses -= 1;
  state.village.nextRuinId = (state.village.nextRuinId ?? 0) + 1;
  ruines.push({ id: state.village.nextRuinId, kind: 'maison', index, condition: 80 });
  events.push(ctx.event('house_abandoned', null, { owner: null, fix: 'reparer' }));
}

// Une ruine remise en état : la maison d'habitants est réhabitée (le terrain d'un joueur, libéré).
export function restoreRuin(state, id) {
  const ruines = state.village.ruines ?? [];
  const r = ruines.find((x) => x.id === id);
  if (!r) return null;
  state.village.ruines = ruines.filter((x) => x !== r);
  if (r.kind === 'maison' && state.village.population) state.village.population.houses += 1;
  return r;
}

// Le village s'agrandit : quand son cœur est plein de maisons, un pré voisin (en diagonale, entre
// deux champs) devient un faubourg, sûr comme le village, avec ses maisons et ses terrains.
// Il grandit aussi quand les joueurs ont pris presque tous les terrains à bâtir.
export const VILLAGE_ROOM = 11; // maisons d'habitants dans le cœur du village
export const FAUBOURG_ROOM = 6; // maisons d'habitants, et terrains de joueurs, par faubourg
export const VILLAGE_LOTS = 10; // terrains de joueurs dans le cœur du village
export const MAX_FAUBOURGS = 4;
function extend(pop, state, ctx, events) {
  const faubourgs = state.village.faubourgs ??= [];
  if (faubourgs.length >= MAX_FAUBOURGS) return;
  const crowded = pop.houses > VILLAGE_ROOM + faubourgs.length * FAUBOURG_ROOM;
  const lotsFull = (state.village.playerHouses ?? 0) >= VILLAGE_LOTS + faubourgs.length * FAUBOURG_ROOM - 1;
  if (!crowded && !lotsFull) return;
  const v = state.zones[state.villageId];
  const site = neighbors(state, v)
    .filter((z) => z.x !== v.x && z.y !== v.y && !z.isField && !z.closed && !z.faubourg)
    .sort((a, b) => a.monsterPressure - b.monsterPressure || a.id - b.id)[0];
  if (!site) return;
  site.faubourg = true;
  site.monsterPressure = Math.min(site.monsterPressure, 10);
  site.label = zoneLabel(site);
  faubourgs.push(site.id);
  events.push(ctx.event('village_grows', site, { label: site.label }));
}

// ---------- Voyageurs égarés ----------

// De temps en temps, quelqu'un s'égare dans les terres lointaines. Si on va le chercher (un joueur,
// ou un habitant curieux), il s'installe au village avec son savoir-faire ; sinon, au bout de
// quelques jours, il reprend sa route. D'autres passeront.
const LOST_DAYS = 6;
const LOST_CHANCE = 0.15;

function wanderers(pop, state, rng, ctx, events) {
  if (pop.lost) {
    if (ctx.day - pop.lost.since >= LOST_DAYS) {
      events.push(ctx.event('wanderer_gone', pop.lost.zone, { prenom: pop.lost.prenom, label: state.zones[pop.lost.zone].label }));
      pop.lost = null;
    }
    return;
  }
  if (!rng.chance(LOST_CHANCE)) return;
  const far = state.zones.filter((z) => !z.closed && !z.isField && z.dist >= 3 && z.dist <= 5);
  if (!far.length) return;
  const z = rng.pick(far);
  // Venu d'ailleurs, il sait déjà bien faire quelque chose.
  const skills = newSkills(rng, null);
  const strong = rng.pick(SKILLS);
  skills[strong] = rng.int(60, 80);
  pop.lost = {
    id: pop.nextLostId = (pop.nextLostId ?? 0) + 1, prenom: freeName(rng, pop), famille: rng.pick(FAMILLES),
    age: rng.int(18, 40), skills, traits: twoTraits(rng), zone: z.id, since: ctx.day,
  };
  events.push(ctx.event('wanderer_seen', z, { prenom: pop.lost.prenom, label: z.label, fix: 'ramener' }));
}

// L'égaré arrive au village et s'installe : il prend le métier où son savoir est le plus utile.
function welcome(pop, state, rng, who, ctx, events) {
  const l = pop.lost;
  if (!l) return null;
  const p = makePerson(pop, rng, { prenom: l.prenom, famille: l.famille, age: l.age, skills: l.skills, traits: l.traits });
  const jobs = Object.keys(JOB_SKILL).sort((a, b) => (p.skills[JOB_SKILL[b]] - workers(pop, b).length * 8) - (p.skills[JOB_SKILL[a]] - workers(pop, a).length * 8));
  p.metier = jobs[0];
  p.talent = talentFor(p);
  pop.lost = null;
  const e = ctx.event('wanderer_rescued', null, { who, name: fullName(p), prenom: p.prenom, job: p.metier, talent: p.talent });
  events.push(e);
  return e;
}

// ---------- Hiérarchie du village ----------

// Chaque jour, le village se reconnaît un chef (l'adulte le plus respecté : renommée, sagesse,
// savoir-faire, âge) et, dans chaque métier, un maître d'atelier (le plus habile). Les jeunes de
// moins de 22 ans qui exercent un métier sont les apprentis de son maître. Un personnage de joueur
// peut prendre la tête du village par ses hauts faits.
const MASTER_SKILL = 45;
export function prestige(p) {
  const best = Math.max(...Object.values(p.skills));
  return (p.renommee ?? 0) + p.skills.savoir * 0.3 + best * 0.3 + Math.min(p.age, 60) * 0.3 + (p.talent ? 8 : 0);
}

export function rankOf(pop, p) {
  if (pop.chef === p.id) return 'chef';
  if (Object.values(pop.maitres ?? {}).includes(p.id)) return 'maitre';
  if (p.metier && JOB_SKILL[p.metier] && p.age < 22 && pop.maitres?.[p.metier] != null) return 'apprenti';
  return '';
}

function hierarchy(pop, state, ctx, events) {
  const adults = living(pop).filter((p) => p.age >= 20 && p.metier !== 'ancien' || (p.metier === 'ancien' && p.age < 80));
  const chef = [...adults].sort((a, b) => prestige(b) - prestige(a) || a.id - b.id)[0] ?? null;
  if (chef && chef.id !== pop.chef) {
    const before = pop.chef != null ? byId(pop, pop.chef) : null;
    pop.chef = chef.id;
    events.push(ctx.event('new_chief', null, { name: fullName(chef), prenom: chef.prenom, job: chef.metier, before: before?.alive ? before.prenom : null, hero: chef.hero ?? null }));
  }
  pop.maitres ??= {};
  for (const job of Object.keys(JOB_SKILL)) {
    const skill = JOB_SKILL[job];
    const best = living(pop).filter((p) => p.metier === job && p.skills[skill] >= MASTER_SKILL)
      .sort((a, b) => b.skills[skill] - a.skills[skill] || a.id - b.id)[0] ?? null;
    const current = pop.maitres[job] != null ? byId(pop, pop.maitres[job]) : null;
    // Un maître garde sa place tant qu'il exerce, sauf si un autre le dépasse nettement.
    const keep = current?.alive && current.metier === job && (!best || best.skills[skill] < current.skills[skill] + 10);
    if (keep) continue;
    if (best) {
      pop.maitres[job] = best.id;
      events.push(ctx.event('new_master', null, { name: fullName(best), prenom: best.prenom, job }));
    } else delete pop.maitres[job];
  }
}

// ---------- Personnages des joueurs ----------

// Chaque joueur peut avoir quelques personnages. Celui qu'il n'incarne pas vit au village comme
// un habitant (il travaille s'il a un métier, avec le savoir-faire rapporté de ses aventures).
// Tant qu'il appartient à un joueur, il ne vieillit pas et ne meurt pas. Délaissé trop longtemps,
// il reste au village pour de bon et vit désormais comme les autres.
export const HERO_JOBS = ['aventurier', 'agriculteur', 'boulanger', 'forgeron', 'bucheron_mineur', 'eleveur', 'garde'];

export function createHero(state, { prenom, metier = 'aventurier', owner, famille = owner, bonus = 0.2 }, ctx) {
  const pop = state.village.population;
  if (!pop) return null;
  const prng = createRng(pop.rng);
  const job = HERO_JOBS.includes(metier) ? metier : 'aventurier';
  const skills = newSkills(prng, JOB_SKILL[job] ? job : null);
  if (JOB_SKILL[job]) skills[JOB_SKILL[job]] = prng.int(55, 65);
  const p = makePerson(pop, prng, { prenom, famille, age: prng.int(20, 26), metier: job, skills, traits: twoTraits(prng) });
  p.hero = owner;
  p.heroBonus = bonus;
  p.played = false;
  pop.rng = prng.save();
  const e = ctx.event('hero_arrives', null, { name: fullName(p), prenom: p.prenom, owner, job });
  return { person: p, event: e };
}

export function setPlayed(state, id, played) {
  const p = state.village.population?.people.find((q) => q.id === id);
  if (!p) return false;
  p.played = Boolean(played);
  if (played) p.outing = null;
  return true;
}

// Un joueur qui a une maison : ses personnages peuvent fonder une famille au village.
export function setFoyer(state, owner) {
  for (const p of state.village.population?.people ?? []) if (p.hero === owner) p.foyer = true;
}

export function releaseHero(state, id, ctx) {
  const p = state.village.population?.people.find((q) => q.id === id);
  if (!p?.hero) return null;
  p.ancienHeros = p.hero;
  p.hero = null;
  p.played = false;
  return ctx.event('hero_settles', null, { name: fullName(p), prenom: p.prenom, owner: p.ancienHeros, job: p.metier });
}

// Appelé par le jeu quand des joueurs ramènent l'égaré au village.
export function rescueLost(state, who, ctx) {
  const pop = state.village.population;
  if (!pop?.lost) return null;
  const prng = createRng(pop.rng);
  const events = [];
  welcome(pop, state, prng, who, ctx, events);
  pop.rng = prng.save();
  return events[0] ?? null;
}

// Plancher : le village ne disparaît jamais. S'il se vide, des familles viennent s'installer ;
// un village prospère mais peu peuplé attire aussi du monde.
function immigration(pop, state, rng, ctx, events) {
  const alive = living(pop);
  const adults = alive.filter((p) => p.age >= ADULT && p.metier !== 'ancien');
  const prosperous = !state.village.hungry && (state.village.jobs.boulanger.stock.pain ?? 0) >= Math.ceil(alive.length / 2) + 5;
  const needed = adults.length < 4 || (prosperous && alive.length < 14 && rng.chance(0.15));
  if (!needed || alive.length >= capacityOf(pop, state)) return;
  const famille = rng.pick(FAMILLES);
  const names = [];
  const a = makePerson(pop, rng, { famille, age: rng.int(20, 32), metier: null, skills: newSkills(rng, null), traits: twoTraits(rng) });
  const b = makePerson(pop, rng, { famille, age: rng.int(20, 32), metier: null, skills: newSkills(rng, null), traits: twoTraits(rng) });
  a.partner = b.id;
  b.partner = a.id;
  // Les nouveaux venus prennent les métiers qui manquent le plus.
  for (const p of [a, b]) {
    const job = Object.keys(JOB_SKILL).sort((x, y) => workers(pop, x).length - workers(pop, y).length)[0];
    p.metier = job;
    p.skills[JOB_SKILL[job]] = rng.int(40, 65);
    names.push(p.prenom);
  }
  events.push(ctx.event('newcomers', null, { names, famille }));
}

// ---------- Talents en action ----------

function forestier(pop, state, rng, ctx, events) {
  for (const p of workers(pop, 'bucheron_mineur').filter((w) => w.talent === 'forestier')) {
    if (!rng.chance(0.3)) continue;
    const forests = state.zones.filter((z) => z.biome === 'foret' && !z.closed);
    // Replanter là où la coupe a clairsemé les bois.
    const thin = forests.filter((z) => z.vegetation < 80).sort((a, b) => a.vegetation - b.vegetation)[0];
    if (thin && rng.chance(0.5)) {
      thin.vegetation = clamp(thin.vegetation + 15);
      fame(p, 1);
      events.push(ctx.event('replant', thin, { who: p.prenom, label: thin.label }));
      continue;
    }
    // Choisir les arbres à abattre pour ouvrir un passage vers les terres lointaines.
    // Un même passage n'est rouvert qu'au bout de dix jours.
    const target = forests.filter((z) => z.pathWear < 40 && z.dist >= 2 && ctx.day - (z.passageDay ?? -99) >= 10).sort((a, b) => a.dist - b.dist)[0];
    if (target) {
      target.pathWear = clamp(target.pathWear + 35);
      target.passageDay = ctx.day;
      fame(p, 2);
      events.push(ctx.event('passage', target, { who: p.prenom, label: target.label }));
    }
  }
}

// L'agronome et l'éleveur défrichent ensemble un pré voisin des champs : un nouveau champ naît.
function clearing(pop, state, rng, ctx, events) {
  const fields = state.zones.filter((z) => z.isField);
  if (fields.length >= MAX_FIELDS) return;
  // On ne défriche que quand le pain vient à manquer pour tout le monde.
  const mouths = Math.ceil(living(pop).length / 2);
  if ((state.village.jobs.boulanger.stock.pain ?? 0) >= mouths * 1.5) return;
  const agro = workers(pop, 'agriculteur').find((w) => w.talent === 'agronome' || w.skills.culture >= 70);
  const eleveur = workers(pop, 'eleveur').find((w) => w.skills.elevage >= 40);
  if (!agro || !eleveur || !rng.chance(0.2)) return;
  const candidates = state.zones.filter((z) => !z.isField && !z.isVillage && !z.faubourg && !z.closed && z.biome === 'plaine'
    && z.dist <= 2 && z.monsterPressure < 30 && z.structures.length === 0
    && neighbors(state, z).some((n) => n.isField && (n.x === z.x || n.y === z.y)));
  if (!candidates.length) return;
  const z = candidates.sort((a, b) => a.monsterPressure - b.monsterPressure || a.id - b.id)[0];
  z.isField = true;
  z.resources.ble = 80;
  z.label = zoneLabel(z);
  fame(agro, 5);
  fame(eleveur, 5);
  events.push(ctx.event('new_field', z, { who: [agro.prenom, eleveur.prenom], label: z.label }));
}

// Avec des ressources rares rapportées par les joueurs, un forgeron savant invente un plan.
export const PLAN_TYPES = [
  { type: 'lame', nom: (m) => `Lame de ${m}`, effet: 'épée niveau 4 : 4 dégâts par coup' },
  { type: 'talisman', nom: (m) => `Talisman de ${m}`, effet: '+4 points de vie' },
];

function invent(pop, state, rng, ctx, events) {
  const smith = workers(pop, 'forgeron').find((w) => w.talent === 'inventeur' || w.skills.savoir >= 55 || w.traits.includes('curieux'));
  if (!smith) return;
  for (const [materiau, n] of Object.entries(pop.rares)) {
    if (n < 2 || !rng.chance(0.35)) continue;
    const known = new Set(pop.plans.filter((p) => p.materiau === materiau).map((p) => p.type));
    const todo = PLAN_TYPES.filter((t) => !known.has(t.type));
    if (!todo.length) continue;
    const t = rng.pick(todo);
    pop.rares[materiau] = n - 2;
    const plan = { id: pop.nextPlanId++, type: t.type, nom: t.nom(materiau), effet: t.effet, materiau, auteur: fullName(smith), contree: state.name, jour: ctx.day };
    pop.plans.push(plan);
    fame(smith, 10);
    events.push(ctx.event('invention', null, { who: smith.prenom, plan: plan.nom, materiau }));
    return;
  }
}

// ---------- Rumeurs : le caractère des habitants colore la chronique ----------

function rumor(pop, state, rng, ctx, events) {
  const adults = living(pop).filter((p) => p.age >= ADULT);
  if (!adults.length || !rng.chance(0.6)) return;
  const p = rng.pick(adults);
  const threatened = state.zones.filter((z) => z.isField && neighbors(state, z).some((n) => !n.isVillage && n.monsterPressure >= 50));
  let topic;
  if (state.village.hungry) topic = 'faim';
  else if (threatened.length) topic = 'menace';
  else if (Object.values(pop.rares).some((n) => n > 0)) topic = 'rares';
  else topic = 'calme';
  events.push(ctx.event('rumor', threatened[0] ?? null, { who: p.prenom, trait: rng.pick(p.traits), job: p.metier, topic, label: threatened[0]?.label ?? null }));
}

// ---------- Sorties : les habitants agissent selon leur caractère ----------

const OUT_HOUR = 9; // on part le matin
const BACK_HOUR = 18; // on rentre le soir

function outings(pop, state, rng, ctx, events) {
  const adults = present(pop).filter((p) => p.age >= ADULT && p.metier !== 'ancien' && !(p.hurtUntil > ctx.day));
  // L'audacieux va prêter main-forte là où les monstres menacent les champs.
  const fronts = state.zones.filter((z) => z.isField)
    .flatMap((f) => neighbors(state, f).filter((n) => !n.isVillage && !n.isField && !n.closed && n.monsterPressure >= 45))
    .sort((a, b) => b.monsterPressure - a.monsterPressure);
  for (const p of adults.filter((a) => a.traits.includes('audacieux') && !a.outing)) {
    if (!fronts.length || !rng.chance(0.35)) continue;
    const z = fronts[0];
    p.outing = { zone: z.id, kind: 'defense' };
    z.today.fights += 1;
    z.today.fighters.push(p.prenom);
    // Seul face à une zone infestée, on revient blessé : quelques jours de repos, rien de plus.
    if (z.monsterPressure >= 75 && rng.chance(0.4)) {
      p.hurtUntil = ctx.day + 2;
      events.push(ctx.event('villager_hurt', z, { who: p.prenom, label: z.label, fix: 'groupe' }));
    } else {
      fame(p, 2);
      events.push(ctx.event('villager_defense', z, { who: [p.prenom], label: z.label }));
    }
  }
  // Le curieux part explorer les terres lointaines, et en rapporte parfois une ressource rare.
  const far = state.zones.filter((z) => !z.closed && z.dist >= 3 && z.dist <= 5);
  for (const p of adults.filter((a) => a.traits.includes('curieux') && !a.outing)) {
    // Un voyageur égaré : le curieux part à sa recherche, et le ramène parfois.
    if (pop.lost && !state.zones[pop.lost.zone].closed && rng.chance(0.3)) {
      const z = state.zones[pop.lost.zone];
      p.outing = { zone: z.id, kind: 'exploration' };
      z.today.visits += 1;
      if (rng.chance(0.5)) welcome(pop, state, rng, [p.prenom], ctx, events);
      continue;
    }
    if (!far.length || !rng.chance(0.15)) continue;
    const z = rng.pick(far);
    p.outing = { zone: z.id, kind: 'exploration' };
    z.today.visits += 1;
    const rare = state.signature.exclusives.find((r) => z.resources[r] > 0);
    if (rare && rng.chance(0.4)) {
      pop.rares[rare] = (pop.rares[rare] ?? 0) + 1;
      fame(p, 4);
      events.push(ctx.event('villager_found', z, { who: p.prenom, label: z.label, materiau: rare }));
    } else {
      events.push(ctx.event('villager_explore', z, { who: p.prenom, label: z.label }));
    }
  }
  goToWork(pop, state, rng, adults.filter((p) => p.metier !== 'garde'));
}

// ---------- Travail hors du village ----------

// Chacun part travailler là où son métier l'appelle, si l'endroit n'est pas trop dangereux :
// champs pour l'agriculteur, bois et mine pour le bûcheron-mineur, pâtures pour l'éleveur.
// Le boulanger, le forgeron et l'enseignant travaillent au village.
const WORK_LIMIT = 45;
const WORK_WEAR = 3; // usure du chemin par travailleur et par jour : un lieu fréquenté garde son chemin
const MAX_OUTPOSTS = 4;
const OUTPOST_WOOD = 12;
const OUTPOST_GAP = 4; // jours entre deux avant-postes

function workLimit(p, z) {
  let limit = WORK_LIMIT;
  if (p.traits.includes('prudent')) limit -= 15;
  if (p.traits.includes('audacieux')) limit += 15;
  if (standing(z, OUTPOST)) limit += 25; // un avant-poste permet de travailler plus loin
  if (standing(z, 'tour de guet')) limit += 10;
  if (z.today.guards) limit += 15; // escortés par un garde
  return limit;
}

function workplaces(state, job) {
  const open = state.zones.filter((z) => !z.isVillage && !z.faubourg && !z.closed);
  switch (job) {
    case 'agriculteur': return open.filter((z) => z.isField);
    case 'bucheron_mineur': return open.filter((z) => !z.isField && z.dist <= 4 && (z.biome === 'foret' || (z.resources.minerai ?? 0) > 0));
    case 'eleveur': return open.filter((z) => !z.isField && z.dist <= 3 && (z.biome === 'plaine' || z.biome === 'colline'));
    default: return [];
  }
}

// Les gardes patrouillent là où la menace pèse le plus : devant les champs, là où l'on travaille.
const GUARD_RANGE = 3;
function patrol(pop, state, rng, ctx, events) {
  const guards = present(pop).filter((p) => p.metier === 'garde' && !p.outing && !(p.hurtUntil > ctx.day));
  if (!guards.length) return;
  // Priorité aux lieux de travail (pour y escorter les habitants) et aux abords des champs ; une zone
  // trop infestée pour un garde seul compte moins.
  const fronts = new Set(state.zones.filter((z) => z.isField).flatMap((f) => neighbors(state, f)).map((z) => z.id));
  const work = new Set(['bucheron_mineur', 'eleveur'].flatMap((job) => workplaces(state, job)).map((z) => z.id));
  const zones = state.zones.filter((z) => !z.isVillage && !z.closed && z.dist <= GUARD_RANGE && z.monsterPressure >= 20)
    .map((z) => [z, Math.min(z.monsterPressure, 70) + (work.has(z.id) ? 25 : 0) + (z.isField || fronts.has(z.id) ? 15 : 0)
      + (standing(z, OUTPOST) ? 10 : 0) - z.dist * 5])
    .sort((a, b) => b[1] - a[1] || a[0].id - b[0].id);
  const done = [];
  for (const g of guards) {
    const next = zones.shift();
    if (!next) break;
    const z = next[0];
    g.outing = { zone: z.id, kind: 'garde' };
    z.today.fights += g.talent ? 2 : 1;
    z.today.fighters.push(g.prenom);
    z.today.guards = (z.today.guards ?? 0) + 1;
    if (z.monsterPressure >= 80 && rng.chance(0.25)) {
      g.hurtUntil = ctx.day + 2;
      events.push(ctx.event('villager_hurt', z, { who: g.prenom, label: z.label, fix: 'groupe' }));
    } else done.push([g.prenom, z.label]);
  }
  // La chronique ne le dit que quand la garde change de terrain.
  const labels = [...new Set(done.map((d) => d[1]))];
  const key = labels.join('|');
  if (done.length && key !== pop.lastPatrol) events.push(ctx.event('guard_patrol', null, { who: done.map((d) => d[0]), labels }));
  pop.lastPatrol = key;
}

function goToWork(pop, state, rng, adults) {
  const places = {};
  for (const p of adults) {
    if (p.outing) continue;
    places[p.metier] ??= workplaces(state, p.metier);
    // Les plus proches d'abord, avec un peu de hasard ; un avant-poste attire du monde.
    const ok = places[p.metier].filter((z) => z.monsterPressure < workLimit(p, z));
    if (!ok.length || !rng.chance(0.85)) continue;
    const score = (z) => z.dist + (standing(z, OUTPOST) ? -1.5 : 0) + rng.next() * 2;
    const z = ok.map((zone) => [zone, score(zone)]).sort((a, b) => a[1] - b[1])[0][0];
    p.outing = { zone: z.id, kind: 'travail' };
    z.today.workers = (z.today.workers ?? 0) + 1;
    z.pathWear = clamp(z.pathWear + WORK_WEAR);
    // On entretient ce qui est bâti là où l'on travaille.
    for (const st of z.structures) if (!st.protected && !st.building && st.condition >= 25) st.maintainedDay = state.day;
  }
}

// Là où plusieurs habitants travaillent, ils bâtissent un avant-poste avec le bois du village.
function outposts(pop, state, rng, ctx, events) {
  const wood = state.village.jobs.bucheron_mineur.stock;
  if ((wood.bois ?? 0) < OUTPOST_WOOD + 5) return;
  if (ctx.day - (pop.outpostDay ?? -99) < OUTPOST_GAP) return;
  if (state.zones.filter((z) => z.structures.some((st) => st.type === OUTPOST)).length >= MAX_OUTPOSTS) return;
  const site = state.zones
    .filter((z) => !z.isField && !z.isVillage && !z.closed && ((z.today.workers ?? 0) + (z.today.guards ?? 0)) >= 1 && z.monsterPressure < 55
      && !z.structures.some((st) => st.type === OUTPOST))
    .sort((a, b) => b.today.workers - a.today.workers || b.dist - a.dist || a.id - b.id)[0];
  if (!site || !rng.chance(0.5)) return;
  const team = living(pop).filter((p) => p.outing?.zone === site.id || (p.lastWork === site.id)).map((p) => p.prenom).slice(0, 3);
  wood.bois -= OUTPOST_WOOD;
  pop.outpostDay = ctx.day;
  site.structures.push({ type: OUTPOST, condition: 80, warned: null, maintainedDay: ctx.day });
  events.push(ctx.event('outpost_built', site, { who: team, label: site.label, dist: site.dist }));
}

// Une année de vie : vieillir, apprendre, grandir, s'unir, naître, s'éteindre.
function year(pop, state, prng, ctx, events) {
  for (const p of living(pop)) if (!p.hero) p.age += 1; // un personnage de joueur ne vieillit pas
  learn(pop, state);
  comeOfAge(pop, state, prng, ctx, events);
  retireAndDie(pop, state, prng, ctx, events);
  formCouples(pop, prng, ctx, events);
  births(pop, state, prng, ctx, events);
}

export function population(state, rng, ctx) {
  const pop = state.village.population;
  if (!pop) return [];
  const morning = ctx.hour === OUT_HOUR;
  const evening = ctx.hour === BACK_HOUR;
  if (!ctx.dayEnd && !morning && !evening) return [];
  const prng = createRng(pop.rng);
  const events = [];
  pop.day = ctx.day;
  for (const p of pop.people) p.skills.armes ??= 10; // contrées créées avant les gardes
  if (morning) {
    patrol(pop, state, prng, ctx, events);
    outings(pop, state, prng, ctx, events);
  }
  if (evening) {
    for (const p of pop.people) {
      if (p.outing?.kind === 'travail') p.lastWork = p.outing.zone;
      p.outing = null;
    }
  }
  if (ctx.dayEnd) {
    // Le rythme de vie : une année par jour par défaut, moins si l'on veut des générations plus longues.
    pop.yearClock = (pop.yearClock ?? 0) + (pop.yearsPerDay ?? 1);
    while (pop.yearClock >= 1) {
      pop.yearClock -= 1;
      year(pop, state, prng, ctx, events);
    }
    hierarchy(pop, state, ctx, events);
    build(pop, state, ctx, events);
    abandon(pop, state, prng, ctx, events);
    immigration(pop, state, prng, ctx, events);
    forestier(pop, state, prng, ctx, events);
    clearing(pop, state, prng, ctx, events);
    outposts(pop, state, prng, ctx, events);
    wanderers(pop, state, prng, ctx, events);
    invent(pop, state, prng, ctx, events);
    rumor(pop, state, prng, ctx, events);
    // Les talents se révèlent aussi chez les adultes qui ont beaucoup appris.
    for (const p of living(pop)) if (!p.talent && p.age >= ADULT) p.talent = talentFor(p);
  }
  pop.rng = prng.save();
  return events;
}
