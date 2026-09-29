// Carte de la contrée : une case par zone. Un calque colore une seule mesure ;
// le terrain est toujours donné par un glyphe (pas par la couleur).
import { svg, el, cssVar, isDark, rampColor, luminance, PRESSURE_RAMP, PATH_RAMP, showTip, hideTip } from './ui.js';

const CELL = 40;

export const BIOME = {
  foret: { glyph: '♣', name: 'forêt' },
  plaine: { glyph: '·', name: 'prés' },
  colline: { glyph: '∩', name: 'collines' },
  marais: { glyph: '≈', name: 'marais' },
  montagne: { glyph: '▲', name: 'hauteurs' },
};

// Paliers d'état d'une structure : couleur de statut + libellé (jamais la couleur seule).
export function structureStatus(condition, building = false) {
  if (building) return { label: 'en chantier', color: 'var(--card)', building: true };
  if (condition < 1) return { label: 'en ruine', color: 'var(--critical)', ruin: true };
  if (condition < 25) return { label: 'menace de s\'effondrer', color: 'var(--critical)' };
  if (condition < 50) return { label: 'abîmée', color: 'var(--warning)' };
  return { label: 'en bon état', color: 'var(--good)' };
}

function pressureWord(p) {
  if (p < 30) return 'calme';
  if (p < 50) return 'agitée';
  if (p < 70) return 'menaçante';
  return 'infestée';
}

function pathWord(w) {
  if (w >= 40) return 'sentier tracé';
  if (w > 0) return 'trace';
  return 'aucun';
}

function cellFill(zone, snap, layer) {
  const mode = isDark() ? 'dark' : 'light';
  if (zone.isVillage || layer === 'terrain') return cssVar('--card-2');
  if (layer === 'chemins') return snap.w > 0 ? rampColor(PATH_RAMP[mode], snap.w) : cssVar('--card-2');
  return rampColor(PRESSURE_RAMP[mode], snap.p);
}

function inkFor(fill) {
  const hex = fill.startsWith('#') ? fill : '#888888';
  return luminance(hex) > 0.35 ? '#2b2620' : '#fffaf0';
}

function house(g, x, y, ink) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  svg('path', {
    d: `M${cx - 9} ${cy + 8} V${cy - 1} L${cx} ${cy - 9} L${cx + 9} ${cy - 1} V${cy + 8} Z M${cx - 3} ${cy + 8} V${cy + 2} H${cx + 3} V${cy + 8}`,
    fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linejoin': 'round',
  }, g);
}

function wheat(g, x, y, ink) {
  for (const dx of [-7, 0, 7]) {
    const cx = x + CELL / 2 + dx;
    const cy = y + CELL / 2;
    svg('line', { x1: cx, y1: cy + 8, x2: cx, y2: cy - 4, stroke: ink, 'stroke-width': 1.5, 'stroke-linecap': 'round' }, g);
    svg('ellipse', { cx, cy: cy - 6, rx: 2, ry: 3.5, fill: ink }, g);
  }
}

// Décrit une zone pour l'infobulle.
function zoneRows(zone, snap, acts) {
  const rows = [{ title: zone.isVillage ? 'Le village' : zone.label.charAt(0).toUpperCase() + zone.label.slice(1) }];
  if (zone.isVillage) {
    rows.push({ note: 'Zone sûre : les monstres n\'y entrent pas, les maisons y sont protégées.' });
  } else {
    rows.push({ key: `Monstres (${pressureWord(snap.p)})`, value: `${snap.p} / 100` });
    rows.push({ key: `Chemin (${pathWord(snap.w)})`, value: snap.w });
    rows.push({ key: 'Végétation', value: snap.v });
    rows.push({ key: 'Terrain', value: zone.isField ? 'champs' : BIOME[zone.biome].name });
  }
  for (const s of snap.s) rows.push({ key: s.t, value: `${structureStatus(s.c, s.b).label} (${s.c})` });
  if (zone.exclusives.length) rows.push({ note: `Gisement rare : ${zone.exclusives.join(', ')}` });
  if (snap.c) rows.push({ note: 'Fermée par la neige jusqu\'au printemps.' });
  if (acts.length) rows.push({ note: `Joueurs ce jour-là : ${acts.map((a) => `${a.who} (${a.what})`).join(', ')}` });
  return rows;
}

