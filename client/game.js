// Client du jeu : connexion Colyseus, clavier/tactile, prédiction du déplacement, interface.
// Le serveur fait autorité : le client prédit son propre mouvement pour qu'il soit fluide,
// puis se recale en douceur sur la position envoyée par le serveur.
import { ZONE_TILES, DASH_MS, DASH_FACTOR, BOOTS_FACTOR, stepPosition, zoneIndexAt } from './shared/monde.js';
import { buildZoneCanvases, drawWorld, drawMinimap, rareColor } from './render.js';
import { createAmbiance, updateAmbiance, drawAmbianceGround, drawAmbianceSky, nearestVillager } from './ambiance.js';
import { talk } from './dialogues.js';
import { buildTrees, renderTrees } from './shared/genealogie.js';

const $ = (id) => document.getElementById(id);
const canvas = $('jeu');
const ctx = canvas.getContext('2d');
const mini = $('minimap').getContext('2d');

const params = new URLSearchParams(location.search);
// Par défaut, le serveur est celui qui sert la page ; `?serveur=` permet d'en viser un autre.
const endpoint = params.get('serveur') || location.origin;

const game = {
  room: null,
  monde: null,
  zoneCanvases: null,
  me: { x: 0, y: 0 }, // position prédite du joueur local
  others: new Map(), // sessionId -> position affichée (interpolée)
  monsters: new Map(), // id -> position affichée et instants des coups
  input: { x: 0, y: 0 },
  sentInput: { x: 0, y: 0 },
  chroniques: [],
  lastZone: -1,
};

// ---------- Connexion ----------

function setNotice(text, isError = false) {
  const el = $('accueil-msg');
  el.textContent = text;
  el.classList.toggle('erreur', isError);
}

async function connect(nom) {
  if (typeof Colyseus === 'undefined') {
    setNotice('La bibliothèque réseau n\'a pas pu être chargée. La page doit être ouverte depuis le serveur du jeu (npm start).', true);
    return;
  }
  setNotice('Connexion…');
  try {
    const client = new Colyseus.Client(endpoint);
    game.room = await client.join('contree', { nom });
  } catch (err) {
    setNotice(`Impossible de rejoindre la contrée (${err.message || err}). Le serveur est-il lancé ? Dans un Codespace, le port 2567 doit être public.`, true);
    return;
  }
  const room = game.room;
  room.onMessage('monde', (monde) => {
    game.monde = monde;
    game.ambiance = createAmbiance(monde);
    game.zoneCanvases = buildZoneCanvases(monde);
  });
  room.onMessage('chronique', (jours) => {
    for (const j of jours) {
      game.chroniques = game.chroniques.filter((c) => c.jour !== j.jour);
      game.chroniques.push(j);
    }
    game.chroniques.sort((a, b) => b.jour - a.jour);
    renderSide();
    const latest = jours[jours.length - 1];
    if (jours.length === 1 && latest) toast(`Jour ${latest.jour} : ${latest.lignes[0]}`);
  });
  room.onMessage('bienvenue', (m) => {
    showMessage(`Bienvenue à ${m.contree}, ${m.nom}`, [], 'Une maison vous attend au village, au centre de la carte. Les champs qui l\'entourent nourrissent tout le monde : les monstres qui rôdent autour en dévorent une partie quand personne ne les garde.');
  });
  room.onMessage('absence', (m) => {
    showMessage(`Pendant votre absence (jours ${m.depuis} à ${m.jusqua})`, m.lignes, '');
  });
  room.onMessage('annonce', (text) => toast(text));
  room.onMessage('genealogie', (people) => {
    renderTrees($('arbre-contenu'), buildTrees(people));
  });
  room.onMessage('info', (text) => info(text));
  room.onLeave(() => {
    toast('Connexion perdue avec la contrée. Rechargez la page pour revenir.');
  });

  try { localStorage.setItem('contree.nom', nom); } catch { /* stockage indisponible */ }
  $('accueil').hidden = true;
  for (const id of ['hud', 'minimap', 'boutons', 'aide']) $(id).hidden = false;
  requestAnimationFrame(frame);
  setInterval(renderSide, 2000);
}

