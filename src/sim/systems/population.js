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
import { clamp, neighbors, zoneLabel } from '../world.js';

export const ADULT = 16;
export const ELDER = 62;
export const SKILLS = ['culture', 'cuisine', 'forge', 'bois', 'elevage', 'savoir'];
export const JOB_SKILL = {
  agriculteur: 'culture', boulanger: 'cuisine', forgeron: 'forge', bucheron_mineur: 'bois', eleveur: 'elevage', enseignant: 'savoir',
};
export const TRAITS = ['travailleur', 'curieux', 'bavard', 'prudent', 'audacieux', 'rêveur', 'têtu', 'patient'];
// Un métier bien appris + du savoir = un talent.
export const TALENTS = {
  bucheron_mineur: 'forestier', agriculteur: 'agronome', forgeron: 'inventeur', eleveur: 'bouvier', boulanger: 'maître des levains', enseignant: 'érudit',
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
const byId = (pop, id) => pop.people.find((p) => p.id === id);
export const fullName = (p) => `${p.prenom} ${p.famille}`;

export function workers(pop, job) {
  return living(pop).filter((p) => p.metier === job);
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
    sum += v;
  }
  let factor = 0.6 + 0.4 * sum;
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
    if (a.partner || a.age < 18 || a.age > 50 || !rng.chance(0.15)) continue;
    const others = living(pop).filter((b) => b !== a && !b.partner && b.age >= 18 && b.age <= 50 && Math.abs(a.age - b.age) <= 10 && !related(a, b));
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
    // Au plus un enfant tous les deux ans par couple.
    if (a.lastChild != null && a.age - a.lastChild < 2) continue;
    if (!rng.chance(0.2)) continue;
    a.lastChild = a.age;
    // Chaque enfant hérite un peu des dons de ses deux parents, et d'un trait de chacun.
    const skills = {};
    for (const k of SKILLS) skills[k] = clamp(Math.round((a.skills[k] + b.skills[k]) * 0.15 + Math.max(a.skills[k], b.skills[k]) * 0.2 + rng.int(0, 6)));
    const traits = [rng.chance(0.7) ? rng.pick(a.traits) : rng.pick(TRAITS)];
    let t2 = rng.chance(0.7) ? rng.pick(b.traits) : rng.pick(TRAITS);
    if (t2 === traits[0]) t2 = TRAITS.find((t) => t !== traits[0]);
    traits.push(t2);
    const child = makePerson(pop, rng, { famille: a.famille, age: 0, skills, traits, parents: [a.id, b.id] });
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
      events.push(ctx.event('replant', thin, { who: p.prenom, label: thin.label }));
      continue;
    }
    // Choisir les arbres à abattre pour ouvrir un passage vers les terres lointaines.
    // Un même passage n'est rouvert qu'au bout de dix jours.
    const target = forests.filter((z) => z.pathWear < 40 && z.dist >= 2 && ctx.day - (z.passageDay ?? -99) >= 10).sort((a, b) => a.dist - b.dist)[0];
    if (target) {
      target.pathWear = clamp(target.pathWear + 35);
      target.passageDay = ctx.day;
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
  const candidates = state.zones.filter((z) => !z.isField && !z.isVillage && !z.closed && z.biome === 'plaine'
    && z.dist <= 2 && z.monsterPressure < 30 && z.structures.length === 0
    && neighbors(state, z).some((n) => n.isField && (n.x === z.x || n.y === z.y)));
  if (!candidates.length) return;
  const z = candidates.sort((a, b) => a.monsterPressure - b.monsterPressure || a.id - b.id)[0];
  z.isField = true;
  z.resources.ble = 80;
  z.label = zoneLabel(z);
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
  const adults = living(pop).filter((p) => p.age >= ADULT && p.metier !== 'ancien' && !(p.hurtUntil > ctx.day));
  // L'audacieux va prêter main-forte là où les monstres menacent les champs.
  const fronts = state.zones.filter((z) => z.isField)
    .flatMap((f) => neighbors(state, f).filter((n) => !n.isVillage && !n.isField && !n.closed && n.monsterPressure >= 45))
    .sort((a, b) => b.monsterPressure - a.monsterPressure);
  for (const p of adults.filter((a) => a.traits.includes('audacieux'))) {
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
      events.push(ctx.event('villager_defense', z, { who: [p.prenom], label: z.label }));
    }
  }
  // Le curieux part explorer les terres lointaines, et en rapporte parfois une ressource rare.
  const far = state.zones.filter((z) => !z.closed && z.dist >= 3 && z.dist <= 5);
  for (const p of adults.filter((a) => a.traits.includes('curieux') && !a.outing)) {
    if (!far.length || !rng.chance(0.15)) continue;
    const z = rng.pick(far);
    p.outing = { zone: z.id, kind: 'exploration' };
    z.today.visits += 1;
    const rare = state.signature.exclusives.find((r) => z.resources[r] > 0);
    if (rare && rng.chance(0.4)) {
      pop.rares[rare] = (pop.rares[rare] ?? 0) + 1;
      events.push(ctx.event('villager_found', z, { who: p.prenom, label: z.label, materiau: rare }));
    } else {
      events.push(ctx.event('villager_explore', z, { who: p.prenom, label: z.label }));
    }
  }
}

// Une année de vie : vieillir, apprendre, grandir, s'unir, naître, s'éteindre.
function year(pop, state, prng, ctx, events) {
  for (const p of living(pop)) p.age += 1;
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
  if (morning) outings(pop, state, prng, ctx, events);
  if (evening) for (const p of pop.people) p.outing = null;
  if (ctx.dayEnd) {
    // Le rythme de vie : une année par jour par défaut, moins si l'on veut des générations plus longues.
    pop.yearClock = (pop.yearClock ?? 0) + (pop.yearsPerDay ?? 1);
    while (pop.yearClock >= 1) {
      pop.yearClock -= 1;
      year(pop, state, prng, ctx, events);
    }
    build(pop, state, ctx, events);
    immigration(pop, state, prng, ctx, events);
    forestier(pop, state, prng, ctx, events);
    clearing(pop, state, prng, ctx, events);
    invent(pop, state, prng, ctx, events);
    rumor(pop, state, prng, ctx, events);
    // Les talents se révèlent aussi chez les adultes qui ont beaucoup appris.
    for (const p of living(pop)) if (!p.talent && p.age >= ADULT) p.talent = talentFor(p);
  }
  pop.rng = prng.save();
  return events;
}
