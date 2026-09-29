// Vie d'ambiance, calculée par chaque navigateur (elle ne pèse pas sur le jeu) :
// des villageois qui vont et viennent, des lapins qui détalent, des oiseaux au-dessus des bois.
import { ZONE_TILES } from './shared/monde.js';
import { TILE } from './render.js';

const FAMILLE_COULEURS = ['#8f5a3a', '#3b6d8f', '#7d4f8a', '#4f7d4a', '#a4473a', '#b8863a', '#3a8f86', '#6a6a8f'];

function familyColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return FAMILLE_COULEURS[h % FAMILLE_COULEURS.length];
}

function rand(a, b) { return a + Math.random() * (b - a); }

export function createAmbiance(monde) {
  const W = monde.largeur;
  const v = { x: monde.village % W, y: Math.floor(monde.village / W) };
  const vx0 = v.x * ZONE_TILES;
  const vy0 = v.y * ZONE_TILES;
  // Les villageois sont les vrais habitants de la simulation (voir syncVillagers).
  return { monde, villagers: new Map(), village: { x0: vx0 + 1, y0: vy0 + 1, x1: vx0 + ZONE_TILES - 1, y1: vy0 + ZONE_TILES - 1 }, rabbits: [], birds: [], nextSpawn: 0 };
}

function zoneAt(amb, x, y) {
  const W = amb.monde.largeur;
  const zx = Math.floor(x / ZONE_TILES);
  const zy = Math.floor(y / ZONE_TILES);
  if (zx < 0 || zy < 0 || zx >= W || zy >= amb.monde.hauteur) return null;
  return { info: amb.monde.zones[zy * W + zx], index: zy * W + zx };
}

// Les habitants synchronisés par le serveur : on garde leur position d'affichage d'une image à l'autre.
function syncVillagers(amb, state) {
  const seen = new Set();
  state.habitants?.forEach((h) => {
    if (state.pnj?.has(`g${h.id}`)) return; // un garde en patrouille est dessiné par le serveur
    seen.add(h.id);
    let v = amb.villagers.get(h.id);
    if (!v) {
      v = { x: rand(amb.village.x0, amb.village.x1), y: rand(amb.village.y0, amb.village.y1), tx: 0, ty: 0, wait: rand(0, 3000) };
      amb.villagers.set(h.id, v);
    }
    v.h = h;
    v.color = familyColor(h.famille);
  });
  for (const id of amb.villagers.keys()) if (!seen.has(id)) amb.villagers.delete(id);
}

export function nearestVillager(amb, me, max = 1.5) {
  let best = null;
  let bestD = max;
  for (const v of amb.villagers.values()) {
    const d = Math.hypot(v.x - me.x, v.y - me.y);
    if (d < bestD) { bestD = d; best = v.h; }
  }
  return best;
}