$('entrer').addEventListener('submit', (e) => {
  e.preventDefault();
  const nom = $('nom').value.trim();
  if (nom) connect(nom);
});
try { $('nom').value = localStorage.getItem('contree.nom') ?? ''; } catch { /* rien */ }

// ---------- Messages ----------

function showMessage(title, lines, text) {
  $('message-titre').textContent = title;
  const ul = $('message-lignes');
  ul.replaceChildren();
  for (const l of lines) {
    const li = document.createElement('li');
    li.textContent = l;
    ul.appendChild(li);
  }
  ul.hidden = lines.length === 0;
  $('message-texte').textContent = text;
  $('message').hidden = false;
}
$('message-ok').addEventListener('click', () => { $('message').hidden = true; $('message-ok').textContent = 'Reprendre'; });

let infoTimer = null;
function info(text) {
  const el = $('info');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => { el.hidden = true; }, 1400);
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// ---------- Entrées ----------

const keys = new Set();
const KEYMAP = {
  ArrowUp: 'haut', KeyW: 'haut', ArrowDown: 'bas', KeyS: 'bas',
  ArrowLeft: 'gauche', KeyA: 'gauche', ArrowRight: 'droite', KeyD: 'droite',
};
// KeyW/KeyA sont les touches physiques Z/Q sur un clavier AZERTY.

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || !game.room) return;
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === 'Space' || e.code === 'KeyJ') { attack(); e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyK') { interact(); e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyL') { dash(); e.preventDefault(); }
  if (e.code === 'KeyR') { eat(); e.preventDefault(); }
  if (e.code === 'KeyF' || e.code === 'KeyI') { toggleBag(); e.preventDefault(); }
  if (e.code === 'KeyG') { toggleTree(); e.preventDefault(); }
  if (e.code === 'KeyC') toggleSide();
  if (e.code === 'Escape') { $('message').hidden = true; for (const id of ['cote', 'sac', 'arbre']) $(id).classList.remove('ouvert'); }
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
window.addEventListener('blur', () => keys.clear());

// Tactile / souris : maintenir le doigt sur l'écran fait marcher dans cette direction.
let pointer = null;
canvas.addEventListener('pointerdown', (e) => { pointer = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (pointer) pointer = { x: e.clientX, y: e.clientY }; });
const stopPointer = () => { pointer = null; };
canvas.addEventListener('pointerup', stopPointer);
canvas.addEventListener('pointercancel', stopPointer);
$('attaque').addEventListener('pointerdown', (e) => { e.preventDefault(); attack(); });
$('agir').addEventListener('pointerdown', (e) => { e.preventDefault(); interact(); });
$('rouler').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(); });
$('manger').addEventListener('pointerdown', (e) => { e.preventDefault(); eat(); });

function readInput() {
  let x = 0;
  let y = 0;
  if (keys.has('gauche')) x -= 1;
  if (keys.has('droite')) x += 1;
  if (keys.has('haut')) y -= 1;
  if (keys.has('bas')) y += 1;
  if (pointer) {
    const dx = pointer.x - window.innerWidth / 2;
    const dy = pointer.y - window.innerHeight / 2;
    if (Math.hypot(dx, dy) > 20) {
      // 8 directions, comme au clavier.
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      x = Math.round(Math.cos(a));
      y = Math.round(Math.sin(a));
    }
  }
  return { x, y };
}

let lastAttackSent = 0;
function attack() {
  if (!game.room) return;
  const now = performance.now();
  if (now - lastAttackSent < 400) return;
  lastAttackSent = now;
  game.room.send('attaque');
}

// Roulade : prédite localement pour qu'elle parte sans délai, le serveur fait de même.
const FACE = { droite: [1, 0], gauche: [-1, 0], bas: [0, 1], haut: [0, -1] };
let lastDash = 0;
function dash() {
  const room = game.room;
  if (!room) return;
  const now = performance.now();
  if (now - lastDash < 1200) return;
  const me = room.state.joueurs.get(room.sessionId);
  if (!me || me.aTerre) return;
  lastDash = now;
  const input = readInput();
  const [fx, fy] = FACE[game.facing ?? me.dir] ?? [0, 1];
  game.dash = { until: now + DASH_MS, dir: input.x || input.y ? input : { x: fx, y: fy } };
  room.send('roulade');
}

