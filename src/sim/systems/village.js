// Village : quatre métiers en chaîne, des stocks, des besoins, des quêtes.
// agriculteur -> blé -> boulanger -> pain ; bûcheron-mineur -> minerai/charbon -> forgeron -> outils ;
// les outils retournent à l'agriculteur et au bûcheron-mineur.
import { clamp, neighbors } from '../world.js';

const HARVEST_THREAT = 55; // au-delà, un champ non protégé perd une partie de sa récolte
const QUEST_THREAT = 45; // au-delà, le village demande une patrouille
const NEGLECT_DAYS = 3; // jours de négligence avant de perdre un niveau
const BREAD_KEEPS = 30; // le pain ne se garde pas : au-delà, il rassit
const MAX_QUESTS = 4;
const QUEST_LIFETIME = 3;
const BREAD_PER_DAY = 10; // ce que mangent les villageois

const capacity = (job) => 6 + 3 * job.level;
const toolNeed = (job) => 1 + Math.floor(job.level / 2);

// Menace sur un champ : le champ lui-même et les terres sauvages qui le bordent.
export function fieldThreat(state, field) {
  let max = field.monsterPressure;
  for (const n of neighbors(state, field)) {
    if (!n.isVillage && !n.isField) max = Math.max(max, n.monsterPressure);
  }
  return max;
}

export function mineZone(state) {
  const mines = state.zones.filter((z) => z.resources.minerai > 0).sort((a, b) => a.dist - b.dist || a.id - b.id);
  return mines[0];
}

function take(stock, good, qty) {
  const got = Math.min(stock[good] ?? 0, Math.max(0, Math.round(qty)));
  stock[good] = (stock[good] ?? 0) - got;
  return got;
}

function add(stock, good, qty) {
  stock[good] = clamp((stock[good] ?? 0) + qty);
}

// ---------- Quêtes ----------

function openQuest(state, ctx, quest, events) {
  const v = state.village;
  if (v.quests.length >= MAX_QUESTS) return;
  if (v.quests.some((q) => q.kind === quest.kind && q.zone === quest.zone && q.job === quest.job)) return;
  const q = { id: v.nextQuestId++, created: ctx.day, ...quest };
  v.quests.push(q);
  events.push(ctx.event('quest_open', q.zone ?? null, { kind: q.kind, job: q.job ?? null, label: q.label ?? null, structure: q.structure ?? null }));
}

function generateQuests(state, ctx) {
  const events = [];
  const v = state.village;
  v.quests = v.quests.filter((q) => ctx.day - q.created < QUEST_LIFETIME);

  for (const f of state.zones.filter((z) => z.isField)) {
    if (fieldThreat(state, f) >= QUEST_THREAT) {
      openQuest(state, ctx, { kind: 'patrouille', job: 'agriculteur', zone: f.id, label: f.label }, events);
    }
  }
  const mine = mineZone(state);
  if (mine && mine.monsterPressure >= 50 && !mine.closed) {
    openQuest(state, ctx, { kind: 'escorte', job: 'bucheron_mineur', zone: mine.id, label: mine.label }, events);
  }
  for (const z of state.zones) {
    for (const s of z.structures) {
      if (!s.protected && s.condition < 50) {
        openQuest(state, ctx, { kind: 'reparer', zone: z.id, label: z.label, structure: s.type }, events);
      }
    }
  }
  // Toujours au moins un coup de main à donner au métier le moins bien loti.
  const jobs = Object.entries(v.jobs).sort((a, b) => a[1].satisfaction - b[1].satisfaction);
  openQuest(state, ctx, { kind: 'aide', job: jobs[0][0] }, events);
  return events;
}

// ---------- Production quotidienne ----------

