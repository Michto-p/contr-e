// Outils communs de la page : création SVG/DOM, infobulle, rampes de couleur.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function el(tag, attrs = {}, parent = null, text = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (v != null) node.setAttribute(k, v);
  }
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const isDark = () => cssVar('color-scheme') === 'dark';

// ---------- Infobulle ----------
// Contenu construit avec textContent : les libellés viennent des données.
const tip = () => document.getElementById('tip');

// rows : [{ title }, { key, value, color? }, { note }]
export function showTip(rows, clientX, clientY) {
  const t = tip();
  t.replaceChildren();
  for (const r of rows) {
    if (r.title) el('div', { class: 't-title' }, t, r.title);
    else if (r.note) el('div', { class: 't-note' }, t, r.note);
    else {
      const row = el('div', { class: 't-row' }, t);
      const k = el('span', { class: 'k' }, row);
      if (r.color) el('span', { class: 'swatch', style: `background:${r.color}` }, k);
      k.appendChild(document.createTextNode(r.key));
      el('span', { class: 'v' }, row, String(r.value));
    }
  }
  t.hidden = false;
  const pad = 14;
  const { width, height } = t.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + width > window.innerWidth - 8) x = clientX - width - pad;
  if (y + height > window.innerHeight - 8) y = clientY - height - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

export function hideTip() {
  tip().hidden = true;
}

// ---------- Couleurs ----------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Interpolation dans une rampe d'une seule teinte (valeur 0–100).
export function rampColor(stops, value) {
  const t = Math.max(0, Math.min(1, value / 100)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const f = t - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Pression des monstres : une seule teinte (rouge-orangé), du quasi-fond au plus sombre.
export const PRESSURE_RAMP = {
  light: ['#f3e9df', '#ffc4b2', '#ffa186', '#ff7f5e', '#f4613d', '#db4a26', '#ba3e1e', '#953922', '#6c3629'],
  dark: ['#302a25', '#4a2c22', '#6c3629', '#953922', '#ba3e1e', '#db4a26', '#f4613d', '#ff7f5e', '#ffa186'],
};

// Usure des chemins : la rampe bleue séquentielle.
export const PATH_RAMP = {
  light: ['#e8eef4', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#104281', '#0d366b'],
  dark: ['#29303a', '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
};
