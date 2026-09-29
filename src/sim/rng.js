// PRNG déterministe (mulberry32). Tout l'aléatoire de la simulation passe par ici.
// `save()` renvoie l'état interne : createRng(rng.save()) reprend exactement la même suite.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    save: () => a,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Tirage pondéré : { a: 3, b: 1 } -> 'a' trois fois plus souvent que 'b'.
    weighted: (table) => {
      const entries = Object.entries(table);
      let r = next() * entries.reduce((sum, [, w]) => sum + w, 0);
      for (const [key, w] of entries) {
        r -= w;
        if (r < 0) return key;
      }
      return entries[entries.length - 1][0];
    },
  };
}