function produce(state, rng, ctx) {
  const events = [];
  const { jobs } = state.village;
  const growth = state.season?.growth ?? 1;
  const ratio = {}; // part des besoins satisfaits, par métier
  const short = {}; // pénuries du jour, par métier

  const tools = jobs.forgeron.stock;

  // Agriculteur : récolte répartie sur les champs ; un champ menacé et non gardé perd 20 à 50 %.
  {
    const job = jobs.agriculteur;
    const toolsGot = take(tools, 'outils', toolNeed(job));
    job.needs = { outils: toolNeed(job) };
    const toolFactor = toolsGot >= toolNeed(job) ? 1 : 0.5;
    const fields = state.zones.filter((z) => z.isField);
    let harvest = 0;
    for (const f of fields) {
      f.pathWear = Math.max(f.pathWear, 50); // les paysans entretiennent le chemin des champs
      let share = (capacity(job) * growth * toolFactor) / fields.length;
      const threat = fieldThreat(state, f);
      if (threat >= HARVEST_THREAT && f.today.visits === 0 && share > 0) {
        const lossPct = rng.int(20, 50);
        share *= 1 - lossPct / 100;
        events.push(ctx.event('harvest_loss', f, { label: f.label, lossPct, threat, fix: 'patrouiller' }));
      }
      harvest += share;
    }
    add(job.stock, 'ble', Math.round(harvest));
    ratio.agriculteur = harvest / (capacity(job) * Math.max(growth, 0.01));
    short.agriculteur = toolFactor < 1 ? { good: 'outils', fix: 'forge' } : null;
  }

  // Boulanger : transforme le blé en pain.
  {
    const job = jobs.boulanger;
    const need = capacity(job);
    job.needs = { ble: need };
    const got = take(jobs.agriculteur.stock, 'ble', need);
    add(job.stock, 'pain', got);
    job.stock.pain = Math.min(job.stock.pain, BREAD_KEEPS);
    ratio.boulanger = got / need;
    short.boulanger = got < need * 0.8 ? { good: 'ble', got, need, fix: 'champs' } : null;
  }

  // Bûcheron-mineur : minerai, charbon et bois ; la mine doit être sûre et ouverte.
  {
    const job = jobs.bucheron_mineur;
    const toolsGot = take(tools, 'outils', toolNeed(job));
    job.needs = { outils: toolNeed(job) };
    const toolFactor = toolsGot >= toolNeed(job) ? 1 : 0.5;
    const mine = mineZone(state);
    let access = 1;
    let reason = null;
    if (mine.closed) { access = 0.3; reason = 'fermee'; }
    else if (mine.monsterPressure >= 70 && mine.today.visits === 0) { access = 0.5; reason = 'monstres'; }
    const wasUnsafe = state.village.mineUnsafe ?? null;
    if (reason !== wasUnsafe) {
      state.village.mineUnsafe = reason;
      if (reason) events.push(ctx.event('mine_unsafe', mine, { label: mine.label, reason, fix: reason === 'monstres' ? 'escorte' : 'printemps' }));
      else events.push(ctx.event('mine_safe', mine, { label: mine.label }));
    }
    const part = (capacity(job) / 2) * toolFactor * access;
    add(job.stock, 'minerai', Math.round(part));
    add(job.stock, 'charbon', Math.round(part));
    add(job.stock, 'bois', Math.round(part * 0.6));
    ratio.bucheron_mineur = Math.min(toolFactor, access);
    short.bucheron_mineur = toolFactor < 1 ? { good: 'outils', fix: 'forge' } : null;
  }

  // Forgeron : minerai + charbon -> outils.
  {
    const job = jobs.forgeron;
    const need = Math.ceil(capacity(job) / 2);
    job.needs = { minerai: need, charbon: need };
    const m = take(jobs.bucheron_mineur.stock, 'minerai', need);
    const c = take(jobs.bucheron_mineur.stock, 'charbon', need);
    const made = Math.min(m, c);
    // Ce qui n'a pas servi retourne au stock.
    add(jobs.bucheron_mineur.stock, 'minerai', m - made);
    add(jobs.bucheron_mineur.stock, 'charbon', c - made);
    add(job.stock, 'outils', made);
    ratio.forgeron = made / need;
    short.forgeron = made < need * 0.8 ? { good: 'minerai', got: made, need, fix: 'mine' } : null;
  }

  // Une pénurie n'est annoncée qu'au début, puis à sa fin.
  for (const [name, info] of Object.entries(short)) {
    const job = jobs[name];
    if (info && !job.shortOf) events.push(ctx.event('shortage', null, { job: name, ...info }));
    if (!info && job.shortOf) events.push(ctx.event('shortage_end', null, { job: name, good: job.shortOf }));
    job.shortOf = info ? info.good : null;
  }

  // Les villageois mangent.
  const eaten = take(jobs.boulanger.stock, 'pain', BREAD_PER_DAY);
  const hungry = eaten < BREAD_PER_DAY;
  if (hungry && !state.village.hungry) events.push(ctx.event('bread_shortage', null, { fix: 'champs' }));
  if (!hungry && state.village.hungry) events.push(ctx.event('bread_back', null, {}));
  state.village.hungry = hungry;

  return { events, ratio, hungry };
}

// ---------- Satisfaction et niveaux ----------

function evolve(state, ctx, ratio, hungry) {
  const events = [];
  for (const [name, job] of Object.entries(state.village.jobs)) {
    const helped = job.helpedDay === ctx.day;
    const target = 100 * Math.min(1, ratio[name]) - 10 - (hungry ? 15 : 0) + (helped ? 20 : 0);
    job.satisfaction = clamp(job.satisfaction + (target - job.satisfaction) * 0.5);

    // Déclin lent : plusieurs jours de négligence font perdre un niveau, jamais sous 1.
    if (job.satisfaction < 45) job.neglect += 1;
    else job.neglect = Math.max(0, job.neglect - 1);
    if (job.neglect >= NEGLECT_DAYS) {
      job.neglect = 0;
      job.progress = 0;
      if (job.level > 1) {
        job.level -= 1;
        events.push(ctx.event('level_down', null, { job: name, level: job.level, needs: Object.keys(job.needs), fix: 'besoins' }));
      }
    }

    // Reprise rapide : 1 jour d'aide pour regagner un niveau perdu, 2 pour un nouveau niveau.
    if (helped && job.satisfaction >= 55) job.progress += 1;
    const required = job.level < job.maxLevel ? 1 : 2;
    if (job.progress >= required && job.level < 5) {
      job.level += 1;
      job.progress = 0;
      const regained = job.level <= job.maxLevel;
      job.maxLevel = Math.max(job.maxLevel, job.level);
      events.push(ctx.event('level_up', null, { job: name, level: job.level, regained }));
    }
  }
  return events;
}

export function village(state, rng, ctx) {
  if (ctx.dayStart) return generateQuests(state, ctx);
  if (!ctx.dayEnd) return [];
  const { events, ratio, hungry } = produce(state, rng, ctx);
  events.push(...evolve(state, ctx, ratio, hungry));
  const jobs = state.village.jobs;
  events.push(ctx.event('village_status', null, {
    levels: Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, j.level])),
    satisfaction: Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, j.satisfaction])),
    pain: jobs.boulanger.stock.pain,
    ble: jobs.agriculteur.stock.ble,
    outils: jobs.forgeron.stock.outils,
  }));
  return events;
}