export function updateAmbiance(amb, dt, me, t, state) {
  const s = dt / 1000;
  syncVillagers(amb, state);
  // Villageois : marchent d'un point à l'autre de la place, s'arrêtent, repartent.
  const W = amb.monde.largeur;
  for (const p of amb.villagers.values()) {
    // Un habitant parti en sortie marche jusqu'à la zone visée ; le soir, il rentre au village.
    // Arrivé au travail, il s'affaire autour de son coin (champ, coupe, pâture).
    if (p.h.sortie >= 0) {
      const cx = ((p.h.sortie % W) + 0.5) * ZONE_TILES + ((p.h.id % 5) - 2);
      const cy = (Math.floor(p.h.sortie / W) + 0.5) * ZONE_TILES + ((p.h.id % 3) - 1);
      if (p.out !== p.h.sortie) { p.out = p.h.sortie; p.tx = 0; p.arrived = false; }
      if (!p.arrived && Math.hypot(cx - p.x, cy - p.y) < 0.5) { p.arrived = true; p.wait = rand(500, 2500); }
      let gx = cx;
      let gy = cy;
      let speed = 2.6;
      if (p.arrived) {
        if (p.wait > 0) { p.wait -= dt; continue; }
        if (!p.tx) { p.tx = cx + rand(-3, 3); p.ty = cy + rand(-2.5, 2.5); }
        gx = p.tx;
        gy = p.ty;
        speed = 1.1;
      }
      const dx = gx - p.x;
      const dy = gy - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.2) {
        p.x += (dx / d) * speed * s;
        p.y += (dy / d) * speed * s;
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'droite' : 'gauche') : (dy > 0 ? 'bas' : 'haut');
      } else if (p.arrived) { p.tx = 0; p.wait = rand(1500, 4000); }
      continue;
    }
    if (p.out !== undefined) { p.out = undefined; p.tx = 0; p.wait = 0; }
    const outside = p.x < amb.village.x0 - 1 || p.x > amb.village.x1 + 1 || p.y < amb.village.y0 - 1 || p.y > amb.village.y1 + 1;
    if (outside && !p.tx) { p.tx = rand(amb.village.x0, amb.village.x1); p.ty = rand(amb.village.y0, amb.village.y1); p.wait = 0; }
    const speed = outside ? 2.6 : p.h.age < 8 ? 1.6 : p.h.age >= 62 ? 0.6 : 1.2; // les enfants courent, les anciens flânent
    if (p.wait > 0) { p.wait -= dt; continue; }
    if (!p.tx) { p.tx = rand(amb.village.x0, amb.village.x1); p.ty = rand(amb.village.y0, amb.village.y1); }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) { p.tx = 0; p.wait = rand(1000, 4000); continue; }
    p.x += (dx / d) * speed * s;
    p.y += (dy / d) * speed * s;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'droite' : 'gauche') : (dy > 0 ? 'bas' : 'haut');
  }

  // Lapins et oiseaux apparaissent autour du joueur, dans les zones calmes.
  if (t > amb.nextSpawn) {
    amb.nextSpawn = t + 1500;
    const x = me.x + rand(-10, 10);
    const y = me.y + rand(-7, 7);
    const z = zoneAt(amb, x, y);
    const calm = z && state.zones[z.index] && state.zones[z.index].p < 50 && !state.zones[z.index].c;
    if (calm && !z.info.village && amb.rabbits.length < 6 && (z.info.biome === 'plaine' || z.info.biome === 'colline')) {
      amb.rabbits.push({ x, y, vx: 0, vy: 0, hop: 0, life: 20000 });
    }
    if (z && z.info.biome === 'foret' && amb.birds.length < 3 && Math.random() < 0.5) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      amb.birds.push({ x: me.x - dir * 12, y: me.y + rand(-6, 6), vx: dir * rand(4, 6), life: 6000 });
    }
  }
  for (const r of amb.rabbits) {
    r.life -= dt;
    const d = Math.hypot(r.x - me.x, r.y - me.y);
    if (d < 3.5) { // détale
      r.vx = ((r.x - me.x) / (d || 1)) * 6;
      r.vy = ((r.y - me.y) / (d || 1)) * 6;
    } else if (Math.random() < 0.01) {
      r.vx = rand(-1.5, 1.5);
      r.vy = rand(-1.5, 1.5);
    }
    r.x += r.vx * s;
    r.y += r.vy * s;
    r.vx *= 0.96;
    r.vy *= 0.96;
    r.hop += dt;
  }
  amb.rabbits = amb.rabbits.filter((r) => r.life > 0 && Math.hypot(r.x - me.x, r.y - me.y) < 18);
  for (const b of amb.birds) { b.x += b.vx * s; b.life -= dt; }
  amb.birds = amb.birds.filter((b) => b.life > 0);
}