let lastEat = 0;
function eat() {
  if (!game.room) return;
  const now = performance.now();
  if (now - lastEat < 500) return;
  lastEat = now;
  game.room.send('manger');
}

function talkTo(h) {
  const s = game.room.state;
  const d = talk(h, {
    habitants: [...(s.habitants ?? [])], quetes: [...(s.quetes ?? [])], pain: s.pain, saison: s.saison, rares: game.monde?.rares,
  });
  showMessage(d.titre, [], '');
  const ul = $('message-lignes');
  ul.hidden = false;
  for (const l of d.lignes) {
    const item = document.createElement('li');
    item.textContent = `« ${l} »`;
    ul.appendChild(item);
  }
  $('message-ok').textContent = 'Au revoir';
}

let lastInteractSent = 0;
function interact() {
  if (!game.room) return;
  // Près d'un habitant, E sert à lui parler.
  if (game.nearVillager) { talkTo(game.nearVillager); return; }
  const now = performance.now();
  if (now - lastInteractSent < 300) return;
  lastInteractSent = now;
  game.room.send('interagir');
}

// ---------- Interface ----------

const PRESSION = (p) => (p < 30 ? 'calme' : p < 50 ? 'agitée' : p < 70 ? 'menaçante' : 'infestée');
const RANK = ['', 'apprenti', 'compagnon', 'artisan confirmé', 'maître', 'grand maître'];
const METIERS = { agriculteur: 'Agriculteur', boulanger: 'Boulanger', forgeron: 'Forgeron', bucheron_mineur: 'Bûcheron-mineur' };

function statusWord(cond, building) {
  if (building) return 'en chantier';
  if (cond <= 0) return 'en ruine';
  if (cond < 25) return 'menace ruine';
  if (cond < 50) return 'abîmée';
  return 'en bon état';
}

function renderHud() {
  const s = game.room.state;
  const { monde } = game;
  $('quand').textContent = `Jour ${s.jour} · ${String(s.heure).padStart(2, '0')} h — ${s.saison}${s.meteo ? `, ${s.meteo}` : ''}`;
  const zi = zoneIndexAt(game.me.x, game.me.y, monde.largeur, monde.hauteur);
  const info = monde.zones[zi];
  const z = s.zones[zi];
  if (!info || !z) return;
  const label = info.village ? 'Le village' : info.label.charAt(0).toUpperCase() + info.label.slice(1);
  $('ou').textContent = label;
  $('danger-mot').textContent = info.village ? 'Zone sûre' : `Monstres : ${PRESSION(z.p)}`;
  $('jauge').style.width = `${info.village ? 0 : z.p}%`;
  const structs = (z.s || '').split(';').filter(Boolean).map((part) => {
    const [type, cond, b] = part.split('|');
    return `${type} (${statusWord(Number(cond), b === '1')})`;
  });
  $('structs').textContent = structs.join(' · ');

  const me = s.joueurs.get(game.room.sessionId);
  if (me) {
    const coeurs = $('coeurs');
    coeurs.replaceChildren();
    const plein = document.createElement('span');
    plein.textContent = '♥'.repeat(me.pv);
    const vide = document.createElement('span');
    vide.className = 'vide';
    vide.textContent = '♥'.repeat(Math.max(0, me.pvMax - me.pv));
    coeurs.append(plein, vide);
    coeurs.setAttribute('aria-label', `${me.pv} points de vie sur ${me.pvMax}`);
    const action = $('action');
    const near = game.nearVillager;
    const label = near ? `parler à ${near.prenom}` : me.action;
    action.hidden = !label;
    if (label && action.dataset.label !== label) {
      action.dataset.label = label;
      action.replaceChildren();
      const k = document.createElement('kbd');
      k.textContent = 'E';
      action.append(k, document.createTextNode(` ${label}`));
    }
    $('aterre').hidden = !me.aTerre;
  }
  $('bois').textContent = `🪵 ${s.bois} bois`;
  $('pain').textContent = `🍞 ${s.pain}`;
  if ($('sac').classList.contains('ouvert')) renderBag();
  const hq = $('hud-quetes');
  const quests = [...(s.quetes ?? [])].slice(0, 3);
  const qKey = quests.map((q) => `${q.id}:${q.progres}`).join('|');
  if (hq.dataset.key !== qKey) {
    hq.dataset.key = qKey;
    hq.replaceChildren();
    for (const q of quests) {
      const item = document.createElement('li');
      item.textContent = `⚑ ${q.texte.charAt(0).toUpperCase()}${q.texte.slice(1)}`;
      const bar = document.createElement('span');
      bar.className = 'barre';
      const fill = document.createElement('i');
      fill.style.width = `${q.progres}%`;
      bar.appendChild(fill);
      item.appendChild(bar);
      hq.appendChild(item);
    }
  }
  if (zi !== game.lastZone) {
    game.lastZone = zi;
    if (z.c) toast('La neige ferme cette zone jusqu\'au printemps.');
  }
}

