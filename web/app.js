// Page de visualisation : lance la simulation dans le navigateur (même code que la CLI),
// garde un instantané de chaque fin de journée et affiche carte, village, courbes et chronique.
import { createRng } from '../src/sim/rng.js';
import { createWorld } from '../src/sim/world.js';
import { simulate } from '../src/sim/tick.js';
import { addPlayers, agentsAct } from '../src/sim/agents.js';
import { formatChronicle, dayLines } from '../src/chronicle/chronicle.js';
import { el, cssVar } from './ui.js';
import { drawMap, drawMapLegend } from './map.js';
import { drawLineChart, drawLegend } from './charts.js';

const JOBS = [
  { key: 'agriculteur', label: 'Agriculteur', good: 'ble', goodLabel: 'blé', color: '--series-1' },
  { key: 'boulanger', label: 'Boulanger', good: 'pain', goodLabel: 'pain', color: '--series-2' },
  { key: 'forgeron', label: 'Forgeron', good: 'outils', goodLabel: 'outils', color: '--series-3' },
  { key: 'bucheron_mineur', label: 'Bûcheron-mineur', good: 'minerai', goodLabel: 'minerai', color: '--series-4' },
];
const RANK = ['', 'apprenti', 'compagnon', 'artisan confirmé', 'maître', 'grand maître'];
const BANDS = [
  { label: 'Abords (1–2)', min: 1, max: 2, color: '--band-near' },
  { label: 'Entre-deux (3–4)', min: 3, max: 4, color: '--band-mid' },
  { label: 'Confins (5–6)', min: 5, max: 6, color: '--band-far' },
];
// Ce que chaque type d'event dit de l'activité d'un joueur dans une zone.
const ACTION = {
  zone_cleared: 'nettoyage', monsters_pushed: 'combat', retreat: 'retraite', hunt: 'chasse',
  exploration: 'exploration', discovery: 'découverte', construction_started: 'construction', structure_built: 'construction',
};
const QUEST_ACTION = { patrouille: 'garde', escorte: 'escorte', reparer: 'réparation' };

const $ = (id) => document.getElementById(id);
const form = $('f');
const view = { data: null, day: 1, layer: 'monstres', timer: null };

// ---------- Simulation ----------

function snapshot(state) {
  return {
    season: state.season.name,
    weather: state.season.weather,
    zones: state.zones.map((z) => ({
      p: z.monsterPressure, w: z.pathWear, v: z.vegetation, c: z.closed,
      s: z.structures.filter((s) => !s.protected).map((s) => ({ t: s.type, c: s.condition, b: !!s.building })),
    })),
    jobs: Object.fromEntries(Object.entries(state.village.jobs).map(([k, j]) => [k, { level: j.level, sat: j.satisfaction, stock: { ...j.stock } }])),
  };
}

function runSimulation({ seed, days, agents }) {
  const world = createWorld(seed);
  const rng = createRng(seed);
  addPlayers(world, rng, agents);
  const static_ = {
    width: world.width,
    height: world.height,
    zones: world.zones.map((z) => ({
      id: z.id, x: z.x, y: z.y, dist: z.dist, biome: z.biome, label: z.label, isVillage: z.isVillage, isField: z.isField,
      exclusives: world.signature.exclusives.filter((r) => z.resources[r] > 0),
    })),
  };
  const snaps = [];
  const { events } = simulate(world, rng, { days, beforeTick: agentsAct, onDayEnd: (s) => snaps.push(snapshot(s)) });

  // Activité des joueurs par jour et par zone, tirée des events.
  const activity = Array.from({ length: days }, () => new Map());
  for (const e of events) {
    if (e.zone == null || !e.data.who) continue;
    const what = e.type === 'quest_done' ? QUEST_ACTION[e.data.kind] : ACTION[e.type];
    if (!what) continue;
    const m = activity[e.day - 1];
    if (!m) continue;
    if (!m.has(e.zone)) m.set(e.zone, []);
    for (const who of e.data.who) {
      if (!m.get(e.zone).some((a) => a.who === who && a.what === what)) m.get(e.zone).push({ who, what });
    }
  }

  const bands = BANDS.map((b) => snaps.map((s) => {
    const zs = static_.zones.filter((z) => !z.isVillage && z.dist >= b.min && z.dist <= b.max);
    return Math.round(zs.reduce((sum, z) => sum + s.zones[z.id].p, 0) / zs.length);
  }));
  return { world: static_, snaps, events, activity, bands, days };
}

// ---------- Rendu ----------

