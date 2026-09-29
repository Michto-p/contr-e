// Saisons : cycle de 28 jours (7 par saison). Effets globaux sur la croissance, les monstres,
// l'accès à certaines zones. Une météo du jour, tirée au sort, colore la chronique.

export const SEASON_LENGTH = 7;
export const SEASONS = [
  { name: 'printemps', growth: 1.2, monsterRate: 1.0, weather: ['douceur', 'averses', 'brume', 'soleil', 'douceur', 'soleil'] },
  { name: 'été', growth: 1.0, monsterRate: 1.1, weather: ['soleil', 'chaleur', 'soleil', 'grand beau', 'chaleur', 'soleil', 'orage'] },
  { name: 'automne', growth: 0.7, monsterRate: 1.2, weather: ['pluie', 'vent', 'brume', 'pluie', 'grisaille', 'vent', 'orage'] },
  { name: 'hiver', growth: 0.3, monsterRate: 0.7, weather: ['neige', 'gel', 'grand froid', 'neige'] },
];

export function seasonIndex(state, day = state.day) {
  const d = (day - 1 + state.season.startOffset) % (SEASON_LENGTH * SEASONS.length);
  return Math.floor(d / SEASON_LENGTH);
}

// L'hiver ferme les hauteurs et les confins de la contrée.
const closesInWinter = (z) => !z.isVillage && (z.biome === 'montagne' || z.dist >= 5);

export function seasons(state, rng, ctx) {
  if (!ctx.dayStart) return [];
  const events = [];
  const idx = seasonIndex(state);
  const season = SEASONS[idx];
  const first = state.season.name === undefined;
  const changed = !first && state.season.index !== idx;

  const d = (state.day - 1 + state.season.startOffset) % (SEASON_LENGTH * SEASONS.length);
  Object.assign(state.season, {
    index: idx,
    name: season.name,
    dayInSeason: (d % SEASON_LENGTH) + 1,
    growth: season.growth,
    monsterRate: season.monsterRate,
    weather: rng.pick(season.weather),
  });

  if (changed) events.push(ctx.event('season_change', null, { season: season.name }));

  // Ouverture / fermeture des zones.
  const winter = season.name === 'hiver';
  const toggled = [];
  for (const z of state.zones) {
    const shouldClose = winter && closesInWinter(z);
    if (z.closed !== shouldClose) {
      z.closed = shouldClose;
      toggled.push(z);
    }
  }
  if (toggled.length) {
    events.push(ctx.event(winter ? 'zones_closed' : 'zones_opened', null, {
      labels: [...new Set(toggled.filter((z) => z.dist <= 5).map((z) => z.label))],
      count: toggled.length,
    }));
  }

  events.push(ctx.event('day_start', null, {
    season: season.name, dayInSeason: state.season.dayInSeason, weather: state.season.weather,
  }));
  return events;
}