function li(parent, text) {
  const el = document.createElement('li');
  el.textContent = text;
  parent.appendChild(el);
}

function renderSide() {
  if (!game.room || !$('cote').classList.contains('ouvert')) return;
  const s = game.room.state;
  const nom = game.monde?.nom ?? '';
  $('cote-titre').textContent = nom ? `Chronique ${/^[AEIOUYÉÈ]/i.test(nom) ? `d'${nom}` : `de ${nom}`}` : 'Chronique';
  const q = $('quetes');
  q.replaceChildren();
  const quetes = [...(s.quetes ?? [])];
  if (!quetes.length) li(q, 'Rien de pressant pour l\'instant.');
  for (const x of quetes) li(q, `${x.texte.charAt(0).toUpperCase()}${x.texte.slice(1)} (${x.progres} %)`);

  const m = $('metiers');
  m.replaceChildren();
  for (const [key, label] of Object.entries(METIERS)) {
    const job = s.metiers?.get(key);
    if (!job) continue;
    const a = document.createElement('span');
    a.textContent = `${label}, ${RANK[job.niveau]}`;
    const b = document.createElement('span');
    b.className = 'pips';
    b.textContent = '●'.repeat(job.niveau) + '○'.repeat(5 - job.niveau);
    b.title = `satisfaction ${job.satisfaction} / 100`;
    m.append(a, b);
  }

  const vi = $('village-info');
  vi.replaceChildren();
  const habitants = [...(s.habitants ?? [])];
  const familles = {};
  for (const h of habitants) familles[h.famille] = (familles[h.famille] ?? 0) + 1;
  const p1 = document.createElement('p');
  p1.textContent = `${habitants.length} habitants, dont ${habitants.filter((h) => !h.metier).length} enfants et ${habitants.filter((h) => h.metier === 'ancien').length} anciens.`;
  const p2 = document.createElement('p');
  p2.className = 'famille';
  p2.textContent = `Familles : ${Object.entries(familles).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} (${n})`).join(', ')}.`;
  vi.append(p1, p2);
  const talents = habitants.filter((h) => h.talent);
  if (talents.length) {
    const p3 = document.createElement('p');
    p3.textContent = `Talents : ${talents.map((h) => `${h.prenom} (${h.talent})`).join(', ')}.`;
    vi.appendChild(p3);
  }
  const plans = [...(s.plans ?? [])];
  const p4 = document.createElement('p');
  const offr = [...(s.offrandes?.entries() ?? [])].filter(([, n]) => n > 0).map(([r, n]) => `${r} × ${n}`);
  p4.textContent = plans.length
    ? `Plans inventés ici : ${plans.map((p) => p.nom).join(', ')}.`
    : `Aucun plan inventé pour l'instant${offr.length ? ` ; à la forge : ${offr.join(', ')}` : ' : rapportez au village les ressources rares trouvées au loin'}.`;
  vi.appendChild(p4);

  const on = $('enligne');
  on.replaceChildren();
  s.joueurs?.forEach((p) => li(on, p.nom));

  const box = $('chroniques');
  box.replaceChildren();
  for (const c of game.chroniques) {
    const h = document.createElement('h3');
    h.textContent = `Jour ${c.jour}${c.titre ? ` — ${c.titre}` : ''}`;
    const ul = document.createElement('ul');
    for (const l of c.lignes) li(ul, l);
    box.append(h, ul);
  }
  if (!game.chroniques.length) {
    const p = document.createElement('p');
    p.textContent = 'La première chronique paraîtra à la fin de la journée.';
    box.appendChild(p);
  }
}