function renderMarkdown(container, md) {
  container.replaceChildren();
  let list = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) {
      if (!list) list = el('ul', {}, container);
      el('li', {}, list, line.slice(2));
      continue;
    }
    list = null;
    if (line.startsWith('## ')) {
      const h = el('h2', {}, container, line.slice(3));
      const m = line.match(/^## Jour (\d+)/);
      if (m) h.dataset.day = m[1];
    } else if (line.startsWith('# ')) el('h1', {}, container, line.slice(2));
    else if (line.trim()) el('p', {}, container, line);
  }
}

function renderVillage(d) {
  const { snaps } = view.data;
  const now = snaps[d - 1].jobs;
  const before = d > 1 ? snaps[d - 2].jobs : null;
  const box = $('village');
  box.replaceChildren();
  const list = el('div', { class: 'jobs' }, box);
  for (const j of JOBS) {
    const s = now[j.key];
    const row = el('div', { class: 'job' }, list);
    el('span', { class: 'key', style: `background:var(${j.color})` }, row);
    const name = el('span', { class: 'name' }, row, `${j.label} `);
    el('span', { class: 'rank' }, name, RANK[s.level]);
    const pips = el('span', { class: 'pips', title: `niveau ${s.level} sur 5` }, row);
    for (let i = 1; i <= 5; i++) el('span', { class: `pip${i <= s.level ? ' on' : ''}` }, pips);

    const meter = el('div', { class: 'meter' }, row);
    const track = el('div', { class: 'track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': s.sat, 'aria-label': `Satisfaction ${j.label}` }, meter);
    el('div', { class: `fill${s.sat < 45 ? ' low' : ''}`, style: `width:${s.sat}%` }, track);
    const info = el('span', {}, meter);
    info.appendChild(document.createTextNode(`satisfaction ${s.sat}${s.sat < 45 ? ' (fragile)' : ''} · ${j.goodLabel} ${s.stock[j.good] ?? 0}`));
    if (before) {
      const delta = (s.stock[j.good] ?? 0) - (before[j.key].stock[j.good] ?? 0);
      if (delta) el('span', { class: delta > 0 ? 'delta-up' : 'delta-down' }, info, ` ${delta > 0 ? '▲ +' : '▼ '}${delta}`);
    }
  }
}

function renderDay() {
  const { snaps, events, activity, world, days } = view.data;
  const d = view.day;
  const snap = snaps[d - 1];
  $('day-title').textContent = `Jour ${d}`;
  $('day-sub').textContent = `${snap.season} · ${snap.weather}`;
  $('slider').value = d;
  $('prev').disabled = d <= 1;
  $('next').disabled = d >= days;

  drawMap($('map'), world, snap, activity[d - 1], view.layer);
  drawMapLegend($('map-legend'), view.layer);
  renderVillage(d);

  const list = $('day-lines');
  list.replaceChildren();
  const lines = dayLines(events, d, { debug: form.elements.debug.checked });
  for (const l of lines.length ? lines : ['Journée calme dans la contrée.']) el('li', {}, list, l);

  for (const h of document.querySelectorAll('#out h2[data-day]')) h.classList.toggle('current', Number(h.dataset.day) === d);
  renderCharts();
  updateUrl();
}

function renderCharts() {
  const { bands, snaps } = view.data;
  const pressure = BANDS.map((b, i) => ({ label: b.label, color: cssVar(b.color), values: bands[i] }));
  const jobs = JOBS.map((j) => ({ label: j.label, color: cssVar(j.color), values: snaps.map((s) => s.jobs[j.key].sat) }));
  drawLegend($('legend-pressure'), pressure);
  drawLegend($('legend-jobs'), jobs);
  drawLineChart($('chart-pressure'), { series: pressure, selectedDay: view.day, onSelect: (d) => selectDay(d, $('chart-pressure')) });
  drawLineChart($('chart-jobs'), { series: jobs, selectedDay: view.day, onSelect: (d) => selectDay(d, $('chart-jobs')) });
}

function renderTable() {
  const { snaps, bands } = view.data;
  const table = $('table');
  table.replaceChildren();
  const head = el('tr', {}, el('thead', {}, table));
  for (const h of ['Jour', 'Saison', ...BANDS.map((b) => `Monstres ${b.label.toLowerCase()}`), ...JOBS.map((j) => `${j.label} (niveau · satisf.)`), 'Blé', 'Pain', 'Outils', 'Minerai']) {
    el('th', { scope: 'col' }, head, h);
  }
  const body = el('tbody', {}, table);
  snaps.forEach((s, i) => {
    const tr = el('tr', {}, body);
    el('td', {}, tr, String(i + 1));
    el('td', {}, tr, `${s.season}, ${s.weather}`);
    for (const b of bands) el('td', {}, tr, String(b[i]));
    for (const j of JOBS) el('td', {}, tr, `${s.jobs[j.key].level} · ${s.jobs[j.key].sat}`);
    el('td', {}, tr, String(s.jobs.agriculteur.stock.ble));
    el('td', {}, tr, String(s.jobs.boulanger.stock.pain));
    el('td', {}, tr, String(s.jobs.forgeron.stock.outils));
    el('td', {}, tr, String(s.jobs.bucheron_mineur.stock.minerai));
  });
}

