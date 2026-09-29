// Une room Colyseus = une contrée. La simulation de l'étape 1 y tourne en continu :
// une heure de jeu toutes les `heureMs` millisecondes, que des joueurs soient connectés ou non.
// Les vrais joueurs pèsent sur le monde comme les bots : leur présence dans une zone y freine
// les monstres, et chaque monstre vaincu compte comme un combat (voir gameplay.js).
import { Room } from '@colyseus/core';
import { dayLines, summarySince, questText } from '../src/chronicle/chronicle.js';
import { SEASONS, seasonIndex } from '../src/sim/systems/seasons.js';
import { ZONE_TILES, MOVE_STEP_MS, DASH_MS, DASH_FACTOR, BOOTS_FACTOR, zoneIndexAt, stepPosition } from '../shared/monde.js';
import { initPnj, updatePnj } from './pnj.js';
import { EtatContree, Joueur, Zone, Metier, Quete, Habitant, Plan } from './schema.js';
import { openWorld, advanceWorld, snapshotWorld, saveWorld } from './persistence.js';
import {
  initGameplay, updateGameplay, playerAttack, playerInteract, updateActions, questPercent,
  PLAYER_PV, KILLS_PER_HOUR_CAP,
} from './gameplay.js';
import {
  initObjets, updateObjets, playerDash, playerEat, playerCraft, playerOffer, isDashing, savePlayer, restorePlayer, RECETTES, planRecipe,
} from './objets.js';

const ATTACK_COOLDOWN_MS = 400;
const NAME_MAX = 16;

function cleanName(raw) {
  const s = String(raw ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, NAME_MAX);
  return s || 'Voyageur';
}

function colorOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 8;
}

function structuresSummary(zone) {
  return zone.structures
    .filter((s) => !s.protected)
    .map((s) => `${s.type}|${s.condition}|${s.building ? 1 : 0}`)
    .join(';');
}