// ---------- Sac et forge ----------

const SLOT_NOM = { epee: ['', 'épée de fer', 'lame d\'acier', 'lame de légende', 'lame forgée d\'après un plan'], armure: ['', 'tunique', 'cuirasse de cuir', 'cotte renforcée'], bottes: ['sandales', 'bottes de marche'] };

function renderBag() {
  const room = game.room;
  const me = room?.state.joueurs.get(room.sessionId);
  if (!me || !game.monde) return;
  $('equip').textContent = `Équipement : ${SLOT_NOM.epee[me.epee]} (${me.epee} dégât${me.epee > 1 ? 's' : ''}), ${SLOT_NOM.armure[me.armure]} (${me.pvMax} PV), ${SLOT_NOM.bottes[me.bottes]}${me.talisman ? ', un talisman' : ''}.`;
  const box = $('objets');
  const items = [...me.sac.entries()].filter(([, n]) => n > 0);
  const key = items.map(([k, n]) => `${k}${n}`).join('|') + `|${me.epee}${me.armure}${me.bottes}${me.talisman}|${room.state.outils}|${inVillage(me)}|${room.state.plans?.length}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  if (!items.length) box.textContent = 'Vide. Les monstres vaincus lâchent du minerai, du cuir et, dans certaines zones, des ressources rares.';
  for (const [item, n] of items) {
    const el = document.createElement('span');
    el.className = 'objet';
    const rare = game.monde.rares.includes(item);
    el.textContent = `${rare ? '◆ ' : ''}${item} × ${n}`;
    if (rare) el.style.color = rareColor(item);
    if (rare && inVillage(me)) {
      // Rapporter une trouvaille au village : le forgeron pourra peut-être en tirer un plan.
      const give = document.createElement('button');
      give.type = 'button';
      give.className = 'offrir';
      give.textContent = 'Offrir au village';
      give.addEventListener('click', () => room.send('offrir', { rare: item }));
      el.appendChild(give);
    }
    box.appendChild(el);
  }
  const here = inVillage(me);
  $('forge-note').textContent = here
    ? `Le forgeron a ${room.state.outils} outil${room.state.outils > 1 ? 's' : ''} : chaque pièce en consomme un.`
    : 'Revenez au village pour forger.';
  const list = $('recettes');
  list.replaceChildren();
  const rares = game.monde.rares.reduce((sum, r) => sum + (me.sac.get(r) ?? 0), 0);
  const plans = [...(room.state.plans ?? [])].map((p) => ({
    id: p.id, nom: `${p.nom} (plan de ${p.auteur})`, effet: p.effet, slot: p.slot, niveau: p.niveau, prerequis: p.prerequis,
    requis: Object.fromEntries(p.requis.split(',').filter(Boolean).map((x) => { const [k, n] = x.split(':'); return [k, Number(n)]; })),
    rares: 0, materiau: p.materiau,
  }));
  for (const r of [...game.monde.recettes, ...plans]) {
    const row = document.createElement('div');
    row.className = 'recette';
    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = r.nom;
    const cost = Object.entries(r.requis).map(([k, n]) => `${n} ${k}`);
    if (r.materiau) cost.push(`1 ${r.materiau}`);
    if (r.rares) cost.push(`${r.rares} ressource${r.rares > 1 ? 's' : ''} rare${r.rares > 1 ? 's' : ''}`);
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = `${r.effet} — ${cost.join(', ')}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    const owned = (me[r.slot] ?? 0) >= r.niveau;
    const missing = (me[r.slot] ?? 0) < (r.prerequis ?? r.niveau - 1) || Object.entries(r.requis).some(([k, n]) => (me.sac.get(k) ?? 0) < n) || rares < r.rares
      || (r.materiau && (me.sac.get(r.materiau) ?? 0) < 1);
    btn.textContent = owned ? 'Équipé' : 'Forger';
    btn.disabled = owned || missing || !here || room.state.outils < 1;
    btn.addEventListener('click', () => room.send('fabriquer', { recette: r.id }));
    row.append(nom, btn, detail);
    list.appendChild(row);
  }
}