function selectDay(d, refocus = null) {
  if (!view.data) return;
  view.day = Math.max(1, Math.min(view.data.days, d));
  renderDay();
  if (refocus) refocus.querySelector('[tabindex]')?.focus();
}

// ---------- Réglages, URL, lecture ----------

function params() {
  const data = new FormData(form);
  return {
    seed: Number(data.get('seed')) || 0,
    days: Math.max(1, Math.min(120, Number(data.get('days')) || 7)),
    agents: data.get('agents'),
    since: data.get('since') ? Number(data.get('since')) : null,
    debug: data.get('debug') === 'on',
  };
}

function updateUrl() {
  const p = params();
  const q = new URLSearchParams({ seed: p.seed, days: p.days, agents: p.agents, jour: view.day, calque: view.layer });
  if (p.since) q.set('since', p.since);
  if (p.debug) q.set('debug', 1);
  history.replaceState(null, '', `?${q}`);
}

function stopPlay() {
  clearInterval(view.timer);
  view.timer = null;
  $('play').textContent = '▶ Lecture';
}

function run(startDay = null) {
  stopPlay();
  const p = params();
  const t0 = performance.now();
  try {
    view.data = runSimulation(p);
  } catch (err) {
    $('out').replaceChildren(el('p', { class: 'error' }, null, String(err)));
    return;
  }
  const ms = Math.round(performance.now() - t0);
  $('meta').textContent = `Équivalent CLI : npm run sim -- --days ${p.days} --seed ${p.seed} --agents ${p.agents}${p.since ? ` --since ${p.since}` : ''}${p.debug ? ' --debug' : ''} · ${view.data.events.length} événements · ${ms} ms`;
  const c = view.data.events.find((e) => e.type === 'contree');
  const BIOME_TERRE = { foret: 'forêts', plaine: 'plaines', colline: 'collines', marais: 'marais', montagne: 'montagnes' };
  const box = $('contree');
  box.replaceChildren(el('strong', {}, null, c.data.name));
  box.appendChild(document.createTextNode(` — terre de ${BIOME_TERRE[c.data.biome]}, richesses propres : ${c.data.exclusives.join(', ')}.`));
  $('slider').max = p.days;
  renderMarkdown($('out'), formatChronicle(view.data.events, { debug: p.debug, since: p.since, days: p.days }));
  renderTable();
  view.day = Math.max(1, Math.min(p.days, startDay ?? p.since ?? 1));
  renderDay();
}

form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
$('slider').addEventListener('input', (e) => selectDay(Number(e.target.value)));
$('prev').addEventListener('click', () => selectDay(view.day - 1));
$('next').addEventListener('click', () => selectDay(view.day + 1));
$('play').addEventListener('click', () => {
  if (view.timer) return stopPlay();
  if (view.day >= view.data.days) selectDay(1);
  $('play').textContent = '⏸ Pause';
  view.timer = setInterval(() => {
    if (view.day >= view.data.days) return stopPlay();
    selectDay(view.day + 1);
  }, 900);
});
for (const b of document.querySelectorAll('.seg')) {
  b.addEventListener('click', () => {
    view.layer = b.dataset.layer;
    for (const o of document.querySelectorAll('.seg')) o.setAttribute('aria-pressed', String(o === b));
    renderDay();
  });
}
$('out').addEventListener('click', (e) => {
  const h = e.target.closest('h2[data-day]');
  if (!h) return;
  selectDay(Number(h.dataset.day));
  $('viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => view.data && renderCharts(), 150);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => view.data && renderDay());

// Les paramètres de l'URL permettent de partager une vue précise.
const q = new URLSearchParams(location.search);
for (const k of ['seed', 'days', 'agents', 'since']) if (q.has(k)) form.elements[k].value = q.get(k);
if (q.has('debug')) form.elements.debug.checked = true;
if (['monstres', 'chemins', 'terrain'].includes(q.get('calque'))) {
  view.layer = q.get('calque');
  for (const o of document.querySelectorAll('.seg')) o.setAttribute('aria-pressed', String(o.dataset.layer === view.layer));
}
run(q.has('jour') ? Number(q.get('jour')) : null);
