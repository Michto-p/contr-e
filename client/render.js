// Rendu Canvas 2D façon 16 bits, sans image : tout est dessiné avec des formes simples.
// Le terrain de chaque zone est dessiné une fois dans un petit canvas, puis agrandi sans lissage.
import { ZONE_TILES } from './shared/monde.js';

export const TILE = 16;
const ZONE_PX = ZONE_TILES * TILE;

const TUNIQUES = ['#d9534f', '#3b7dd8', '#e0a458', '#8e5bd6', '#2fa37a', '#d65c9e', '#5bb7d6', '#b8b84a'];

// Petit hachage déterministe : le décor d'une tuile ne change jamais.
function hash(x, y, k = 0) {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function px(ctx, color, x, y, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// ---------- Terrain ----------

function grass(ctx, tx, ty, ox, oy, base, dark, light) {
  px(ctx, base, ox, oy, TILE, TILE);
  for (let i = 0; i < 3; i++) {
    const r = hash(tx, ty, i);
    const x = ox + Math.floor(r * 14) + 1;
    const y = oy + Math.floor(hash(ty, tx, i + 7) * 13) + 2;
    px(ctx, dark, x, y, 1, 2);
    px(ctx, light, x + 1, y - 1, 1, 1);
  }
}

const TERRAIN = {
  plaine(ctx, tx, ty, ox, oy) {
    grass(ctx, tx, ty, ox, oy, '#7ec850', '#5fa83a', '#a6e070');
    const r = hash(tx, ty, 11);
    if (r < 0.06) { px(ctx, '#f4e06d', ox + 6, oy + 7, 2, 2); px(ctx, '#fff6c2', ox + 6, oy + 7); }
    else if (r < 0.1) { px(ctx, '#e87ba4', ox + 10, oy + 4, 2, 2); }
  },
  foret(ctx, tx, ty, ox, oy) {
    grass(ctx, tx, ty, ox, oy, '#4f9a3c', '#3c7f2e', '#6cb552');
    if (hash(tx, ty, 3) < 0.5) {
      px(ctx, '#6b4a2b', ox + 7, oy + 10, 2, 5);
      ctx.fillStyle = '#2f6f2c';
      ctx.beginPath(); ctx.arc(ox + 8, oy + 8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f8a36';
      ctx.beginPath(); ctx.arc(ox + 6, oy + 6, 3, 0, Math.PI * 2); ctx.fill();
    }
  },
  colline(ctx, tx, ty, ox, oy) {
    grass(ctx, tx, ty, ox, oy, '#a3b35a', '#8a9a44', '#c2cf7a');
    const r = hash(tx, ty, 5);
    if (r < 0.35) {
      ctx.fillStyle = '#8e9c48';
      ctx.beginPath(); ctx.ellipse(ox + 8, oy + 11, 7, 4, 0, Math.PI, 0); ctx.fill();
      px(ctx, '#b9c66c', ox + 5, oy + 8, 5, 1);
    } else if (r < 0.45) {
      px(ctx, '#9a9480', ox + 5, oy + 9, 5, 4); px(ctx, '#c2bca8', ox + 5, oy + 9, 3, 1);
    }
  },
  marais(ctx, tx, ty, ox, oy) {
    grass(ctx, tx, ty, ox, oy, '#5b8a5e', '#4a7450', '#7aa576');
    const r = hash(tx, ty, 9);
    if (r < 0.4) {
      ctx.fillStyle = '#3f6f78';
      ctx.beginPath(); ctx.ellipse(ox + 8, oy + 9, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      px(ctx, '#6fa4ad', ox + 5, oy + 8, 4, 1);
    }
    if (hash(tx, ty, 10) < 0.35) {
      for (const dx of [2, 4, 13]) { px(ctx, '#8fae5a', ox + dx, oy + 3, 1, 6); px(ctx, '#6b4a2b', ox + dx, oy + 2, 1, 2); }
    }
  },
  montagne(ctx, tx, ty, ox, oy) {
    px(ctx, '#8f8a80', ox, oy, TILE, TILE);
    for (let i = 0; i < 3; i++) px(ctx, '#7c776e', ox + Math.floor(hash(tx, ty, i) * 14), oy + Math.floor(hash(ty, tx, i) * 14), 2, 1);
    if (hash(tx, ty, 4) < 0.45) {
      ctx.fillStyle = '#6f6a62';
      ctx.beginPath(); ctx.moveTo(ox + 1, oy + 15); ctx.lineTo(ox + 8, oy + 2); ctx.lineTo(ox + 15, oy + 15); ctx.fill();
      ctx.fillStyle = '#e8e4da';
      ctx.beginPath(); ctx.moveTo(ox + 6, oy + 6); ctx.lineTo(ox + 8, oy + 2); ctx.lineTo(ox + 10, oy + 6); ctx.fill();
    }
  },
};

function drawField(ctx, tx, ty, ox, oy) {
  px(ctx, '#b58a4a', ox, oy, TILE, TILE);
  for (let x = 1; x < TILE; x += 4) {
    px(ctx, '#e8c14a', ox + x, oy + 2, 2, 12);
    px(ctx, '#f7dc7a', ox + x, oy + 2, 1, 3);
  }
  if (hash(tx, ty, 2) < 0.1) px(ctx, '#7ec850', ox, oy, TILE, TILE);
}

function drawHouse(ctx, x, y, roof) {
  px(ctx, 'rgba(0,0,0,0.18)', x + 2, y + 14, 14, 3);
  px(ctx, '#efe2c4', x + 2, y + 7, 12, 8);
  ctx.fillStyle = roof;
  ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + 8, y + 1); ctx.lineTo(x + 16, y + 8); ctx.fill();
  px(ctx, '#6b4a2b', x + 7, y + 10, 3, 5);
  px(ctx, '#8fc3e8', x + 3, y + 9, 2, 2);
  px(ctx, '#8fc3e8', x + 11, y + 9, 2, 2);
}

function drawVillage(ctx, zx, zy) {
  for (let ty = 0; ty < ZONE_TILES; ty++) {
    for (let tx = 0; tx < ZONE_TILES; tx++) {
      const ox = tx * TILE;
      const oy = ty * TILE;
      px(ctx, '#d7c49e', ox, oy, TILE, TILE);
      px(ctx, '#c4b089', ox, oy + 15, TILE, 1);
      px(ctx, '#c4b089', ox + ((ty % 2) * 8), oy, 1, TILE);
    }
  }
  // Maisons autour d'une place et d'un puits.
  const roofs = ['#b5523b', '#8f5a3a', '#a4473a', '#7d6a4a'];
  const spots = [[1, 1], [4, 1], [8, 1], [1, 4], [9, 4], [1, 8], [4, 9], [8, 9], [10, 8]];
  spots.forEach(([tx, ty], i) => drawHouse(ctx, tx * TILE, ty * TILE, roofs[(i + zx + zy) % roofs.length]));
  const cx = 6 * TILE;
  const cy = 6 * TILE;
  ctx.fillStyle = '#8a8478';
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f6f78';
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
}

export function buildZoneCanvases(monde) {
  const canvases = [];
  monde.zones.forEach((z, i) => {
    const zx = i % monde.largeur;
    const zy = Math.floor(i / monde.largeur);
    const c = document.createElement('canvas');
    c.width = ZONE_PX;
    c.height = ZONE_PX;
    const ctx = c.getContext('2d');
    if (z.village) drawVillage(ctx, zx, zy);
    else {
      for (let ty = 0; ty < ZONE_TILES; ty++) {
        for (let tx = 0; tx < ZONE_TILES; tx++) {
          const gx = zx * ZONE_TILES + tx;
          const gy = zy * ZONE_TILES + ty;
          if (z.champ) drawField(ctx, gx, gy, tx * TILE, ty * TILE);
          else TERRAIN[z.biome](ctx, gx, gy, tx * TILE, ty * TILE);
        }
      }
    }
    canvases.push(c);
  });
  return canvases;
}

// ---------- Éléments dynamiques ----------

function drawPath(ctx, zx, zy, wear, village) {
  if (wear <= 0) return;
  // Le chemin relie le centre de la zone à la zone voisine en direction du village.
  const cx = (zx + 0.5) * ZONE_PX;
  const cy = (zy + 0.5) * ZONE_PX;
  const dx = Math.sign(village.x - zx);
  const dy = Math.sign(village.y - zy);
  ctx.strokeStyle = `rgba(201, 163, 106, ${0.35 + (wear / 100) * 0.6})`;
  ctx.lineWidth = 3 + Math.round((wear / 100) * 5);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dx * ZONE_PX, cy + dy * ZONE_PX);
  ctx.stroke();
}

function drawMonsters(ctx, zx, zy, pressure, t) {
  const n = Math.round(pressure / 12);
  for (let i = 0; i < n; i++) {
    const bx = (zx * ZONE_TILES + 1 + hash(zx, zy, i * 3) * (ZONE_TILES - 2)) * TILE;
    const by = (zy * ZONE_TILES + 1 + hash(zy, zx, i * 3 + 1) * (ZONE_TILES - 2)) * TILE;
    const bob = Math.sin(t / 300 + i * 1.7) * 1.5;
    const wander = Math.sin(t / 1300 + i) * 4;
    const x = bx + wander;
    const y = by + bob;
    px(ctx, 'rgba(0,0,0,0.25)', x - 5, y + 4, 10, 2);
    ctx.fillStyle = pressure >= 70 ? '#6d2a7a' : '#5a3d8a';
    ctx.beginPath(); ctx.ellipse(x, y, 6, 5, 0, Math.PI, 0); ctx.fill();
    px(ctx, ctx.fillStyle, x - 6, y, 12, 4);
    px(ctx, '#fff', x - 3, y - 2, 2, 2);
    px(ctx, '#fff', x + 1, y - 2, 2, 2);
    px(ctx, '#1c1814', x - 2, y - 1, 1, 1);
    px(ctx, '#1c1814', x + 2, y - 1, 1, 1);
  }
}

const STRUCT_SPOT = { 'tour de guet': [8, 3], pont: [5, 8], 'cabane de chasseur': [3, 3], palissade: [3, 8], 'vieux moulin': [8, 8] };

function drawStructure(ctx, zx, zy, type, cond, building) {
  const [tx, ty] = STRUCT_SPOT[type] ?? [6, 3];
  const x = (zx * ZONE_TILES + tx) * TILE;
  const y = (zy * ZONE_TILES + ty) * TILE;
  const ruin = cond <= 0 && !building;
  px(ctx, 'rgba(0,0,0,0.22)', x + 1, y + 14, 16, 3);
  if (building) {
    // Chantier : échafaudage.
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, y - 4 + (1 - cond / 75) * 10, 12, 18 - (1 - cond / 75) * 10);
    ctx.beginPath(); ctx.moveTo(x + 2, y + 14); ctx.lineTo(x + 14, y); ctx.stroke();
    px(ctx, '#a0968a', x + 3, y + 10, 10, 4);
    return;
  }
  if (ruin) {
    px(ctx, '#8a8478', x + 2, y + 10, 5, 4);
    px(ctx, '#a0968a', x + 8, y + 11, 6, 3);
    px(ctx, '#6f6a62', x + 5, y + 8, 3, 3);
    return;
  }
  switch (type) {
    case 'tour de guet':
      px(ctx, '#a0968a', x + 3, y - 6, 10, 20);
      px(ctx, '#8a8478', x + 3, y - 6, 2, 20);
      px(ctx, '#6f6a62', x + 2, y - 8, 12, 3);
      px(ctx, '#3a3530', x + 7, y - 2, 2, 3);
      break;
    case 'pont':
      px(ctx, '#3f6f78', x - 4, y + 2, 24, 12);
      for (let i = 0; i < 6; i++) px(ctx, i % 2 ? '#8a6a3a' : '#9f7d48', x - 4 + i * 4, y + 3, 4, 10);
      break;
    case 'palissade':
      for (let i = 0; i < 5; i++) { px(ctx, '#8a6a3a', x + i * 4, y + 2, 3, 12); px(ctx, '#6b4a2b', x + i * 4 + 1, y, 1, 2); }
      break;
    case 'vieux moulin':
      px(ctx, '#e6d8b8', x + 3, y + 2, 10, 12);
      ctx.strokeStyle = '#6b4a2b';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 2, y - 3); ctx.lineTo(x + 18, y + 11); ctx.moveTo(x + 18, y - 3); ctx.lineTo(x - 2, y + 11); ctx.stroke();
      break;
    default:
      drawHouse(ctx, x, y, '#6b4a2b');
  }
  if (cond < 50) {
    // Fissures : la structure a besoin d'entretien.
    ctx.strokeStyle = '#2b2620';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 5, y + 2); ctx.lineTo(x + 8, y + 6); ctx.lineTo(x + 6, y + 10); ctx.stroke();
  }
}

