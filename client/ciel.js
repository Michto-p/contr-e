// Ambiance du ciel, calculée par chaque navigateur : la nuit qui tombe (avec les lumières du
// village, des feux de camp et des lanternes), l'aube et le crépuscule, la pluie, l'orage, la neige,
// la brume et le vent, selon l'heure et la météo du monde.

// Obscurité visée selon l'heure de jeu (0 : plein jour).
const NIGHT = [0.62, 0.62, 0.62, 0.62, 0.58, 0.45, 0.25, 0.08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.28, 0.42, 0.52, 0.58, 0.62];
const WARM_HOURS = new Set([6, 7, 18, 19]);

const RAIN = { averses: 90, pluie: 140, orage: 230 };

export function createSky() {
  return { dark: null, drops: [], flakes: [], leaves: [], flash: 0, nextFlash: 0, layer: null };
}

function rand(a, b) { return a + Math.random() * (b - a); }

function layerFor(sky, w, h) {
  if (!sky.layer) sky.layer = document.createElement('canvas');
  if (sky.layer.width !== w || sky.layer.height !== h) { sky.layer.width = w; sky.layer.height = h; }
  return sky.layer;
}

// Les particules vivent en coordonnées écran ; elles se renouvellent en haut quand elles sortent.
function updateParticles(list, count, w, h, make, dt) {
  while (list.length < count) list.push(make(true));
  if (list.length > count) list.length = count;
  const s = dt / 1000;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.x += p.vx * s;
    p.y += p.vy * s;
    if (p.y > h + 10 || p.x < -20 || p.x > w + 20) list[i] = make(false);
  }
}

// `lights` : [{ x, y, r, warm }] en pixels écran.
export function drawSky(ctx, sky, { width: w, height: h, heure, meteo = '', saison = '', lights = [], dt = 16, t = 0 }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const target = NIGHT[heure] ?? 0;
  sky.dark = sky.dark == null ? target : sky.dark + (target - sky.dark) * Math.min(1, dt / 1500);
  const dark = sky.dark;
  const unit = Math.max(1, h / 300); // échelle des effets, selon la taille de l'écran

  // Teintes : aube et crépuscule dorés, chaleur, gel, grisaille.
  if (WARM_HOURS.has(heure)) { ctx.fillStyle = 'rgba(255, 140, 60, 0.09)'; ctx.fillRect(0, 0, w, h); }
  if (meteo === 'chaleur') { ctx.fillStyle = 'rgba(255, 200, 90, 0.07)'; ctx.fillRect(0, 0, w, h); }
  if (meteo === 'gel' || meteo === 'grand froid') { ctx.fillStyle = 'rgba(170, 210, 255, 0.12)'; ctx.fillRect(0, 0, w, h); }
  if (meteo === 'grisaille' || RAIN[meteo]) { ctx.fillStyle = 'rgba(90, 100, 115, 0.12)'; ctx.fillRect(0, 0, w, h); }

  // Nuit : un voile sombre, percé par les lumières.
  if (dark > 0.02) {
    const layer = layerFor(sky, w, h);
    const lc = layer.getContext('2d');
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, w, h);
    lc.fillStyle = `rgba(10, 16, 44, ${dark})`;
    lc.fillRect(0, 0, w, h);
    lc.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const flicker = l.warm ? 1 + Math.sin(t / 90 + l.x) * 0.04 : 1;
      const r = l.r * flicker;
      const g = lc.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.6)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.drawImage(layer, 0, 0);
    // Halo chaud des feux et des fenêtres.
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.warm) continue;
      const r = l.r * 0.6;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      g.addColorStop(0, `rgba(255, 170, 70, ${0.28 * dark})`);
      g.addColorStop(1, 'rgba(255, 170, 70, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Brume : de grandes nappes pâles qui dérivent.
  if (meteo === 'brume') {
    for (let i = 0; i < 5; i++) {
      const x = ((t / 60 + i * 280) % (w + 400)) - 200;
      const y = h * (0.15 + i * 0.18);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 260 * unit);
      g.addColorStop(0, 'rgba(230, 235, 240, 0.28)');
      g.addColorStop(1, 'rgba(230, 235, 240, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 260 * unit, y - 260 * unit, 520 * unit, 520 * unit);
    }
  }

  // Pluie et orage.
  const rain = RAIN[meteo] ?? 0;
  updateParticles(sky.drops, rain, w, h, (anywhere) => ({ x: rand(-20, w + 20), y: anywhere ? rand(-h, h) : rand(-60, -5), vx: -90 * unit, vy: rand(600, 800) * unit }), dt);
  if (rain) {
    ctx.strokeStyle = 'rgba(190, 210, 235, 0.55)';
    ctx.lineWidth = Math.max(1, unit * 0.6);
    ctx.beginPath();
    for (const d of sky.drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 3 * unit, d.y + 14 * unit); }
    ctx.stroke();
  }
  if (meteo === 'orage') {
    if (t > sky.nextFlash) { sky.flash = 1; sky.nextFlash = t + rand(7000, 18000); }
    if (sky.flash > 0.01) {
      ctx.fillStyle = `rgba(235, 240, 255, ${sky.flash * 0.55})`;
      ctx.fillRect(0, 0, w, h);
      sky.flash *= Math.pow(0.02, dt / 1000);
    }
  }

  // Neige.
  const snow = meteo === 'neige' ? 120 : saison === 'hiver' && meteo === 'grand froid' ? 40 : 0;
  updateParticles(sky.flakes, snow, w, h, (anywhere) => ({ x: rand(0, w), y: anywhere ? rand(-h, h) : rand(-30, -5), vx: rand(-20, 20) * unit, vy: rand(30, 70) * unit, r: rand(1, 2.4) * unit }), dt);
  if (snow) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const f of sky.flakes) {
      f.x += Math.sin(t / 700 + f.r * 10) * 0.3;
      ctx.fillRect(f.x, f.y, f.r, f.r);
    }
  }

  // Vent : des feuilles emportées.
  const wind = meteo === 'vent' ? 18 : 0;
  updateParticles(sky.leaves, wind, w, h, (anywhere) => ({ x: anywhere ? rand(0, w) : -10, y: rand(0, h), vx: rand(160, 260) * unit, vy: rand(-20, 30) * unit, c: Math.random() < 0.5 ? '#c9822f' : '#9aa83a' }), dt);
  for (const l of sky.leaves) {
    ctx.fillStyle = l.c;
    ctx.fillRect(l.x, l.y + Math.sin(t / 200 + l.x / 30) * 4 * unit, 3 * unit, 2 * unit);
  }
}
