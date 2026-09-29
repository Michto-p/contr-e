// Client du jeu : connexion Colyseus, clavier/tactile, prédiction du déplacement, interface.
// Le serveur fait autorité : le client prédit son propre mouvement pour qu'il soit fluide,
// puis se recale en douceur sur la position envoyée par le serveur.
import { ZONE_TILES, DASH_MS, DASH_FACTOR, BOOTS_FACTOR, stepPosition, zoneIndexAt, ROOM_W, ROOM_H, FLOORS, WALLS, MOVABLE, DECORATIONS } from './shared/monde.js';
import { COMPETENCES, SKILL_KEYS, CLASSES, FREE_POINTS, basePoints, computeSkills, speedFactor, needsSpeed } from './shared/competences.js';
import { createSky } from './ciel.js';
import { unlockAudio, toggleMute, play, setWeather } from './sons.js';
import { buildZoneCanvases, drawWorld, drawMinimap, drawInterior, rareColor, TUNIQUES } from './render.js';
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
  pnj: new Map(), // gardes et égarés : position affichée
  sky: createSky(), // nuit, lumières et météo
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

// `options` : { joueur, perso } pour reprendre un personnage, { joueur, nouveau } pour en créer un.
async function connect(options) {
  if (typeof Colyseus === 'undefined') {
    setNotice('La bibliothèque réseau n\'a pas pu être chargée. La page doit être ouverte depuis le serveur du jeu (npm start).', true);
    return;
  }
  setNotice('Connexion…');
  try {
    const client = new Colyseus.Client(endpoint);
    game.room = await client.join('contree', options);
  } catch (err) {
    // Un refus de la contrée (prénom pris, personnage déjà en jeu…) arrive avec un code et un message clair.
    if (typeof err?.code === 'number' && err.message) setNotice(err.message, true);
    else setNotice(`Impossible de rejoindre la contrée (${err.message || err}). Le serveur est-il lancé ? Dans un Codespace, le port 2567 doit être public.`, true);
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
  room.onMessage('annonce', (text) => {
    toast(text);
    if (/horde .*marche sur le village/.test(text)) play('cor');
    else if (/repoussé la horde/.test(text)) play('succes');
    else if (/jour se lève/.test(text)) play('cloche');
  });
  room.onMessage('genealogie', (people) => {
    renderTrees($('arbre-contenu'), buildTrees(people));
  });
  room.onMessage('info', (text) => info(text));
  // Une nuit de sommeil : l'écran s'assombrit un instant.
  room.onMessage('dormi', () => {
    $('sommeil').classList.add('nuit');
    setTimeout(() => $('sommeil').classList.remove('nuit'), 1400);
  });
  // E devant chez soi : le sac s'ouvre avec le coffre de la maison.
  room.onMessage('coffre', () => {
    if (!$('sac').classList.contains('ouvert')) toggleBag();
  });
  room.onLeave(() => {
    toast('Connexion perdue avec la contrée. Rechargez la page pour revenir.');
  });

  game.joueur = options.joueur;
  try { localStorage.setItem('contree.nom', options.joueur); } catch { /* stockage indisponible */ }
  $('accueil').hidden = true;
  for (const id of ['hud', 'minimap', 'boutons', 'aide']) $(id).hidden = false;
  requestAnimationFrame(frame);
  setInterval(renderSide, 2000);
}

// ---------- Choix et création des personnages ----------

const METIERS_PERSO = {
  aventurier: ['Aventurier', 'Sans métier : laissé au village, repos entre deux aventures.'],
  agriculteur: ['Agriculteur', 'Laissé au village : travail aux champs, plus de blé.'],
  boulanger: ['Boulanger', 'Laissé au village : coup de main au fournil, plus de pain.'],
  forgeron: ['Forgeron', 'Laissé au village : coup de main à la forge, plus d\'outils.'],
  bucheron_mineur: ['Bûcheron-mineur', 'Laissé au village : coupe du bois, descente à la mine.'],
  eleveur: ['Éleveur', 'Laissé au village : les bêtes, dont le fumier enrichit les champs.'],
  garde: ['Garde', 'Laissé au village : patrouilles et combats contre les monstres.'],
  enseignant: ['Enseignant', ''],
};
let couleur = 0;
let libres = {}; // points libres placés par le joueur

function renderSkills() {
  const classe = $('classe').value;
  const metier = $('metier').value;
  if (!classe || !metier) return;
  const base = basePoints(classe, metier);
  const { skills, secret } = computeSkills(classe, metier, libres);
  const spent = Object.values(libres).reduce((a, b) => a + b, 0);
  const box = $('competences');
  box.replaceChildren();
  for (const k of SKILL_KEYS) {
    const lib = libres[k] ?? 0;
    const bonus = skills[k] - base[k] - lib;
    const label = document.createElement('span');
    label.textContent = COMPETENCES[k].nom;
    label.title = COMPETENCES[k].effet;
    const barre = document.createElement('span');
    barre.className = 'barre';
    barre.title = COMPETENCES[k].effet;
    for (const [cls, v] of [['base', base[k]], ['libre', lib], ['bonus', bonus]]) {
      if (!v) continue;
      const i = document.createElement('i');
      i.className = cls;
      i.style.width = `${(v / 70) * 100}%`;
      barre.appendChild(i);
    }
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = skills[k];
    const pm = document.createElement('span');
    pm.className = 'pm';
    for (const [txt, d] of [['−', -1], ['+', 1]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.setAttribute('aria-label', `${d > 0 ? 'Ajouter' : 'Retirer'} un point en ${COMPETENCES[k].nom}`);
      b.disabled = d > 0 ? spent >= FREE_POINTS : lib <= 0;
      b.addEventListener('click', () => { libres[k] = lib + d; renderSkills(); });
      pm.appendChild(b);
    }
    box.append(label, barre, val, pm);
  }
  $('points-libres').textContent = `Points libres : ${FREE_POINTS - spent} sur ${FREE_POINTS}. (Survolez une compétence pour voir son effet.)`;
  const sec = $('secret');
  sec.hidden = !secret;
  if (secret) sec.textContent = `✨ Secret de classe découvert : « ${secret} » ! ${CLASSES[classe].nom} et ce métier vont bien ensemble : des points en plus (en vert).`;
}

function duree(ms) {
  const h = ms / 3_600_000;
  if (h < 1) return 'moins d\'une heure';
  if (h < 24) return `${Math.floor(h)} h`;
  const j = Math.floor(h / 24);
  return `${j} jour${j > 1 ? 's' : ''}`;
}

async function showChoice(joueurSaisi) {
  setNotice('Recherche de vos personnages…');
  let data;
  try {
    const res = await fetch(`${endpoint}/persos?joueur=${encodeURIComponent(joueurSaisi)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.erreur ?? res.status);
  } catch (err) {
    setNotice(`Impossible de joindre la contrée (${err.message || err}). Le serveur est-il lancé ?`, true);
    return;
  }
  setNotice('');
  game.joueur = data.joueur;
  $('entrer').hidden = true;
  $('choix').hidden = false;
  $('choix-titre').textContent = `Les personnages de ${data.joueur}`;
  $('choix-note').textContent = `Celui que vous ne jouez pas vit au village, et y travaille s'il a un métier. Vous pouvez le reprendre à tout moment ; sans être joué pendant ${data.abandonJours} jours, il reste au village pour de bon.`;
  const box = $('persos');
  box.replaceChildren();
  if (!data.persos.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Pas encore de personnage : créez le premier ci-dessous.';
    box.appendChild(p);
  }
  for (const c of data.persos) {
    const row = document.createElement('div');
    row.className = 'perso';
    const pastille = document.createElement('span');
    pastille.className = 'pastille';
    pastille.style.background = TUNIQUES[c.couleur % TUNIQUES.length];
    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = c.nom;
    const d1 = document.createElement('span');
    d1.className = 'detail';
    d1.textContent = `${CLASSES[c.classe]?.nom ?? ''} · ${METIERS_PERSO[c.metier]?.[0] ?? c.metier}${c.secret ? ` · ✨ ${c.secret}` : ''}${c.age != null ? ` · ${c.age} ans` : ''} · ${c.enJeu ? 'en jeu' : 'au village'}`;
    const d2 = document.createElement('span');
    d2.className = 'detail';
    const famille = [c.partenaire ? `en couple avec ${c.partenaire}` : '', c.enfants ? `${c.enfants} enfant${c.enfants > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
    d2.textContent = `${famille ? `${famille} · ` : ''}Joué il y a ${duree(c.absentDepuis)}`;
    if (c.resteAvantPerte < 7 * 24 * 3_600_000) {
      d2.classList.add('alerte');
      d2.textContent += ` · restera au village pour de bon dans ${duree(c.resteAvantPerte)}`;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primaire';
    b.textContent = 'Jouer';
    b.disabled = c.enJeu;
    b.addEventListener('click', () => connect({ joueur: data.joueur, perso: c.nom }));
    row.append(pastille, nom, b, d1, d2);
    box.appendChild(row);
  }
  // Création : un prénom, un métier, une couleur de tunique.
  $('creer').hidden = data.persos.length >= data.max;
  const sel = $('metier');
  if (!sel.options.length) {
    for (const m of data.metiers) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = METIERS_PERSO[m]?.[0] ?? m;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { $('metier-note').textContent = METIERS_PERSO[sel.value]?.[1] ?? ''; renderSkills(); });
    $('metier-note').textContent = METIERS_PERSO[sel.value]?.[1] ?? '';
    const cl = $('classe');
    for (const [id, c] of Object.entries(CLASSES)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = `Classe : ${c.nom}`;
      cl.appendChild(o);
    }
    const noteClasse = () => { $('classe-note').textContent = CLASSES[cl.value].texte; };
    cl.addEventListener('change', () => { noteClasse(); renderSkills(); });
    noteClasse();
    renderSkills();
    const cols = $('couleurs');
    TUNIQUES.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Tunique ${i + 1}`);
      b.setAttribute('aria-checked', String(i === couleur));
      b.addEventListener('click', () => {
        couleur = i;
        for (const x of cols.children) x.setAttribute('aria-checked', String(x === b));
      });
      cols.appendChild(b);
    });
  }
  $('perdus').textContent = data.perdus.length
    ? `Restés au village pour de bon : ${data.perdus.join(', ')}. Vous les croiserez parmi les habitants.`
    : '';
  if (data.persos.length >= data.max) $('perdus').textContent += ` (${data.max} personnages au plus.)`;
}

$('entrer').addEventListener('submit', (e) => {
  e.preventDefault();
  const nom = $('nom').value.trim();
  if (nom) showChoice(nom);
});
$('creer').addEventListener('submit', (e) => {
  e.preventDefault();
  const prenom = $('prenom').value.trim();
  if (prenom) connect({ joueur: game.joueur, nouveau: { prenom, metier: $('metier').value, classe: $('classe').value, libres, couleur } });
});
$('autre-joueur').addEventListener('click', () => { $('choix').hidden = true; $('entrer').hidden = false; setNotice(''); });

// Changer de personnage : on quitte proprement la contrée (le personnage retourne au village),
// puis on revient à l'écran de choix.
async function switchCharacter() {
  const q = new URLSearchParams(location.search);
  q.set('joueur', game.joueur ?? '');
  try { await game.room?.leave(); } catch { /* déjà parti */ }
  location.href = `${location.pathname}?${q}`;
}

try { $('nom').value = params.get('joueur') ?? localStorage.getItem('contree.nom') ?? ''; } catch { /* rien */ }
if (params.get('joueur')) showChoice(params.get('joueur'));

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
  unlockAudio();
  if (e.code === 'KeyM') info(toggleMute() ? 'Son coupé (M pour le remettre)' : 'Son activé');
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === 'Space' || e.code === 'KeyJ') { attack(); e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyK') { interact(); e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyL') { dash(); e.preventDefault(); }
  if (e.code === 'KeyR') { eat(); e.preventDefault(); }
  if (e.code === 'KeyF' || e.code === 'KeyI') { toggleBag(); e.preventDefault(); }
  if (e.code === 'KeyG') { toggleTree(); e.preventDefault(); }
  if (e.code === 'KeyP') { switchCharacter(); e.preventDefault(); }
  if (e.code === 'KeyH') { toggleFurnish(); e.preventDefault(); }
  if (e.code === 'KeyC') toggleSide();
  if (e.code === 'Escape') { $('message').hidden = true; for (const id of ['cote', 'sac', 'arbre']) $(id).classList.remove('ouvert'); }
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
window.addEventListener('blur', () => keys.clear());

// Tactile / souris : maintenir le doigt sur l'écran fait marcher dans cette direction.
let pointer = null;
window.addEventListener('pointerdown', () => { if (game.room) unlockAudio(); });
canvas.addEventListener('pointerdown', (e) => {
  // Aménagement : le clic pose le meuble choisi à cet endroit de la pièce.
  if (game.placing && game.view) {
    const { w, h, scale, dpr } = game.view;
    const unit = 16 * scale;
    const x = (e.clientX * dpr - (w / 2 - (ROOM_W / 2) * unit)) / unit;
    const y = (e.clientY * dpr - (h / 2 - (ROOM_H / 2) * unit)) / unit;
    game.room.send('amenager', { deplacer: game.placing, x, y });
    game.placing = null;
    renderFurnish();
    return;
  }
  pointer = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
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
  play('epee');
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
  play('roulade');
}

let lastEat = 0;
function eat() {
  if (!game.room) return;
  const now = performance.now();
  if (now - lastEat < 500) return;
  lastEat = now;
  game.room.send('manger');
  const me = game.room.state.joueurs.get(game.room.sessionId);
  if (me && me.pv < me.pvMax && game.room.state.pain > 0) play('manger');
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
// Certaines actions passent avant la conversation : un habitant qui passe ne doit pas les voler.
const PRIORITY_ACTION = /^(bâtir votre maison|ouvrir le coffre|secourir|entrer chez vous|dormir|sortir|adopter|laisser votre compagnon|remettre en état)/;
function talkTarget() {
  const me = game.room?.state.joueurs.get(game.room.sessionId);
  return me && PRIORITY_ACTION.test(me.action) ? null : game.nearVillager;
}

function interact() {
  if (!game.room) return;
  // Près d'un habitant, E sert à lui parler.
  const near = talkTarget();
  if (near) { talkTo(near); return; }
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
  const home = s.joueurs.get(game.room.sessionId)?.interieur >= 0 || z.f; // chez soi ou dans un faubourg : à l'abri
  const label = home && !z.f ? 'Chez vous' : z.f ? 'Le faubourg' : info.village ? 'Le village' : info.label.charAt(0).toUpperCase() + info.label.slice(1);
  $('ou').textContent = label;
  $('danger-mot').textContent = home || info.village ? 'Zone sûre' : `Monstres : ${PRESSION(z.p)}`;
  $('jauge').style.width = `${home || info.village ? 0 : z.p}%`;
  const structs = (z.s || '').split(';').filter(Boolean).map((part) => {
    const [type, cond, b] = part.split('|');
    return `${type} (${statusWord(Number(cond), b === '1')})`;
  });
  $('structs').textContent = home ? '' : structs.join(' · ');

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
    for (const k of ['faim', 'fatigue']) {
      const bar = $(k);
      bar.style.width = `${me[k]}%`;
      bar.classList.toggle('haut', me[k] >= 70);
    }
    const action = $('action');
    const near = game.nearVillager;
    const label = near && talkTarget() ? `parler à ${near.prenom}` : me.action;
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
  // La hiérarchie : qui mène le village, qui tient chaque atelier.
  const chef = habitants.find((h) => h.rang === 'chef');
  const maitres = habitants.filter((h) => h.rang === 'maitre');
  if (chef || maitres.length) {
    const p3 = document.createElement('p');
    p3.textContent = `${chef ? `À la tête du village : ${chef.prenom} ${chef.famille}.` : ''} ${maitres.length ? `Maîtres d'atelier : ${maitres.map((h) => `${h.prenom} (${METIERS_PERSO[h.metier]?.[0] ?? h.metier})`).join(', ')}.` : ''} Apprentis : ${habitants.filter((h) => h.rang === 'apprenti').length}.`;
    vi.appendChild(p3);
  }
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

  $('version').textContent = game.monde?.version ? `Version du jeu : ${game.monde.version}` : '';
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
  const RANGS = { chef: ' · à la tête du village', maitre: ' · maître d\'atelier', apprenti: ' · apprenti' };
  $('fiche').textContent = `${me.nom} — ${CLASSES[me.classe]?.nom ?? ''}, ${METIERS_PERSO[me.metier]?.[0] ?? ''}${me.secret ? ` · ✨ ${me.secret}` : ''}${RANGS[me.rang] ?? ''} · renommée ${me.renommee}. `
    + SKILL_KEYS.map((k) => `${COMPETENCES[k].nom} ${me[k]}`).join(' · ');
  const box = $('objets');
  const items = [...me.sac.entries()].filter(([, n]) => n > 0);
  // Devant sa maison, le coffre est ouvert : on peut y déposer ou y reprendre ses affaires.
  const atHome = me.action === 'ouvrir le coffre de votre maison';
  const chest = [...(me.coffre?.entries() ?? [])].filter(([, n]) => n > 0);
  const key = items.map(([k, n]) => `${k}${n}`).join('|') + `|${me.epee}${me.armure}${me.bottes}${me.talisman}|${room.state.outils}|${inVillage(me)}|${room.state.plans?.length}|${atHome}|${chest.map(([k, n]) => `${k}${n}`).join(',')}`;
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
    if (atHome) {
      const put = document.createElement('button');
      put.type = 'button';
      put.className = 'offrir';
      put.textContent = 'Déposer';
      put.addEventListener('click', () => room.send('coffre', { sens: 'deposer', objet: item }));
      el.appendChild(put);
    }
    box.appendChild(el);
  }
  $('coffre-section').hidden = !atHome;
  const cbox = $('coffre-objets');
  cbox.replaceChildren();
  if (atHome && !chest.length) cbox.textContent = 'Le coffre est vide.';
  for (const [item, n] of atHome ? chest : []) {
    const el = document.createElement('span');
    el.className = 'objet';
    el.textContent = `${item} × ${n}`;
    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'offrir';
    take.textContent = 'Prendre';
    take.addEventListener('click', () => room.send('coffre', { sens: 'retirer', objet: item }));
    el.appendChild(take);
    cbox.appendChild(el);
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
$('btn-persos').addEventListener('click', switchCharacter);
$('btn-amenager').addEventListener('click', toggleFurnish);
$('fermer-amenager').addEventListener('click', toggleFurnish);

// ---------- Aménager sa maison ----------

const MEUBLE_NOM = { lit: 'Le lit', coffre: 'Le coffre', panier: 'Le panier', table: 'La table' };
let layoutCache = { json: '', lay: null };
function currentLayout() {
  const s = game.room?.state;
  const me = s?.joueurs.get(game.room.sessionId);
  if (!me || me.interieur < 0) return null;
  const json = s.interieurs?.get(String(me.interieur)) ?? '';
  if (json !== layoutCache.json) layoutCache = { json, lay: json ? JSON.parse(json) : null };
  return layoutCache.lay;
}
const atHome = () => {
  const me = game.room?.state.joueurs.get(game.room.sessionId);
  return me && me.interieur >= 0 && me.maison === me.interieur;
};
function toggleFurnish() {
  if (!atHome()) { $('amenager').classList.remove('ouvert'); game.placing = null; return; }
  $('amenager').classList.toggle('ouvert');
  game.placing = null;
  renderFurnish();
}
function renderFurnish() {
  const lay = currentLayout();
  if (!lay || !$('amenager').classList.contains('ouvert')) return;
  const send = (m) => game.room.send('amenager', m);
  const button = (text, pressed, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  };
  $('am-sols').replaceChildren(...Object.entries(FLOORS).map(([k, nom]) => button(nom, lay.sol === k, () => send({ sol: k }))));
  $('am-murs').replaceChildren(...WALLS.map((c, i) => {
    const b = button('', lay.mur === i, () => send({ mur: i }));
    b.style.background = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(lay.mur === i));
    b.setAttribute('aria-label', `Murs, teinte ${i + 1}`);
    return b;
  }));
  $('am-meubles').replaceChildren(...[...MOVABLE, ...lay.deco].map((k) => button(MEUBLE_NOM[k] ?? DECORATIONS[k]?.nom ?? k, game.placing === k, () => {
    game.placing = game.placing === k ? null : k;
    info(game.placing ? 'Cliquez dans la pièce pour le poser.' : '');
    renderFurnish();
  })));
  const box = $('am-deco');
  box.replaceChildren();
  for (const [k, d] of Object.entries(DECORATIONS)) {
    const row = document.createElement('div');
    row.className = 'recette';
    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = d.nom;
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = Object.entries(d.cout).map(([item, n]) => (item === 'rare' ? 'une ressource rare' : item === 'bois' ? `${n} bois du village` : `${n} ${item}`)).join(', ');
    const owned = lay.deco.includes(k);
    const b = button(owned ? 'Installé' : 'Fabriquer', false, () => send({ fabriquer: k }));
    b.disabled = owned;
    row.append(nom, b, detail);
    box.appendChild(row);
  }
}
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
    const factor = (dashing ? DASH_FACTOR : 1) * (mine.bottes ? BOOTS_FACTOR : 1) * speedFactor(mine) * needsSpeed(mine);
    const next = mine.aTerre ? game.me : stepPosition(game.me.x, game.me.y, dashing ? game.dash.dir : input, dt, factor);
    if (input.x || input.y) game.facing = Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut');
    if (mine.interieur >= 0) {
      // Chez soi : entre les murs de la pièce, comme sur le serveur.
      game.me.x = Math.max(0.6, Math.min(ROOM_W - 0.6, next.x));
      game.me.y = Math.max(1.6, Math.min(ROOM_H - 0.4, next.y));
    } else {
      const blocked = (x, y) => room.state.zones[zoneIndexAt(x, y, game.monde.largeur, game.monde.hauteur)]?.c;
      if (!blocked(next.x, game.me.y)) game.me.x = next.x;
      if (!blocked(game.me.x, next.y)) game.me.y = next.y;
    }
    // Recalage en douceur (ou immédiat si l'écart est grand, ou si le joueur est à terre).
    const ex = mine.x - game.me.x;
    const ey = mine.y - game.me.y;
    if (mine.aTerre || Math.hypot(ex, ey) > 2) game.me = { x: mine.x, y: mine.y };
    else { game.me.x += ex * 0.1; game.me.y += ey * 0.1; }
    // Son du butin quand le sac se remplit ; pluie de fond selon la météo.
    let bag = 0;
    mine.sac?.forEach((n) => { bag += n; });
    if (game.bag != null && bag > game.bag) play('butin');
    game.bag = bag;
    if (room.state.meteo !== game.meteo) { game.meteo = room.state.meteo; setWeather(game.meteo); }
  }

  room.state.joueurs.forEach((p, id) => {
    const moi = id === room.sessionId;
    let d = game.others.get(id);
    if (!d) { d = { x: p.x, y: p.y, attaque: p.attaque, attackAt: -1e9, touche: p.touche, hurtAt: -1e9 }; game.others.set(id, d); }
    if (moi) { d.x = game.me.x; d.y = game.me.y; }
    else if (d.interieur !== p.interieur || Math.hypot(p.x - d.x, p.y - d.y) > 6) { d.x = p.x; d.y = p.y; } // entré ou sorti : pas de glissade
    else { d.x += (p.x - d.x) * 0.25; d.y += (p.y - d.y) * 0.25; }
    d.interieur = p.interieur;
    updatePet(d, p, dt);
    if (p.attaque !== d.attaque) { d.attaque = p.attaque; d.attackAt = t; }
    if (p.touche !== d.touche) { d.touche = p.touche; d.hurtAt = t; if (moi) play('blesse'); }
    if (d.roulade === undefined) d.roulade = p.roulade;
    if (p.roulade !== d.roulade) { d.roulade = p.roulade; if (!moi) d.dashAt = t; }
    if (moi && game.dash && t < game.dash.until) d.dashAt = game.dash.until - DASH_MS;
    const dir = moi && (input.x || input.y) ? (Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut')) : p.dir;
    players.push({ nom: p.nom, dx: d.x, dy: d.y, dir, bouge: moi ? Boolean(input.x || input.y) && !p.aTerre : p.bouge, couleur: p.couleur, attackAt: d.attackAt, hurtAt: d.hurtAt, dashAt: d.dashAt ?? -1e9, aTerre: p.aTerre, epee: p.epee, armure: p.armure, bottes: p.bottes, moi, interieur: p.interieur, pet: d.pet });
  });
  for (const id of game.others.keys()) if (!room.state.joueurs.has(id)) game.others.delete(id);

  const monsters = [];
  room.state.monstres?.forEach((m, id) => {
    let d = game.monsters.get(id);
    if (!d) { d = { x: m.x, y: m.y, coup: m.coup, touche: m.touche, hitAt: -1e9, lungeAt: -1e9, seed: Math.random() * 10 }; game.monsters.set(id, d); }
    d.x += (m.x - d.x) * 0.3;
    d.y += (m.y - d.y) * 0.3;
    if (m.coup !== d.coup) { d.coup = m.coup; d.lungeAt = t; }
    if (m.touche !== d.touche) { d.touche = m.touche; d.hitAt = t; if (Math.hypot(m.x - game.me.x, m.y - game.me.y) < 10) play('touche'); }
    monsters.push({ sorte: m.sorte, horde: m.horde, dx: d.x, dy: d.y, pv: m.pv, pvMax: m.pvMax, hitAt: d.hitAt, lungeAt: d.lungeAt, seed: d.seed });
  });
  for (const id of game.monsters.keys()) if (!room.state.monstres.has(id)) game.monsters.delete(id);
  const pnjs = [];
  room.state.pnj?.forEach((g, id) => {
    let d = game.pnj.get(id);
    if (!d) { d = { x: g.x, y: g.y, coup: g.coup, touche: g.touche, hitAt: -1e9, lungeAt: -1e9 }; game.pnj.set(id, d); }
    d.x += (g.x - d.x) * 0.3;
    d.y += (g.y - d.y) * 0.3;
    if (g.coup !== d.coup) { d.coup = g.coup; d.lungeAt = t; }
    if (g.touche !== d.touche) { d.touche = g.touche; d.hitAt = t; }
    pnjs.push({ sorte: g.sorte, prenom: g.prenom, dx: d.x, dy: d.y, dir: g.dir, bouge: g.bouge, pv: g.pv, pvMax: g.pvMax, suit: g.suit, hitAt: d.hitAt, lungeAt: d.lungeAt });
  });
  for (const id of game.pnj.keys()) if (!room.state.pnj.has(id)) game.pnj.delete(id);
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

  // Chez soi : on dessine la pièce, avec ceux qui s'y trouvent.
  if (mine && mine.interieur >= 0) {
    game.nearVillager = null;
    game.view = { w: sized.w, h: sized.h, scale, dpr: sized.dpr };
    const lay = currentLayout();
    drawInterior(ctx, { players: players.filter((p) => p.interieur === mine.interieur), heure: room.state.heure, t, width: sized.w, height: sized.h, scale, layout: lay ?? undefined, placing: game.placing });
    const home = atHome();
    $('btn-amenager').hidden = !home;
    if ($('amenager').classList.contains('ouvert')) {
      if (!home) toggleFurnish();
      else if (layoutCache.json !== game.furnishKey) { game.furnishKey = layoutCache.json; renderFurnish(); }
    }
    drawMinimap(mini, { monde: game.monde, state: room.state, players: [], pnjs, questZones });
    renderHud();
    return;
  }
  $('btn-amenager').hidden = true;
  if ($('amenager').classList.contains('ouvert')) toggleFurnish();
  if (game.ambiance) {
    updateAmbiance(game.ambiance, dt, game.me, t, room.state);
    game.nearVillager = nearestVillager(game.ambiance, game.me);
  }
  drawWorld(ctx, {
    monde: game.monde, zoneCanvases: game.zoneCanvases, state: room.state, players: players.filter((p) => p.interieur < 0), monsters, pnjs, questZones, sky: game.sky, dt,
    under: game.ambiance ? (c) => drawAmbianceGround(c, game.ambiance, t) : null,
    over: game.ambiance ? (c) => drawAmbianceSky(c, game.ambiance, t) : null,
    view: { cx, cy, scale }, t, width: sized.w, height: sized.h,
  });
  drawMinimap(mini, { monde: game.monde, state: room.state, players, pnjs, questZones });
  renderHud();
}

// Le compagnon suit son maître d'un pas tranquille, un peu en retrait.
function updatePet(d, p, dt) {
  if (!p.compagnon) { d.pet = null; return; }
  const [fx, fy] = FACE[p.dir] ?? [0, 1];
  const tx = d.x - fx * 0.9 + 0.3;
  const ty = d.y - fy * 0.9 + 0.2;
  if (!d.pet || d.pet.sorte !== p.compagnon || Math.hypot(tx - d.pet.x, ty - d.pet.y) > 6) {
    d.pet = { sorte: p.compagnon, x: tx, y: ty, bouge: false, dir: 'droite' };
    return;
  }
  const dx = tx - d.pet.x;
  const dy = ty - d.pet.y;
  const dist = Math.hypot(dx, dy);
  d.pet.bouge = dist > 0.25;
  if (d.pet.bouge) {
    const step = Math.min(dist, (dist > 2 ? 6.5 : 4.5) * dt / 1000);
    d.pet.x += (dx / dist) * step;
    d.pet.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.05) d.pet.dir = dx > 0 ? 'droite' : 'gauche';
  }
}

// Accès pour les tests automatisés dans le navigateur.
window.__contree = game;