export function drawPlayer(ctx, p, t, attackAge) {
  const bob = p.bouge ? Math.abs(Math.sin(t / 90)) * 1.5 : 0;
  const x = p.dx * TILE;
  const y = p.dy * TILE - bob;
  const tunic = TUNIQUES[p.couleur % TUNIQUES.length];
  px(ctx, 'rgba(0,0,0,0.3)', x - 5, p.dy * TILE + 5, 10, 3);
  px(ctx, '#3a2f28', x - 4, y + 3, 3, 3); // jambes
  px(ctx, '#3a2f28', x + 1, y + 3, 3, 3);
  px(ctx, tunic, x - 5, y - 5, 10, 9); // tunique
  px(ctx, 'rgba(0,0,0,0.2)', x - 5, y + 2, 10, 2);
  px(ctx, '#f1c8a0', x - 4, y - 12, 8, 7); // tête
  px(ctx, '#6b4a2b', x - 4, y - 13, 8, 3); // cheveux
  if (p.dir !== 'haut') {
    const ex = p.dir === 'gauche' ? -3 : p.dir === 'droite' ? 1 : -2;
    px(ctx, '#1c1814', x + ex, y - 9, 1, 2);
    if (p.dir === 'bas') px(ctx, '#1c1814', x + 1, y - 9, 1, 2);
  } else {
    px(ctx, '#6b4a2b', x - 4, y - 12, 8, 5);
  }
  // Coup d'épée : un arc dans la direction du regard, 220 ms.
  if (attackAge < 220) {
    const a = { droite: 0, bas: Math.PI / 2, gauche: Math.PI, haut: -Math.PI / 2 }[p.dir] ?? 0;
    const k = attackAge / 220;
    ctx.strokeStyle = `rgba(255, 250, 230, ${1 - k})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y - 3, 12, a - 1.1 + k * 0.6, a + 1.1 - k * 0.6);
    ctx.stroke();
  }
}

// Dessine le monde vu par la caméra. `view` : { cx, cy, scale } en tuiles / pixels écran.
export function drawWorld(ctx, { monde, zoneCanvases, state, players, view, t, width, height }) {
  const { cx, cy, scale } = view;
  const W = monde.largeur;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1c1814';
  ctx.fillRect(0, 0, width, height);
  const unit = TILE * scale;
  ctx.setTransform(scale, 0, 0, scale, Math.round(width / 2 - cx * unit), Math.round(height / 2 - cy * unit));

  // Zones visibles seulement.
  const halfW = width / 2 / unit;
  const halfH = height / 2 / unit;
  const zx0 = Math.max(0, Math.floor((cx - halfW) / ZONE_TILES));
  const zx1 = Math.min(W - 1, Math.floor((cx + halfW) / ZONE_TILES));
  const zy0 = Math.max(0, Math.floor((cy - halfH) / ZONE_TILES));
  const zy1 = Math.min(monde.hauteur - 1, Math.floor((cy + halfH) / ZONE_TILES));
  const villageXY = { x: monde.village % W, y: Math.floor(monde.village / W) };
  const winter = state.saison === 'hiver';

  for (let zy = zy0; zy <= zy1; zy++) {
    for (let zx = zx0; zx <= zx1; zx++) {
      const i = zy * W + zx;
      ctx.drawImage(zoneCanvases[i], zx * ZONE_PX, zy * ZONE_PX);
    }
  }
  for (let zy = zy0; zy <= zy1; zy++) {
    for (let zx = zx0; zx <= zx1; zx++) {
      const i = zy * W + zx;
      const z = state.zones[i];
      if (!z) continue;
      const info = monde.zones[i];
      if (!info.village && !info.champ) drawPath(ctx, zx, zy, z.w, villageXY);
      if (winter) px(ctx, 'rgba(240, 246, 255, 0.32)', zx * ZONE_PX, zy * ZONE_PX, ZONE_PX, ZONE_PX);
      if (!info.village && z.p > 0) px(ctx, `rgba(70, 20, 80, ${(z.p / 100) * 0.28})`, zx * ZONE_PX, zy * ZONE_PX, ZONE_PX, ZONE_PX);
      for (const part of (z.s || '').split(';').filter(Boolean)) {
        const [type, cond, b] = part.split('|');
        drawStructure(ctx, zx, zy, type, Number(cond), b === '1');
      }
      if (!info.village) drawMonsters(ctx, zx, zy, z.p, t);
      if (z.c) {
        // Zone fermée : hachures de neige.
        ctx.save();
        ctx.beginPath(); ctx.rect(zx * ZONE_PX, zy * ZONE_PX, ZONE_PX, ZONE_PX); ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 3;
        for (let k = -ZONE_PX; k < ZONE_PX; k += 12) {
          ctx.beginPath(); ctx.moveTo(zx * ZONE_PX + k, zy * ZONE_PX); ctx.lineTo(zx * ZONE_PX + k + ZONE_PX, zy * ZONE_PX + ZONE_PX); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Joueurs, du haut vers le bas pour que les plus proches passent devant.
  const sorted = [...players].sort((a, b) => a.dy - b.dy);
  for (const p of sorted) drawPlayer(ctx, p, t, t - p.attackAt);

  // Noms en coordonnées écran (texte net).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${Math.max(11, Math.round(4.5 * scale))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (const p of sorted) {
    const sx = Math.round(width / 2 + (p.dx - cx) * unit);
    const sy = Math.round(height / 2 + (p.dy - cy) * unit - 16 * scale);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.85)';
    ctx.strokeText(p.nom, sx, sy);
    ctx.fillStyle = p.moi ? '#ffe28a' : '#fdf6e3';
    ctx.fillText(p.nom, sx, sy);
  }
}

// Mini-carte : une case par zone, teinte selon la pression des monstres.
export function drawMinimap(ctx, { monde, state, players }) {
  const W = monde.largeur;
  const cell = ctx.canvas.width / W;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  monde.zones.forEach((info, i) => {
    const z = state.zones[i];
    const x = (i % W) * cell;
    const y = Math.floor(i / W) * cell;
    let color;
    if (info.village) color = '#e0c98f';
    else {
      const p = z ? z.p / 100 : 0;
      color = `rgb(${Math.round(120 + p * 110)}, ${Math.round(170 - p * 130)}, ${Math.round(90 - p * 40)})`;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    if (z?.c) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1); }
  });
  for (const p of players) {
    ctx.fillStyle = p.moi ? '#ffe28a' : '#ffffff';
    ctx.beginPath();
    ctx.arc((p.dx / ZONE_TILES) * cell, (p.dy / ZONE_TILES) * cell, p.moi ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