export function drawMap(svgRoot, world, snap, activity, layer) {
  const { width, height } = world;
  svgRoot.replaceChildren();
  svgRoot.setAttribute('viewBox', `0 0 ${width * CELL} ${height * CELL}`);

  const defs = svg('defs', {}, svgRoot);
  const hatch = svg('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: cssVar('--hatch'), 'stroke-width': 2 }, hatch);

  for (const zone of world.zones) {
    const z = snap.zones[zone.id];
    const x = zone.x * CELL;
    const y = zone.y * CELL;
    const g = svg('g', { class: 'cell' }, svgRoot);
    const fill = cellFill(zone, z, layer);
    // 2 px d'écart entre les cases : c'est le fond qui les sépare, pas un trait.
    svg('rect', { class: 'tile', x: x + 1, y: y + 1, width: CELL - 2, height: CELL - 2, rx: 4, fill }, g);
    if (z.c) svg('rect', { x: x + 1, y: y + 1, width: CELL - 2, height: CELL - 2, rx: 4, fill: 'url(#hatch)' }, g);

    const ink = inkFor(fill);
    if (zone.isVillage) house(g, x, y, ink);
    else if (zone.isField) wheat(g, x, y, ink);
    else {
      const t = svg('text', {
        x: x + CELL / 2, y: y + CELL / 2 + (layer === 'terrain' ? 6 : 5), 'text-anchor': 'middle',
        'font-size': layer === 'terrain' ? 18 : 14, fill: ink, opacity: layer === 'terrain' ? 0.85 : 0.55,
      }, g);
      t.textContent = BIOME[zone.biome].glyph;
    }

    // Structures exposées : un losange coloré selon l'état (une croix si ruine).
    if (z.s.length) {
      const built = z.s.filter((s) => !s.b);
      const st = built.length ? structureStatus(Math.min(...built.map((s) => s.c))) : structureStatus(0, true);
      const cx = x + CELL - 9;
      const cy = y + 9;
      // Chantier : losange creux cerclé d'encre ; ruine : croix ; sinon losange plein de la couleur d'état.
      const hollow = st.ruin || st.building;
      svg('path', { d: `M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`, fill: hollow ? cssVar('--card') : st.color, stroke: st.building ? cssVar('--fg') : cssVar('--ring'), 'stroke-width': 1.5 }, g);
      if (st.ruin) {
        svg('path', { d: `M${cx - 3} ${cy - 3} L${cx + 3} ${cy + 3} M${cx + 3} ${cy - 3} L${cx - 3} ${cy + 3}`, stroke: st.color, 'stroke-width': 1.8, 'stroke-linecap': 'round' }, g);
      }
    }

    // Joueurs actifs ce jour-là : un point (et leur nombre s'ils sont plusieurs).
    const acts = activity.get(zone.id) ?? [];
    if (acts.length) {
      const names = new Set(acts.map((a) => a.who));
      svg('circle', { cx: x + 9, cy: y + CELL - 9, r: 4.5, fill: cssVar('--fg'), stroke: cssVar('--ring'), 'stroke-width': 2 }, g);
      if (names.size > 1) {
        const t = svg('text', { x: x + 16, y: y + CELL - 5, 'font-size': 10, 'font-weight': 700, fill: ink }, g);
        t.textContent = names.size;
      }
    }

    // Cible de survol : la case entière.
    const rows = () => zoneRows(zone, z, acts);
    g.addEventListener('pointermove', (e) => showTip(rows(), e.clientX, e.clientY));
    g.addEventListener('pointerleave', hideTip);
  }
}

function icon(parent, draw) {
  const s = svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, parent);
  draw(s);
  return s;
}

export function drawMapLegend(container, layer) {
  container.replaceChildren();
  const mode = isDark() ? 'dark' : 'light';
  if (layer !== 'terrain') {
    const stops = (layer === 'chemins' ? PATH_RAMP : PRESSURE_RAMP)[mode];
    const item = el('span', { class: 'item' }, container);
    el('span', {}, item, layer === 'chemins' ? 'Usure des chemins  0' : 'Pression des monstres  0');
    el('span', { class: 'ramp', style: `background:linear-gradient(90deg, ${stops.join(', ')})` }, item);
    el('span', {}, item, '100');
  } else {
    for (const b of Object.values(BIOME)) el('span', { class: 'item' }, container, `${b.glyph} ${b.name}`);
  }
  const status = [
    ['var(--good)', 'structure en bon état'], ['var(--warning)', 'abîmée'], ['var(--critical)', 'menace ruine'],
  ];
  for (const [color, label] of status) {
    const item = el('span', { class: 'item' }, container);
    icon(item, (s) => svg('path', { d: 'M8 2 L14 8 L8 14 L2 8 Z', fill: color }, s));
    item.appendChild(document.createTextNode(label));
  }
  const site = el('span', { class: 'item' }, container);
  icon(site, (s) => svg('path', { d: 'M8 2 L14 8 L8 14 L2 8 Z', fill: cssVar('--card'), stroke: cssVar('--fg'), 'stroke-width': 1.5 }, s));
  site.appendChild(document.createTextNode('chantier'));
  const players = el('span', { class: 'item' }, container);
  icon(players, (s) => svg('circle', { cx: 8, cy: 8, r: 4.5, fill: cssVar('--fg') }, s));
  players.appendChild(document.createTextNode('joueurs présents'));
  const closed = el('span', { class: 'item' }, container);
  icon(closed, (s) => {
    const d = svg('defs', {}, s);
    const p = svg('pattern', { id: 'hatch-legend', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d);
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: cssVar('--hatch'), 'stroke-width': 2 }, p);
    svg('rect', { x: 1, y: 1, width: 14, height: 14, rx: 3, fill: 'url(#hatch-legend)' }, s);
  });
  closed.appendChild(document.createTextNode('fermée par la neige'));
}
