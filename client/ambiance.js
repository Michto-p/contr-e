// Vie d'ambiance, calculée par chaque navigateur (elle ne pèse pas sur le jeu) :
// des villageois qui vont et viennent, des lapins qui détalent, des oiseaux au-dessus des bois.
import { ZONE_TILES } from './shared/monde.js';
import { TILE } from './render.js';

const VILLAGEOIS = ['#8f5a3a', '#3b6d8f', '#7d4f8a', '#4f7d4a', '#a4473a'];

function rand(a, b) { return a + Math.random() * (b - a); }

export function createAmbiance(monde) {
  const W = monde.largeur;
  const v = { x: monde.village % W, y: Math.floor(monde.village / W) };
  const vx0 = v.x * ZONE_TILES;
  const vy0 = v.y * ZONE_TILES;
  const villagers = VILLAGEOIS.map((color) => ({
    color, x: vx0 + rand(2, 10), y: vy0 + rand(2, 10), tx: 0, ty: 0, wait: rand(0, 2000),
  }));
  return { monde, villagers, village: { x0: vx0 + 1, y0: vy0 + 1, x1: vx0 + ZONE_TILES - 1, y1: vy0 + ZONE_TILES - 1 }, rabbits: [], birds: [], nextSpawn: 0 };
}

function zoneAt(amb, x, y) {
  const W = amb.monde.largeur;
  const zx = Math.floor(x / ZONE_TILES);
  const zy = Math.floor(y / ZONE_TILES);
  if (zx < 0 || zy < 0 || zx >= W || zy >= amb.monde.hauteur) return null;
  return { info: amb.monde.zones[zy * W + zx], index: zy * W + zx };
}

export function updateAmbiance(amb, dt, me, t, state) {
  const s = dt / 1000;
  // Villageois : marchent d'un point à l'autre de la place, s'arrêtent, repartent.
  for (const p of amb.villagers) {
    if (p.wait > 0) { p.wait -= dt; continue; }
    if (!p.tx) { p.tx = rand(amb.village.x0, amb.village.x1); p.ty = rand(amb.village.y0, amb.village.y1); }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) { p.tx = 0; p.wait = rand(1000, 4000); continue; }
    p.x += (dx / d) * 1.2 * s;
    p.y += (dy / d) * 1.2 * s;
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

// Dessin au sol (avant les personnages) : villageois et lapins.
export function drawAmbianceGround(ctx, amb, t) {
  for (const p of amb.villagers) {
    const x = p.x * TILE;
    const walking = p.wait <= 0;
    const y = p.y * TILE - (walking ? Math.abs(Math.sin(t / 110)) : 0);
    px(ctx, 'rgba(0,0,0,0.25)', x - 4, p.y * TILE + 4, 8, 2);
    px(ctx, '#3a2f28', x - 3, y + 2, 2, 3);
    px(ctx, '#3a2f28', x + 1, y + 2, 2, 3);
    px(ctx, p.color, x - 4, y - 4, 8, 7);
    px(ctx, '#efe2c4', x - 4, y + 1, 8, 2); // tablier
    px(ctx, '#f1c8a0', x - 3, y - 10, 6, 6);
    px(ctx, '#c9b27a', x - 4, y - 11, 8, 2); // chapeau de paille
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
