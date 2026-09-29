// Client du jeu : connexion Colyseus, clavier/tactile, prédiction du déplacement, interface.
// Le serveur fait autorité : le client prédit son propre mouvement pour qu'il soit fluide,
// puis se recale en douceur sur la position envoyée par le serveur.
import { ZONE_TILES, stepPosition, zoneIndexAt } from './shared/monde.js';
import { buildZoneCanvases, drawWorld, drawMinimap } from './render.js';

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
$('message-ok').addEventListener('click', () => { $('message').hidden = true; });

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
  if (e.code === 'KeyC') toggleSide();
  if (e.code === 'Escape') { $('message').hidden = true; $('cote').classList.remove('ouvert'); }
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
  for (const t of quetes) li(q, t.charAt(0).toUpperCase() + t.slice(1));

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
    const next = stepPosition(game.me.x, game.me.y, input, dt);
    const blocked = (x, y) => room.state.zones[zoneIndexAt(x, y, game.monde.largeur, game.monde.hauteur)]?.c;
    if (!blocked(next.x, game.me.y)) game.me.x = next.x;
    if (!blocked(game.me.x, next.y)) game.me.y = next.y;
    // Recalage en douceur (ou immédiat si l'écart est grand).
    const ex = mine.x - game.me.x;
    const ey = mine.y - game.me.y;
    if (Math.hypot(ex, ey) > 2) game.me = { x: mine.x, y: mine.y };
    else { game.me.x += ex * 0.1; game.me.y += ey * 0.1; }
  }

  room.state.joueurs.forEach((p, id) => {
    const moi = id === room.sessionId;
    let d = game.others.get(id);
    if (!d) { d = { x: p.x, y: p.y, attaque: p.attaque, attackAt: -1e9 }; game.others.set(id, d); }
    if (moi) { d.x = game.me.x; d.y = game.me.y; }
    else { d.x += (p.x - d.x) * 0.25; d.y += (p.y - d.y) * 0.25; }
    if (p.attaque !== d.attaque) { d.attaque = p.attaque; d.attackAt = t; }
    const dir = moi && (input.x || input.y) ? (Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut')) : p.dir;
    players.push({ nom: p.nom, dx: d.x, dy: d.y, dir, bouge: moi ? Boolean(input.x || input.y) : p.bouge, couleur: p.couleur, attackAt: d.attackAt, moi });
  });
  for (const id of game.others.keys()) if (!room.state.joueurs.has(id)) game.others.delete(id);

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

  drawWorld(ctx, {
    monde: game.monde, zoneCanvases: game.zoneCanvases, state: room.state, players,
    view: { cx, cy, scale }, t, width: sized.w, height: sized.h,
  });
  drawMinimap(mini, { monde: game.monde, state: room.state, players });
  renderHud();
}

// Accès pour les tests automatisés dans le navigateur.
window.__contree = game;