function inVillage(p) {
  return zoneIndexAt(p.x, p.y, game.monde.largeur, game.monde.hauteur) === game.monde.village;
}

function toggleBag() {
  $('sac').classList.toggle('ouvert');
  $('objets').dataset.key = '';
  renderBag();
}
$('btn-sac').addEventListener('click', toggleBag);
$('fermer-sac').addEventListener('click', toggleBag);

// ---------- Arbre des familles ----------

function toggleTree() {
  const panel = $('arbre');
  panel.classList.toggle('ouvert');
  if (panel.classList.contains('ouvert') && game.room) {
    const ypd = game.monde?.anneesParJour ?? 1;
    $('rythme').textContent = ypd === 1 ? 'une année' : ypd === 0.25 ? 'une saison' : `${ypd} année${ypd > 1 ? 's' : ''}`;
    game.room.send('genealogie');
  }
}
$('btn-arbre').addEventListener('click', toggleTree);
$('fermer-arbre').addEventListener('click', toggleTree);

function toggleSide() {
  $('cote').classList.toggle('ouvert');
  renderSide();
}
$('btn-chronique').addEventListener('click', toggleSide);
$('fermer-cote').addEventListener('click', toggleSide);

// ---------- Boucle ----------

let lastFrame = performance.now();
let sized = { w: 0, h: 0, dpr: 0 };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (w !== sized.w || h !== sized.h) {
    canvas.width = w;
    canvas.height = h;
    sized = { w, h, dpr };
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  const room = game.room;
  if (!room || !game.monde || !room.state.zones) return;
  resize();
  const dt = Math.min(100, t - lastFrame);
  lastFrame = t;

  // Entrée : on n'envoie que les changements.
  const input = readInput();
  if (input.x !== game.sentInput.x || input.y !== game.sentInput.y) {
    room.send('deplacement', input);
    game.sentInput = input;
  }

  const players = [];
  const mine = room.state.joueurs.get(room.sessionId);
  if (mine) {
    if (!game.meInit) { game.me = { x: mine.x, y: mine.y }; game.meInit = true; }
    // Prédiction locale, bloquée par les zones fermées comme sur le serveur.
    const dashing = game.dash && t < game.dash.until;
    const factor = (dashing ? DASH_FACTOR : 1) * (mine.bottes ? BOOTS_FACTOR : 1);
    const next = mine.aTerre ? game.me : stepPosition(game.me.x, game.me.y, dashing ? game.dash.dir : input, dt, factor);
    if (input.x || input.y) game.facing = Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut');
    const blocked = (x, y) => room.state.zones[zoneIndexAt(x, y, game.monde.largeur, game.monde.hauteur)]?.c;
    if (!blocked(next.x, game.me.y)) game.me.x = next.x;
    if (!blocked(game.me.x, next.y)) game.me.y = next.y;
    // Recalage en douceur (ou immédiat si l'écart est grand, ou si le joueur est à terre).
    const ex = mine.x - game.me.x;
    const ey = mine.y - game.me.y;
    if (mine.aTerre || Math.hypot(ex, ey) > 2) game.me = { x: mine.x, y: mine.y };
    else { game.me.x += ex * 0.1; game.me.y += ey * 0.1; }
  }

  room.state.joueurs.forEach((p, id) => {
    const moi = id === room.sessionId;
    let d = game.others.get(id);
    if (!d) { d = { x: p.x, y: p.y, attaque: p.attaque, attackAt: -1e9, touche: p.touche, hurtAt: -1e9 }; game.others.set(id, d); }
    if (moi) { d.x = game.me.x; d.y = game.me.y; }
    else { d.x += (p.x - d.x) * 0.25; d.y += (p.y - d.y) * 0.25; }
    if (p.attaque !== d.attaque) { d.attaque = p.attaque; d.attackAt = t; }
    if (p.touche !== d.touche) { d.touche = p.touche; d.hurtAt = t; }
    if (d.roulade === undefined) d.roulade = p.roulade;
    if (p.roulade !== d.roulade) { d.roulade = p.roulade; if (!moi) d.dashAt = t; }
    if (moi && game.dash && t < game.dash.until) d.dashAt = game.dash.until - DASH_MS;
    const dir = moi && (input.x || input.y) ? (Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut')) : p.dir;
    players.push({ nom: p.nom, dx: d.x, dy: d.y, dir, bouge: moi ? Boolean(input.x || input.y) && !p.aTerre : p.bouge, couleur: p.couleur, attackAt: d.attackAt, hurtAt: d.hurtAt, dashAt: d.dashAt ?? -1e9, aTerre: p.aTerre, epee: p.epee, armure: p.armure, bottes: p.bottes, moi });
  });
  for (const id of game.others.keys()) if (!room.state.joueurs.has(id)) game.others.delete(id);

  const monsters = [];
  room.state.monstres?.forEach((m, id) => {
    let d = game.monsters.get(id);
    if (!d) { d = { x: m.x, y: m.y, coup: m.coup, touche: m.touche, hitAt: -1e9, lungeAt: -1e9, seed: Math.random() * 10 }; game.monsters.set(id, d); }
    d.x += (m.x - d.x) * 0.3;
    d.y += (m.y - d.y) * 0.3;
    if (m.coup !== d.coup) { d.coup = m.coup; d.lungeAt = t; }
    if (m.touche !== d.touche) { d.touche = m.touche; d.hitAt = t; }
    monsters.push({ sorte: m.sorte, dx: d.x, dy: d.y, pv: m.pv, pvMax: m.pvMax, hitAt: d.hitAt, lungeAt: d.lungeAt, seed: d.seed });
  });
  for (const id of game.monsters.keys()) if (!room.state.monstres.has(id)) game.monsters.delete(id);
  const questZones = new Set([...(room.state.quetes ?? [])].map((q) => q.zone).filter((z) => z >= 0));

  // Zoom entier : environ 20 tuiles visibles en largeur, 2× au minimum.
  const cssW = window.innerWidth;
  const zoom = Math.max(2, Math.min(4, Math.floor(cssW / (20 * 16))));
  const scale = zoom * sized.dpr;
  const worldW = game.monde.largeur * ZONE_TILES;
  const worldH = game.monde.hauteur * ZONE_TILES;
  const halfW = sized.w / 2 / (16 * scale);
  const halfH = sized.h / 2 / (16 * scale);
  const cx = Math.max(halfW, Math.min(worldW - halfW, game.me.x));
  const cy = Math.max(halfH, Math.min(worldH - halfH, game.me.y));

  if (game.ambiance) {
    updateAmbiance(game.ambiance, dt, game.me, t, room.state);
    game.nearVillager = nearestVillager(game.ambiance, game.me);
  }
  drawWorld(ctx, {
    monde: game.monde, zoneCanvases: game.zoneCanvases, state: room.state, players, monsters, questZones,
    under: game.ambiance ? (c) => drawAmbianceGround(c, game.ambiance, t) : null,
    over: game.ambiance ? (c) => drawAmbianceSky(c, game.ambiance, t) : null,
    view: { cx, cy, scale }, t, width: sized.w, height: sized.h,
  });
  drawMinimap(mini, { monde: game.monde, state: room.state, players, questZones });
  renderHud();
}

// Accès pour les tests automatisés dans le navigateur.
window.__contree = game;
