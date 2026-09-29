// Compétences des personnages, partagées entre le serveur (qui décide) et l'écran de création.
// Un personnage a une classe (sa façon de se battre) et un métier (ce qu'il fait au village).
// La classe donne 60 points, le métier 40 : 100 points répartis d'office, plus 10 points libres
// que le joueur place où il veut. Certaines paires classe + métier cachent un « secret de classe »
// qui ajoute des points en plus : à chacun de les découvrir.

export const COMPETENCES = {
  force: { nom: 'Force', effet: '+1 dégât par tranche de 25' },
  endurance: { nom: 'Endurance', effet: '+1 point de vie par tranche de 10' },
  agilite: { nom: 'Agilité', effet: 'marche et roulade plus rapides' },
  survie: { nom: 'Survie', effet: 'on reprend des forces plus vite hors du village' },
  savoirFaire: { nom: 'Savoir-faire', effet: 'le métier rapporte plus, en jeu comme au village' },
  flair: { nom: 'Flair', effet: 'les monstres lâchent plus souvent du butin' },
};
export const SKILL_KEYS = Object.keys(COMPETENCES);

export const CLASSES = {
  guerrier: { nom: 'Guerrier', texte: 'Frappe fort et tient le choc.', points: { force: 25, endurance: 20, agilite: 5, survie: 5, flair: 5 } },
  gardien: { nom: 'Gardien', texte: 'Un roc : beaucoup de vie, peu de hâte.', points: { endurance: 30, force: 15, survie: 10, flair: 5 } },
  eclaireur: { nom: 'Éclaireur', texte: 'Vif, et l\'œil à tout ce qui brille.', points: { agilite: 30, flair: 15, survie: 10, force: 5 } },
  herboriste: { nom: 'Herboriste', texte: 'Connaît les plantes : récupère vite, fait mieux son métier.', points: { survie: 30, savoirFaire: 15, flair: 10, endurance: 5 } },
};

export const METIER_POINTS = {
  aventurier: { flair: 15, agilite: 10, survie: 10, force: 5 },
  agriculteur: { savoirFaire: 20, endurance: 15, survie: 5 },
  boulanger: { savoirFaire: 20, survie: 15, endurance: 5 },
  forgeron: { savoirFaire: 20, force: 15, endurance: 5 },
  bucheron_mineur: { savoirFaire: 15, force: 15, endurance: 10 },
  eleveur: { savoirFaire: 20, survie: 10, flair: 10 },
  garde: { force: 15, endurance: 15, savoirFaire: 10 },
};

export const FREE_POINTS = 10;

// Les secrets de classe : une classe et un métier qui vont bien ensemble.
export const SECRETS = [
  { classe: 'guerrier', metier: 'garde', nom: 'Rempart du village', bonus: { force: 10, endurance: 10 } },
  { classe: 'gardien', metier: 'forgeron', nom: 'Cuirasse de forge', bonus: { endurance: 20 } },
  { classe: 'gardien', metier: 'eleveur', nom: 'Berger des collines', bonus: { endurance: 10, survie: 10 } },
  { classe: 'eclaireur', metier: 'bucheron_mineur', nom: 'Pas du forestier', bonus: { agilite: 10, savoirFaire: 10 } },
  { classe: 'eclaireur', metier: 'aventurier', nom: 'Chemins oubliés', bonus: { flair: 20 } },
  { classe: 'herboriste', metier: 'boulanger', nom: 'Pain de guérison', bonus: { survie: 10, savoirFaire: 10 } },
  { classe: 'herboriste', metier: 'agriculteur', nom: 'Main verte', bonus: { savoirFaire: 15, survie: 5 } },
];

export const secretOf = (classe, metier) => SECRETS.find((s) => s.classe === classe && s.metier === metier) ?? null;

// Points de base (classe + métier), avant les points libres et le secret.
export function basePoints(classe, metier) {
  const out = Object.fromEntries(SKILL_KEYS.map((k) => [k, 0]));
  for (const src of [CLASSES[classe]?.points, METIER_POINTS[metier]]) {
    for (const [k, v] of Object.entries(src ?? {})) out[k] += v;
  }
  return out;
}

// Compétences finales. `libres` : { force: 3, flair: 7 } (10 points au plus, entiers positifs).
// Lève une erreur lisible si le choix n'est pas valable.
export function computeSkills(classe, metier, libres = {}) {
  if (!CLASSES[classe]) throw new Error('Classe inconnue.');
  if (!METIER_POINTS[metier]) throw new Error('Métier inconnu.');
  const skills = basePoints(classe, metier);
  let spent = 0;
  for (const [k, raw] of Object.entries(libres ?? {})) {
    const v = Number(raw);
    if (!SKILL_KEYS.includes(k) || !Number.isInteger(v) || v < 0) throw new Error('Points libres invalides.');
    skills[k] += v;
    spent += v;
  }
  if (spent > FREE_POINTS) throw new Error(`${FREE_POINTS} points libres au plus.`);
  const secret = secretOf(classe, metier);
  if (secret) for (const [k, v] of Object.entries(secret.bonus)) skills[k] += v;
  return { skills, secret: secret?.nom ?? '' };
}

// ---------- Effets en jeu ----------
export const pvBonus = (c) => Math.floor((c?.endurance ?? 0) / 10);
export const damageBonus = (c) => Math.floor((c?.force ?? 0) / 25);
export const speedFactor = (c) => 1 + Math.min(60, c?.agilite ?? 0) / 200; // jusqu'à +30 %
export const regenFactor = (c) => 1 - Math.min(0.6, (c?.survie ?? 0) / 100); // délai de récupération
export const lootFactor = (c) => 1 + (c?.flair ?? 0) / 60;
export const woodPerCut = (metier, c) => (metier === 'bucheron_mineur' ? 1 + Math.floor((c?.savoirFaire ?? 0) / 20) : 1);
export const breadHeal = (metier, c) => 4 + (metier === 'boulanger' ? Math.floor((c?.savoirFaire ?? 0) / 10) : 0) + Math.floor((c?.survie ?? 0) / 30);
// Faim et fatigue (0–100) : jamais mortelles, mais elles pèsent.
export const TIRED = 70; // au-delà : on marche moins vite et on frappe moins fort
export const HUNGRY = 70; // au-delà : on ne reprend plus de forces tout seul
export const needsSpeed = (p) => ((p?.fatigue ?? 0) >= TIRED ? 0.85 : 1) * ((p?.faim ?? 0) >= 90 ? 0.9 : 1);
// Au village, quand on ne le joue pas : le bonus de savoir-faire dans son métier (0,1 à ~0,4).
export const villageBonus = (c) => 0.1 + Math.min(80, c?.savoirFaire ?? 30) / 100 * 0.4;
