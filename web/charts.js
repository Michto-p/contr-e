// Courbes jour par jour (SVG) : axe unique 0–100, traits de 2 px, point final entouré,
// réticule qui se cale sur le jour le plus proche, clic pour afficher ce jour sur la carte.
import { svg, el, showTip, hideTip } from './ui.js';

const H = 200;
const M = { top: 10, right: 92, bottom: 24, left: 30 };

export function drawLegend(container, series) {
  container.replaceChildren();
  for (const s of series) {
    const item = el('span', { class: 'item' }, container);
    const key = svg('svg', { width: 16, height: 8, 'aria-hidden': 'true' }, item);
    svg('line', { x1: 1, y1: 4, x2: 15, y2: 4, stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round' }, key);
    item.appendChild(document.createTextNode(s.label));
  }
}

// series : [{ label, color, values: number[] (un par jour) }]
export function drawLineChart(container, { series, selectedDay, onSelect, unit = '' }) {
  container.replaceChildren();
  const days = series[0].values.length;
  const W = Math.max(280, container.clientWidth || 480);
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (d) => M.left + (days === 1 ? iw / 2 : ((d - 1) / (days - 1)) * iw);
  const y = (v) => M.top + ih - (v / 100) * ih;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);

  // Grille discrète : traits fins et pleins.
  const grid = svg('g', { class: 'grid' }, root);
  const axis = svg('g', { class: 'axis' }, root);
  for (const v of [0, 25, 50, 75, 100]) {
    if (v > 0) svg('line', { x1: M.left, x2: M.left + iw, y1: y(v), y2: y(v) }, grid);
    const t = svg('text', { x: M.left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, axis);
    t.textContent = v;
  }
  svg('line', { class: 'baseline', x1: M.left, x2: M.left + iw, y1: y(0), y2: y(0) }, root);
  const step = Math.max(1, Math.ceil(days / 8));
  for (let d = 1; d <= days; d += step) {
    const t = svg('text', { x: x(d), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, axis);
    t.textContent = `j${d}`;
  }

  // Jour affiché sur la carte.
  const band = Math.max(6, days > 1 ? iw / (days - 1) : 20);
  svg('rect', { class: 'selected', x: x(selectedDay) - band / 2, y: M.top, width: band, height: ih }, root);

  // Courbes.
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i + 1)},${y(v)}`).join(' ');
    svg('polyline', { class: 'series', points: pts, stroke: s.color }, root);
    svg('circle', { class: 'end', cx: x(days), cy: y(s.values[days - 1]), r: 4, fill: s.color }, root);
  }

  // Étiquettes directes en bout de courbe, seulement si elles ne se chevauchent pas.
  const ends = series.map((s) => ({ s, yy: y(s.values[days - 1]) })).sort((a, b) => a.yy - b.yy);
  let lastY = -Infinity;
  for (const { s, yy } of ends) {
    if (yy - lastY < 13) continue;
    const t = svg('text', { class: 'label', x: x(days) + 9, y: yy + 4 }, root);
    t.textContent = s.label;
    lastY = yy;
  }

  // Couche de survol : toute la zone de tracé est la cible.
  const cross = svg('line', { class: 'cross', y1: M.top, y2: M.top + ih, visibility: 'hidden' }, root);
  const hit = svg('rect', { x: M.left - 10, y: 0, width: iw + 20, height: H, fill: 'transparent', tabindex: 0 }, root);
  hit.setAttribute('aria-label', 'Survoler pour lire les valeurs, cliquer pour afficher ce jour');
  const dayAt = (clientX) => {
    const r = root.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    if (days === 1) return 1;
    return Math.max(1, Math.min(days, Math.round(((px - M.left) / iw) * (days - 1)) + 1));
  };
  const show = (d, cx, cy) => {
    cross.setAttribute('x1', x(d));
    cross.setAttribute('x2', x(d));
    cross.setAttribute('visibility', 'visible');
    const rows = [{ title: `Jour ${d}` }];
    const sorted = [...series].sort((a, b) => b.values[d - 1] - a.values[d - 1]);
    for (const s of sorted) rows.push({ key: s.label, value: `${s.values[d - 1]}${unit}`, color: s.color });
    showTip(rows, cx, cy);
  };
  hit.addEventListener('pointermove', (e) => show(dayAt(e.clientX), e.clientX, e.clientY));
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  hit.addEventListener('click', (e) => onSelect(dayAt(e.clientX)));
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') onSelect(Math.max(1, selectedDay - 1));
    else if (e.key === 'ArrowRight') onSelect(Math.min(days, selectedDay + 1));
    else return;
    e.preventDefault();
  });
}
