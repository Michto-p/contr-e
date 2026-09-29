// Une room Colyseus = une contrée. La simulation de l'étape 1 y tourne en continu :
// une heure de jeu toutes les `heureMs` millisecondes, que des joueurs soient connectés ou non.
// Les vrais joueurs pèsent sur le monde exactement comme les bots : leur présence dans une zone
// y freine les monstres, et combattre les fait reculer.
import { Room } from '@colyseus/core';
import { dayLines, summarySince, questText } from '../src/chronicle/chronicle.js';
import { SEASONS, seasonIndex } from '../src/sim/systems/seasons.js';
import { ZONE_TILES, MOVE_STEP_MS, zoneIndexAt, stepPosition } from '../shared/monde.js';
import { EtatContree, Joueur, Zone, Metier } from './schema.js';
import { openWorld, advanceWorld, snapshotWorld, saveWorld } from './persistence.js';

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
    rattrapageMaxJours = 7, now = () => Date.now(), log = () => {},
  } = config;

  return class ContreeRoom extends Room {
    maxClients = 20;
    autoDispose = false; // le monde vit même quand tout le monde est parti

    onCreate() {
      this.inputs = new Map(); // sessionId -> { x, y }
      this.activity = new Map(); // sessionId -> { zones: Set, fought: Set } pour l'heure en cours
      this.lastAttack = new Map();
      this.loadOrCreate();

      this.setState(new EtatContree());
      for (let i = 0; i < this.sim.zones.length; i++) this.state.zones.push(new Zone());
      this.syncState();

      this.onMessage('deplacement', (client, m) => {
        const x = Math.max(-1, Math.min(1, Number(m?.x) || 0));
        const y = Math.max(-1, Math.min(1, Number(m?.y) || 0));
        this.inputs.set(client.sessionId, { x, y });
      });
      this.onMessage('attaque', (client) => this.attack(client));

      this.setSimulationInterval((dt) => this.moveAll(dt), MOVE_STEP_MS);
      this.clock.setInterval(() => this.gameHour(), heureMs);
    }

    // ---------- Monde : chargement, rattrapage, sauvegarde ----------

    loadOrCreate() {
      this.world = openWorld({ fichier, graine, bots, heureMs, rattrapageMaxJours, now: now() });
      const { sim, created, caughtUp } = this.world;
      if (created) log(`Nouvelle contrée : ${sim.name} (graine ${graine}, bots : ${bots}).`);
      else log(`Contrée ${sim.name} rechargée (jour ${sim.day}) ; ${caughtUp} heure(s) rattrapée(s).`);
    }

    get sim() { return this.world.sim; }
    get events() { return this.world.events; }
    get registry() { return this.world.registry; }

    save() {
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
        for (const id of act.fought) {
          const z = this.sim.zones[id];
          z.today.fights += 1;
          z.today.fighters.push(name);
        }
        // L'heure suivante commence là où le joueur se trouve.
        const p = this.state.joueurs.get(sid);
        act.zones = new Set([this.zoneOf(p)]);
        act.fought = new Set();
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
      this.sim.zones.forEach((z, i) => {
        const sz = s.zones[i];
        if (sz.p !== z.monsterPressure) sz.p = z.monsterPressure;
        if (sz.w !== z.pathWear) sz.w = z.pathWear;
        if (sz.c !== z.closed) sz.c = z.closed;
        const st = structuresSummary(z);
        if (sz.s !== st) sz.s = st;
      });
      for (const [name, job] of Object.entries(this.sim.village.jobs)) {
        let m = s.metiers.get(name);
        if (!m) { m = new Metier(); s.metiers.set(name, m); }
        if (m.niveau !== job.level) m.niveau = job.level;
        if (m.satisfaction !== job.satisfaction) m.satisfaction = job.satisfaction;
      }
      const quests = this.sim.village.quests.map(questText);
      if (quests.join('\n') !== [...s.quetes].join('\n')) {
        s.quetes.splice(0, s.quetes.length);
        for (const q of quests) s.quetes.push(q);
      }
    }

    // ---------- Joueurs ----------

    zoneOf(p) {
      return zoneIndexAt(p.x, p.y, this.sim.width, this.sim.height);
    }

    staticWorld() {
      return {
        nom: this.sim.name,
        signature: this.sim.signature,
        largeur: this.sim.width,
        hauteur: this.sim.height,
        tuilesParZone: ZONE_TILES,
        village: this.sim.villageId,
        zones: this.sim.zones.map((z) => ({ biome: z.biome, label: z.label, village: z.isVillage, champ: z.isField })),
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
      this.state.joueurs.set(client.sessionId, p);
      this.inputs.set(client.sessionId, { x: 0, y: 0 });
      this.activity.set(client.sessionId, { zones: new Set([this.zoneOf(p)]), fought: new Set() });

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
      this.registry[name] = { lastDay: this.sim.day };
      log(`${name} arrive (${this.clients.length} connecté·e·s).`);
    }

    onLeave(client) {
      const p = this.state.joueurs.get(client.sessionId);
      if (p) {
        this.registry[p.nom] = { lastDay: this.sim.day };
        log(`${p.nom} s'en va.`);
      }
      this.state.joueurs.delete(client.sessionId);
      this.inputs.delete(client.sessionId);
      this.activity.delete(client.sessionId);
      this.lastAttack.delete(client.sessionId);
    }

    moveAll(dt) {
      const W = this.sim.width * ZONE_TILES;
      const H = this.sim.height * ZONE_TILES;
      for (const [sid, p] of this.state.joueurs) {
        const input = this.inputs.get(sid) ?? { x: 0, y: 0 };
        const moving = input.x !== 0 || input.y !== 0;
        if (p.bouge !== moving) p.bouge = moving;
        if (!moving) continue;
        const next = stepPosition(p.x, p.y, input, dt);
        next.x = Math.max(0.4, Math.min(W - 0.4, next.x));
        next.y = Math.max(0.4, Math.min(H - 0.4, next.y));
        // Une zone fermée par la neige ne se traverse pas : on bloque axe par axe.
        const blocked = (x, y) => this.sim.zones[zoneIndexAt(x, y, this.sim.width, this.sim.height)].closed;
        if (!blocked(next.x, p.y)) p.x = next.x;
        if (!blocked(p.x, next.y)) p.y = next.y;
        p.dir = Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'droite' : 'gauche') : (input.y > 0 ? 'bas' : 'haut');
        this.activity.get(sid)?.zones.add(this.zoneOf(p));
      }
    }

    attack(client) {
      const t = Date.now(); // délai réel entre deux coups, indépendant de l'horloge du monde
      if (t - (this.lastAttack.get(client.sessionId) ?? 0) < ATTACK_COOLDOWN_MS) return;
      this.lastAttack.set(client.sessionId, t);
      const p = this.state.joueurs.get(client.sessionId);
      if (!p) return;
      p.attaque = (p.attaque + 1) % 65536;
      const zone = this.sim.zones[this.zoneOf(p)];
      if (!zone.isVillage) this.activity.get(client.sessionId)?.fought.add(zone.id);
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