// Fabrique une classe de room liée à une configuration (les options envoyées par un client
// ne peuvent donc jamais la modifier).
export function makeContreeRoom(config) {
  const {
    heureMs = 30_000, bots = 'mixte', graine = 42, fichier = 'data/contree.json',
    rattrapageMaxJours = 7, rythmeVie = null, taille = undefined, now = () => Date.now(), log = () => {}, version = '',
  } = config;

  return class ContreeRoom extends Room {
    maxClients = 20;
    autoDispose = false; // le monde vit même quand tout le monde est parti

    onCreate() {
      this.inputs = new Map(); // sessionId -> { x, y }
      this.activity = new Map(); // sessionId -> { zones: Set, kills: Map zone -> nombre } pour l'heure en cours
      this.lastAttack = new Map();
      this.loadOrCreate();
      initGameplay(this);
      initPnj(this);
      initObjets(this);
      this.lastActions = 0;

      this.setState(new EtatContree());
      for (let i = 0; i < this.sim.zones.length; i++) this.state.zones.push(new Zone());
      this.syncState();

      this.onMessage('deplacement', (client, m) => {
        const x = Math.max(-1, Math.min(1, Number(m?.x) || 0));
        const y = Math.max(-1, Math.min(1, Number(m?.y) || 0));
        this.inputs.set(client.sessionId, { x, y });
      });
      this.onMessage('attaque', (client) => this.attack(client));
      this.onMessage('interagir', (client) => playerInteract(this, client.sessionId));
      this.onMessage('manger', (client) => playerEat(this, client.sessionId));
      // L'arbre des familles complet (vivants et disparus), envoyé à la demande.
      this.onMessage('genealogie', (client) => {
        const pop = this.sim.village.population;
        client.send('genealogie', (pop?.people ?? []).map((q) => ({
          id: q.id, prenom: q.prenom, famille: q.famille, parents: q.parents, partenaire: q.partner, age: q.age,
          vivant: q.alive, ne: q.born ?? null, mort: q.died ?? null, metier: q.alive ? q.metier : (q.ancienMetier ?? q.metier), talent: q.talent,
        })));
      });
      this.onMessage('offrir', (client, m) => { playerOffer(this, client.sessionId, String(m?.rare ?? '')); this.syncVillage(); });
      this.onMessage('fabriquer', (client, m) => playerCraft(this, client.sessionId, String(m?.recette ?? '')));
      this.onMessage('roulade', (client) => {
        const p = this.state.joueurs.get(client.sessionId);
        const input = this.inputs.get(client.sessionId) ?? { x: 0, y: 0 };
        const FACE = { droite: [1, 0], gauche: [-1, 0], bas: [0, 1], haut: [0, -1] };
        const [fx, fy] = FACE[p?.dir] ?? [0, 1];
        // La roulade part dans la direction tenue, ou droit devant.
        if (playerDash(this, client.sessionId, DASH_MS)) this.objets.dashDir.set(client.sessionId, input.x || input.y ? input : { x: fx, y: fy });
      });

      this.setSimulationInterval((dt) => this.moveAll(dt), MOVE_STEP_MS);
      this.clock.setInterval(() => this.gameHour(), heureMs);
    }

    // ---------- Monde : chargement, rattrapage, sauvegarde ----------

    loadOrCreate() {
      this.world = openWorld({ fichier, graine, bots, heureMs, rattrapageMaxJours, rythmeVie, taille, now: now() });
      const { sim, created, caughtUp } = this.world;
      if (created) log(`Nouvelle contrée : ${sim.name} (graine ${graine}, bots : ${bots}).`);
      else log(`Contrée ${sim.name} rechargée (jour ${sim.day}) ; ${caughtUp} heure(s) rattrapée(s).`);
    }

    get sim() { return this.world.sim; }
    get events() { return this.world.events; }
    get registry() { return this.world.registry; }

    save() {
      this.state.joueurs.forEach((p) => savePlayer(this, p));
      saveWorld(fichier, snapshotWorld(this.world, now()));
    }

    // Une heure de jeu : on verse l'activité des vrais joueurs dans la simulation, puis on avance.
    gameHour() {
      for (const [sid, act] of this.activity) {
        const name = this.state.joueurs.get(sid)?.nom;
        if (!name) continue;
        for (const id of act.zones) {
          const z = this.sim.zones[id];
          z.today.visits += 1;
          z.today.visitors.push(name);
        }
        // Chaque monstre vaincu compte comme une heure de combat (plafonné, pour ne pas écraser l'équilibre).
        for (const [id, kills] of act.kills) {
          const z = this.sim.zones[id];
          z.today.fights += Math.min(kills, KILLS_PER_HOUR_CAP);
          z.today.fighters.push(name);
        }
        // L'heure suivante commence là où le joueur se trouve.
        const p = this.state.joueurs.get(sid);
        act.zones = new Set([this.zoneOf(p)]);
        savePlayer(this, p);
        act.kills = new Map();
      }
      const dayBefore = this.sim.day;
      this.advance();
      this.syncState();
      if (this.sim.day !== dayBefore) {
        this.broadcast('chronique', [this.dayChronicle(dayBefore)]);
        this.save();
      }
    }

    advance() {
      advanceWorld(this.world);
    }

    dayChronicle(day) {
      const start = this.events.find((e) => e.day === day && e.type === 'day_start');
      const lines = dayLines(this.events, day);
      return {
        jour: day,
        titre: start ? `${start.data.season}, ${start.data.weather}` : '',
        lignes: lines.length ? lines : ['Journée calme dans la contrée.'],
      };
    }

    syncState() {
      const s = this.state;
      s.jour = this.sim.day;
      s.heure = this.sim.tick % 24;
      s.saison = this.sim.season.name ?? SEASONS[seasonIndex(this.sim)].name;
      s.meteo = this.sim.season.weather ?? '';
      for (let i = 0; i < this.sim.zones.length; i++) this.syncZone(i);
      s.bois = this.sim.village.jobs.bucheron_mineur.stock.bois ?? 0;
      for (const [name, job] of Object.entries(this.sim.village.jobs)) {
        let m = s.metiers.get(name);
        if (!m) { m = new Metier(); s.metiers.set(name, m); }
        if (m.niveau !== job.level) m.niveau = job.level;
        if (m.satisfaction !== job.satisfaction) m.satisfaction = job.satisfaction;
      }
      this.syncQuests();
      this.syncVillage();
    }

    // Habitants, plans inventés et offrandes : ils ne changent qu'une fois par jour ou à une offrande.
    syncVillage() {
      const pop = this.sim.village.population;
      if (!pop) return;
      const byId = new Map(pop.people.map((q) => [q.id, q]));
      const people = pop.people.filter((q) => q.alive).map((q) => ({
        id: q.id, prenom: q.prenom, famille: q.famille, age: Math.min(255, q.age), metier: q.metier ?? '',
        talent: q.talent ?? '', traits: q.traits.join(', '),
        parents: q.parents.map((id) => byId.get(id)?.prenom).filter(Boolean).join(' et '),
        partenaire: q.partner ? byId.get(q.partner)?.prenom ?? '' : '',
        sortie: q.outing ? q.outing.zone : -1,
        motif: q.outing?.kind ?? '',
        blesse: (q.hurtUntil ?? 0) > this.sim.day,
      }));
      const key = (arr) => arr.map((h) => `${h.id}:${h.age}:${h.metier}:${h.talent}:${h.partenaire}:${h.sortie}:${h.blesse}`).join('|');
      if (key(people) !== key([...this.state.habitants])) {
        this.state.habitants.splice(0, this.state.habitants.length);
        for (const h of people) this.state.habitants.push(Object.assign(new Habitant(), h));
      }
      if (this.state.plans.length !== pop.plans.length) {
        this.state.plans.splice(0, this.state.plans.length);
        for (const plan of pop.plans) {
          const r = planRecipe(plan);
          this.state.plans.push(Object.assign(new Plan(), {
            id: r.id, nom: r.nom, effet: r.effet, slot: r.slot, niveau: r.niveau, prerequis: r.prerequis,
            requis: Object.entries(r.requis).map(([k, n]) => `${k}:${n}`).join(','), materiau: r.materiau, auteur: r.auteur ?? '',
          }));
        }
      }
      for (const [rare, n] of Object.entries(pop.rares)) if (this.state.offrandes.get(rare) !== n) this.state.offrandes.set(rare, n);
    }

    syncZone(i) {
      const z = this.sim.zones[i];
      const sz = this.state.zones[i];
      if (sz.p !== z.monsterPressure) sz.p = z.monsterPressure;
      if (sz.w !== z.pathWear) sz.w = z.pathWear;
      if (sz.c !== z.closed) sz.c = z.closed;
      const st = structuresSummary(z);
      if (sz.s !== st) sz.s = st;
    }

    // Le tableau des quêtes, avec l'avancement fait par les joueurs.
    syncQuests() {
      const list = this.sim.village.quests.map((q) => ({ id: q.id, texte: questText(q), zone: q.zone ?? -1, progres: questPercent(this, q) }));
      const key = (arr) => arr.map((q) => `${q.id}:${q.progres}:${q.texte}`).join('|');
      if (key(list) === key([...this.state.quetes])) return;
      this.state.quetes.splice(0, this.state.quetes.length);
      for (const q of list) {
        const sq = new Quete();
        Object.assign(sq, q);
        this.state.quetes.push(sq);
      }
    }

    // ---------- Joueurs ----------

    zoneOf(p) {
      return zoneIndexAt(p.x, p.y, this.sim.width, this.sim.height);
    }

    staticWorld() {
      return {
        nom: this.sim.name,
        graine: this.sim.seed,
        signature: this.sim.signature,
        largeur: this.sim.width,
        hauteur: this.sim.height,
        tuilesParZone: ZONE_TILES,
        village: this.sim.villageId,
        zones: this.sim.zones.map((z) => ({ biome: z.biome, label: z.label, village: z.isVillage, champ: z.isField })),
        recettes: RECETTES,
        anneesParJour: this.sim.village.population?.yearsPerDay ?? 1,
        version,
        rares: this.sim.signature.exclusives,
      };
    }

    onJoin(client, options) {
      let name = cleanName(options?.nom);
      const taken = new Set([...this.state.joueurs.values()].map((p) => p.nom));
      for (let i = 2; taken.has(name); i++) name = `${cleanName(options?.nom).slice(0, NAME_MAX - 2)} ${i}`;

      const v = this.sim.zones[this.sim.villageId];
      const p = new Joueur();
      p.nom = name;
      p.x = (v.x + 0.5) * ZONE_TILES + (this.clients.length % 3) - 1;
      p.y = (v.y + 0.5) * ZONE_TILES + 1.5;
      p.dir = 'bas';
      p.bouge = false;
      p.attaque = 0;
      p.couleur = colorOf(name);
      p.pv = PLAYER_PV;
      p.pvMax = PLAYER_PV;
      p.aTerre = false;
      p.touche = 0;
      p.action = '';
      p.roulade = 0;
      p.talisman = 0;
      restorePlayer(this, p);
      this.state.joueurs.set(client.sessionId, p);
      this.inputs.set(client.sessionId, { x: 0, y: 0 });
      this.activity.set(client.sessionId, { zones: new Set([this.zoneOf(p)]), kills: new Map() });

      client.send('monde', this.staticWorld());
      const recent = [];
      for (let d = Math.max(1, this.sim.day - 3); d < this.sim.day; d++) recent.push(this.dayChronicle(d));
      client.send('chronique', recent);

      const known = this.registry[name];
      if (!known) {
        // Première venue : une maison au village, protégée.
        v.structures.push({ type: `maison de ${name}`, condition: 100, protected: true });
        client.send('bienvenue', { nom: name, contree: this.sim.name });
      } else if (known.lastDay < this.sim.day) {
        client.send('absence', {
          depuis: known.lastDay,
          jusqua: this.sim.day,
          lignes: summarySince(this.events, known.lastDay),
        });
      }
      this.registry[name] = { ...(this.registry[name] ?? {}), lastDay: this.sim.day };
      log(`${name} arrive (${this.clients.length} connecté·e·s).`);
    }

    onLeave(client) {
      const p = this.state.joueurs.get(client.sessionId);
      if (p) {
        savePlayer(this, p);
        this.registry[p.nom].lastDay = this.sim.day;
        log(`${p.nom} s'en va.`);
      }
      this.state.joueurs.delete(client.sessionId);
      this.inputs.delete(client.sessionId);
      this.activity.delete(client.sessionId);
      this.lastAttack.delete(client.sessionId);
      for (const m of ['downAt', 'regenAt', 'lastInteract']) this.play[m].delete(client.sessionId);
      for (const m of ['lastEat', 'lastDash', 'dashUntil', 'dashDir']) this.objets[m].delete(client.sessionId);
    }

    moveAll(dt) {
      const W = this.sim.width * ZONE_TILES;
      const H = this.sim.height * ZONE_TILES;
      for (const [sid, p] of this.state.joueurs) {
        const dashing = !p.aTerre && isDashing(this, sid);
        let input = p.aTerre ? { x: 0, y: 0 } : this.inputs.get(sid) ?? { x: 0, y: 0 };
        if (dashing) input = this.objets.dashDir.get(sid) ?? input;
        const moving = input.x !== 0 || input.y !== 0;
        if (p.bouge !== moving) p.bouge = moving;
        if (!moving) continue;
        const factor = (dashing ? DASH_FACTOR : 1) * (p.bottes ? BOOTS_FACTOR : 1);
        const next = stepPosition(p.x, p.y, input, dt, factor);
        next.x = Math.max(0.4, Math.min(W - 0.4, next.x));
        next.y = Math.max(0.4, Math.min(H - 0.4, next.y));
        // Une zone fermée par la neige ne se traverse pas : on bloque axe par axe.
        const blocked = (x, y) => this.sim.zones[zoneIndexAt(x, y, this.sim.width, this.sim.height)].closed;
        if (!blocked(next.x, p.y)) p.x = next.x;
        if (!blocked(p.x, next.y)) p.y = next.y;
        p.dir = Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut');
        this.activity.get(sid)?.zones.add(this.zoneOf(p));
      }
      updateGameplay(this, dt);
      updatePnj(this, dt);
      updateObjets(this);
      // L'action de la touche E dépend de l'endroit : recalculée quatre fois par seconde.
      const t = Date.now();
      if (t - this.lastActions >= 250) {
        this.lastActions = t;
        updateActions(this);
        this.syncQuests();
      }
    }

    attack(client) {
      const t = Date.now(); // délai réel entre deux coups, indépendant de l'horloge du monde
      if (t - (this.lastAttack.get(client.sessionId) ?? 0) < ATTACK_COOLDOWN_MS) return;
      this.lastAttack.set(client.sessionId, t);
      playerAttack(this, client.sessionId, t);
    }

    onBeforeShutdown() {
      this.save();
      this.disconnect();
    }

    onDispose() {
      this.save();
    }
  };
}
