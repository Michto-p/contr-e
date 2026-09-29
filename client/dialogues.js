// Ce que disent les habitants quand on leur parle : leur vie, leur talent, leur caractère,
// et ce qui se passe au village en ce moment. Tout vient de l'état partagé par le serveur.

const METIER = {
  agriculteur: 'travaille aux champs',
  boulanger: 'tient le fournil',
  forgeron: 'travaille à la forge',
  bucheron_mineur: 'coupe le bois et descend à la mine',
  eleveur: 'élève les bêtes',
  enseignant: "fait l'école aux enfants",
  garde: 'monte la garde',
  ancien: 'profite de ses vieux jours',
  '': 'joue sur la place',
};

const TALENT = {
  forestier: 'Je connais chaque arbre du bois : je sais lesquels abattre pour ouvrir un passage, et je replante derrière moi.',
  agronome: 'Avec l\'éleveur, on pourrait défricher un pré de plus, s\'il fallait nourrir plus de monde.',
  inventeur: 'Rapportez-moi ce qu\'on trouve au loin. Ces matériaux inconnus, j\'en ferais quelque chose de neuf.',
  bouvier: 'Mes bêtes engraissent les champs : c\'est pour ça que le blé pousse si bien ici.',
  'maître des levains': 'Mon levain a trois générations. On me l\'a transmis, je le transmettrai.',
  érudit: 'Les enfants apprennent vite. Ils iront plus loin que nous.',
  "maître d'armes": 'Une lance bien tenue vaut trois épées mal maniées. Je l\'apprends aux jeunes qui veulent garder le village.',
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const ARTICLE = {
  cristal: 'le cristal', ambre: "l'ambre", 'soie sauvage': 'la soie sauvage', 'sel gemme': 'le sel gemme',
  'fer noir': 'le fer noir', 'résine dorée': 'la résine dorée', 'perles de marais': 'les perles de marais',
};

function traitLine(h, ctx) {
  const traits = h.traits.split(', ');
  const t = pick(traits);
  const couple = ctx.habitants.filter((x) => x.partenaire && x.prenom < x.partenaire);
  const rare = pick(ctx.rares ?? ['']);
  switch (t) {
    case 'bavard':
      return couple.length ? (() => { const c = pick(couple); return `Vous savez que ${c.prenom} et ${c.partenaire} ont uni leurs vies ? Tout le village en parle.`; })()
        : 'Ici, tout se sait. Et ce qui ne se sait pas encore, je le devine.';
    case 'curieux': {
      if (!rare) return 'Il y a tant de choses que je ne comprends pas encore.';
      const plural = rare.endsWith('s');
      return `On dit que ${ARTICLE[rare] ?? rare} ne se ${plural ? 'trouvent' : 'trouve'} que dans notre contrée. Je me demande ce qu'on en ferait ailleurs.`;
    }
    case 'prudent': return 'Ne sortez jamais seul dans les zones infestées. À plusieurs, on revient.';
    case 'audacieux': return 'Si j\'avais une bonne lame, j\'irais moi-même nettoyer les hauteurs !';
    case 'rêveur': return 'Parfois je rêve des contrées au-delà des montagnes. Est-ce qu\'elles nous ressemblent ?';
    case 'têtu': return 'On fait comme ça depuis toujours, et ça marche. Pourquoi changer ?';
    case 'patient': return 'Tout pousse, avec le temps. Les arbres, les enfants, et même la paix.';
    case 'travailleur': return 'Pas le temps de bavarder, il y a de l\'ouvrage !';
    default: return 'Belle journée, n\'est-ce pas ?';
  }
}

function situationLine(ctx) {
  const mouths = Math.ceil(ctx.habitants.length / 2);
  if (ctx.pain < mouths) return 'Le pain se fait rare… Sans champs gardés, pas de farine, et pas d\'enfants non plus.';
  const patrol = ctx.quetes.find((q) => q.texte.startsWith('une patrouille') || q.texte.startsWith('des patrouilles'));
  if (patrol) return `Au village, on cherche ${patrol.texte}. Les bêtes rôdent trop près.`;
  if (ctx.saison === 'hiver') return 'L\'hiver ferme les hauteurs. On vit sur les réserves en attendant le dégel.';
  return null;
}

// Au travail, loin du village.
const WORK_LINES = {
  agriculteur: ['Il faut surveiller ces champs : une nuit de bêtes, et la moitié de la récolte y passe.', 'La terre est bonne ici. Tant qu\'on la garde, elle nous nourrira.'],
  bucheron_mineur: ['Chaque arbre abattu ici, c\'est une maison ou un avant-poste au village.', 'On ne s\'aventure pas plus loin sans un avant-poste pour se replier.'],
  garde: ['Je tiens ce coin tant que les paysans travaillent. À plusieurs, on le tiendrait mieux.', 'Si vous voyez un voyageur égaré, ramenez-le : le village a besoin de bras.'],
  eleveur: ['Les bêtes aiment ce pré. Tant que les monstres restent loin, elles engraissent.', 'Un avant-poste par ici, et je pourrais mener le troupeau plus loin.'],
};

// Réplique complète d'un habitant (plusieurs phrases).
export function talk(h, ctx) {
  const who = `${h.prenom} ${h.famille}, ${h.age} an${h.age > 1 ? 's' : ''}, ${METIER[h.metier] ?? METIER['']}`;
  const lines = [];
  if (!h.metier && h.parents) lines.push(`Je suis l'enfant de ${h.parents}. Plus tard, je ferai comme eux… ou autre chose !`);
  if (h.partenaire && h.metier) lines.push(`Je partage ma vie avec ${h.partenaire}.`);
  if (h.talent && TALENT[h.talent]) lines.push(TALENT[h.talent]);
  if (h.sortie >= 0 && (h.motif === 'travail' || h.motif === 'garde')) lines.push(pick(WORK_LINES[h.metier] ?? ['Du travail, il y en a toujours.']));
  const situation = situationLine(ctx);
  if (situation && Math.random() < 0.6) lines.push(situation);
  lines.push(traitLine(h, ctx));
  return { titre: who, lignes: lines.slice(0, 3) };
}