function px(ctx, color, x, y, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// L'outil de son métier : fourche, hache, houlette. Au travail sur place, il s'agite.
function drawTool(ctx, metier, x, y, t) {
  const swing = t ? (Math.sin(t / 180) > 0 ? -2 : 0) : 0;
  if (metier === 'agriculteur') {
    px(ctx, '#8a6a3a', x + 5, y - 8 + swing, 1, 11);
    px(ctx, '#bfc4c9', x + 4, y - 10 + swing, 3, 1);
    px(ctx, '#bfc4c9', x + 4, y - 12 + swing, 1, 2);
    px(ctx, '#bfc4c9', x + 6, y - 12 + swing, 1, 2);
  } else if (metier === 'bucheron_mineur') {
    px(ctx, '#8a6a3a', x + 5, y - 7 + swing, 1, 9);
    px(ctx, '#bfc4c9', x + 6, y - 7 + swing, 3, 3);
  } else if (metier === 'eleveur') {
    px(ctx, '#8a6a3a', x + 5, y - 10, 1, 13);
    px(ctx, '#8a6a3a', x + 6, y - 11, 2, 1);
  }
}

// Dessin au sol (avant les personnages) : villageois et lapins.
export function drawAmbianceGround(ctx, amb, t) {
  for (const p of amb.villagers.values()) {
    const x = p.x * TILE;
    const walking = p.wait <= 0;
    const y = p.y * TILE - (walking ? Math.abs(Math.sin(t / 110 + p.x)) : 0);
    const age = p.h.age;
    const k = age < 8 ? 0.55 : age < 16 ? 0.8 : 1; // taille selon l'âge
    const elder = age >= 62;
    px(ctx, 'rgba(0,0,0,0.25)', x - 4 * k, p.y * TILE + 4, 8 * k, 2);
    px(ctx, '#3a2f28', x - 3 * k, y + 2 * k, 2, 3 * k);
    px(ctx, '#3a2f28', x + 1 * k, y + 2 * k, 2, 3 * k);
    px(ctx, p.color, x - 4 * k, y - 4 * k, 8 * k, 7 * k);
    if (!age || age >= 16) px(ctx, '#efe2c4', x - 4 * k, y + 1 * k, 8 * k, 2); // tablier
    px(ctx, '#f1c8a0', x - 3 * k, y - 10 * k, 6 * k, 6 * k);
    px(ctx, elder ? '#d9d4ca' : age < 16 ? '#6b4a2b' : '#c9b27a', x - 4 * k, y - 11 * k, 8 * k, 2); // cheveux blancs, ou chapeau
    if (elder) px(ctx, '#6b4a2b', x + 5, y - 3, 1, 9); // canne
    if (p.h.sortie >= 0 && p.h.motif === 'defense') { px(ctx, '#d9d4ca', x + 5, y - 9, 1, 8); px(ctx, '#6b4a2b', x + 4, y - 2, 3, 1); } // une épée
    if (p.h.sortie >= 0 && p.h.motif === 'travail') drawTool(ctx, p.h.metier, x, y, p.wait > 0 ? t : 0);
    if (p.arrived && p.h.motif === 'travail' && p.h.metier === 'eleveur') {
      // Le troupeau paît autour de l'éleveur.
      for (let k = 0; k < 3; k++) {
        const sx = x + Math.cos(k * 2.1 + p.h.id) * 22;
        const sy = p.y * TILE + Math.sin(k * 2.1 + p.h.id) * 14;
        px(ctx, 'rgba(0,0,0,0.2)', sx - 5, sy + 4, 10, 2);
        px(ctx, '#f2efe6', sx - 5, sy - 4, 10, 7);
        px(ctx, '#3a2f28', sx + (k % 2 ? 4 : -7), sy - 3, 3, 3);
        px(ctx, '#3a2f28', sx - 3, sy + 3, 1, 2);
        px(ctx, '#3a2f28', sx + 2, sy + 3, 1, 2);
      }
    }
    if (p.h.blesse) { px(ctx, '#ffffff', x - 3 * k, y - 9 * k, 6 * k, 1); px(ctx, '#e5635c', x, y - 9 * k, 1, 1); } // un bandage
  }
  for (const r of amb.rabbits) {
    const hopping = Math.hypot(r.vx, r.vy) > 0.5;
    const x = r.x * TILE;
    const y = r.y * TILE - (hopping ? Math.abs(Math.sin(r.hop / 70)) * 3 : 0);
    px(ctx, '#c9b8a0', x - 3, y - 2, 6, 4);
    px(ctx, '#c9b8a0', x + 1, y - 5, 1, 3);
    px(ctx, '#c9b8a0', x + 3, y - 5, 1, 3);
    px(ctx, '#ffffff', x - 4, y - 1, 1, 1);
  }
}

// Dessin en l'air (après les personnages) : oiseaux et leur ombre.
export function drawAmbianceSky(ctx, amb, t) {
  for (const b of amb.birds) {
    const x = b.x * TILE;
    const y = b.y * TILE;
    const wing = Math.sin(t / 80) > 0 ? -2 : 1;
    px(ctx, 'rgba(0,0,0,0.15)', x - 2, y + 18, 4, 2);
    ctx.strokeStyle = '#2b2620';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + wing);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 4, y + wing);
    ctx.stroke();
  }
}
