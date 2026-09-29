// Joueurs et personnages. Un joueur (son nom suffit, pas de compte) peut avoir quelques personnages.
// Le personnage qu'il n'incarne pas vit au village comme un habitant, et y travaille s'il a un métier ;
// on peut le reprendre à tout moment. Délaissé trop longtemps (en temps réel), il est perdu pour
// son joueur et reste au village pour de bon.
//
// Registre (sauvegardé) : `registry[nom du personnage]` = { owner, hid, metier, couleur, gear, sac,
// lastPlayedAt, perdu } ; `players[nom du joueur]` = { persos: [noms], lastDay }.
import { makeCtx } from '../src/sim/tick.js';
import { createHero, setPlayed, releaseHero, setFoyer, HERO_JOBS } from '../src/sim/systems/population.js';
import { computeSkills, villageBonus, SKILL_KEYS } from '../shared/competences.js';
import { pushEvent, announce } from './evenements.js';

export const MAX_PERSOS = 3;
export const COULEURS = 8;
const DAY_MS = 24 * 3600 * 1000;

// Au chargement : les anciens noms deviennent chacun un joueur avec un personnage du même nom,
// et personne n'est en jeu (tous les personnages sont au village).
export function initAccounts(world, now) {
  world.players ??= {};
  for (const [name, entry] of Object.entries(world.registry)) {
    // Personnages créés avant les classes : guerrier, sans points libres.
    if (!entry.classe) {
      const { skills, secret } = computeSkills('guerrier', entry.metier ?? 'aventurier');
      Object.assign(entry, { classe: 'guerrier', competences: skills, secret });
    }
    if (entry.owner) continue;
    entry.owner = name;
    entry.lastPlayedAt ??= now;
    world.players[name] ??= { persos: [], lastDay: entry.lastDay ?? null };
    if (!world.players[name].persos.includes(name)) world.players[name].persos.push(name);
  }
  for (const p of world.sim.village.population?.people ?? []) p.played = false;
}

const person = (room, hid) => room.sim.village.population?.people.find((p) => p.id === hid && p.alive) ?? null;

// Ce que voit un joueur sur l'écran de choix : ses personnages, et ceux qu'il a perdus.
export function charactersOf(room, joueur, now, abandonMs, playing) {
  const account = room.players[joueur];
  const list = (account?.persos ?? []).map((name) => {
    const e = room.registry[name];
    const h = person(room, e.hid);
    return {
      partenaire: h?.partner ? room.sim.village.population.people.find((q) => q.id === h.partner)?.prenom ?? '' : '',
      enfants: h ? room.sim.village.population.people.filter((q) => q.alive && q.parents.includes(h.id)).length : 0,
      nom: name, metier: e.metier ?? 'aventurier', classe: e.classe, secret: e.secret ?? '', competences: e.competences, couleur: e.couleur ?? 0, age: h?.age ?? null,
      enJeu: playing.has(name), absentDepuis: Math.max(0, now - (e.lastPlayedAt ?? now)),
      resteAvantPerte: Math.max(0, abandonMs - (now - (e.lastPlayedAt ?? now))),
    };
  });
  const perdus = Object.entries(room.registry).filter(([, e]) => e.owner === joueur && e.perdu).map(([name]) => name);
  return { joueur, persos: list, perdus, max: MAX_PERSOS, metiers: HERO_JOBS, abandonJours: Math.round(abandonMs / DAY_MS) };
}

// Nouveau personnage : un prénom libre dans la contrée, un métier, une couleur de tunique.
// `famille` : le nom du joueur (ses personnages forment une même famille au village).
export function createCharacter(room, joueur, { prenom, metier, couleur, classe = 'guerrier', libres = {} }, now, cleanName) {
  const account = room.players[joueur] ?? (room.players[joueur] = { persos: [], lastDay: null });
  if (account.persos.length >= MAX_PERSOS) throw new Error(`Vous avez déjà ${MAX_PERSOS} personnages.`);
  const name = cleanName(prenom);
  if (room.registry[name]) throw new Error(`Le prénom « ${name} » est déjà pris dans cette contrée.`);
  const job = HERO_JOBS.includes(metier) ? metier : 'aventurier';
  const { skills, secret } = computeSkills(classe, job, libres);
  room.registry[name] = {
    owner: joueur, metier: job, classe, competences: skills, secret, couleur: Number.isInteger(couleur) ? ((couleur % COULEURS) + COULEURS) % COULEURS : null,
    lastDay: room.sim.day, lastPlayedAt: now,
  };
  account.persos.push(name);
  ensureHero(room, name);
  return name;
}

// Chaque personnage a son habitant dans la simulation (créé au besoin, pour les anciennes sauvegardes).
export function ensureHero(room, name) {
  const entry = room.registry[name];
  if (entry.hid != null && person(room, entry.hid)) return;
  const famille = entry.owner && entry.owner !== name ? entry.owner : 'des Chemins';
  const res = createHero(room.sim, { prenom: name, metier: entry.metier ?? 'aventurier', owner: entry.owner, famille, bonus: villageBonus(entry.competences) }, makeCtx(room.sim, 24));
  if (!res) return;
  entry.hid = res.person.id;
  entry.metier = res.person.metier;
  if (room.players[entry.owner]?.maison != null) setFoyer(room.sim, entry.owner);
  pushEvent(room, res.event.type, null, res.event.data);
}

// Le personnage incarné porte sa classe, son métier et ses compétences.
export function applyCharacter(p, entry) {
  p.classe = entry.classe ?? 'guerrier';
  p.metier = entry.metier ?? 'aventurier';
  p.secret = entry.secret ?? '';
  for (const k of SKILL_KEYS) p[k] = Math.min(255, entry.competences?.[k] ?? 0);
}

export function startPlaying(room, name, now) {
  const entry = room.registry[name];
  entry.lastPlayedAt = now;
  setPlayed(room.sim, entry.hid, true);
}

export function stopPlaying(room, name, now) {
  const entry = room.registry[name];
  if (!entry) return;
  entry.lastPlayedAt = now;
  setPlayed(room.sim, entry.hid, false);
}

// Les personnages délaissés trop longtemps restent au village pour de bon.
export function checkAbandon(room, now, abandonMs, playing) {
  for (const [name, entry] of Object.entries(room.registry)) {
    if (!entry.owner || entry.perdu || playing.has(name)) continue;
    if (now - (entry.lastPlayedAt ?? now) < abandonMs) continue;
    entry.perdu = true;
    const account = room.players[entry.owner];
    if (account) account.persos = account.persos.filter((n) => n !== name);
    const e = releaseHero(room.sim, entry.hid, makeCtx(room.sim, 24));
    if (e) announce(room, pushEvent(room, e.type, null, e.data));
  }
}
