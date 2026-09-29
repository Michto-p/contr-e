// Arbre des familles, partagé entre le jeu (client/) et la page de simulation (web/).
// Entrée : la liste des habitants, vivants et disparus, avec leurs parents et partenaire.

const METIER = {
  agriculteur: 'aux champs', boulanger: 'au fournil', forgeron: 'à la forge', bucheron_mineur: 'à la coupe et à la mine',
  eleveur: 'auprès des bêtes', enseignant: "à l'école", garde: 'à la garde', aventurier: 'aventurier', ancien: 'retraite',
};

// Racines : les fondateurs (sans parents connus). Un conjoint venu d'ailleurs apparaît à côté de
// son partenaire plutôt qu'en racine séparée.
export function buildTrees(people) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const childrenOf = new Map();
  for (const p of people) {
    for (const id of p.parents) {
      if (!childrenOf.has(id)) childrenOf.set(id, []);
      childrenOf.get(id).push(p);
    }
  }
  const hasParents = (p) => p.parents.some((id) => byId.has(id));
  // Lien de couple symétrique : au décès d'un conjoint, l'autre perd le lien, mais le couple a existé.
  const spouse = new Map();
  for (const p of people) {
    const q = p.partenaire ? byId.get(p.partenaire) : null;
    if (q) { spouse.set(p.id, q); if (!spouse.has(q.id)) spouse.set(q.id, p); }
  }
  // Chaque habitant a une seule place dans l'arbre ; son conjoint n'est rappelé qu'à côté de lui.
  const shown = new Set();
  function node(p) {
    shown.add(p.id);
    const partner = spouse.get(p.id) ?? null;
    const kids = new Map();
    for (const c of [...(childrenOf.get(p.id) ?? []), ...(partner ? childrenOf.get(partner.id) ?? [] : [])]) kids.set(c.id, c);
    const children = [...kids.values()].sort((a, b) => (a.ne ?? 0) - (b.ne ?? 0)).filter((c) => !shown.has(c.id)).map(node);
    return { person: p, partner, children };
  }
  const roots = [];
  for (const p of [...people].sort((a, b) => (a.ne ?? 0) - (b.ne ?? 0))) {
    if (shown.has(p.id) || hasParents(p)) continue;
    const partner = spouse.get(p.id) ?? null;
    // Conjoint venu d'ailleurs : il figure à côté de son partenaire, pas comme nouvelle famille.
    if (partner && (hasParents(partner) || shown.has(partner.id))) continue;
    roots.push(node(p));
  }
  // Familles les plus nombreuses d'abord.
  const size = (n) => 1 + (n.partner ? 1 : 0) + n.children.reduce((s, c) => s + size(c), 0);
  return roots.sort((a, b) => size(b) - size(a));
}

export function describe(p, today = null) {
  const bits = [];
  if (p.vivant) {
    bits.push(p.age === 0 ? 'nouveau-né' : `${p.age} an${p.age > 1 ? 's' : ''}`);
    if (p.metier && METIER[p.metier]) bits.push(METIER[p.metier]);
    else if (!p.metier) bits.push('enfant');
  } else {
    bits.push(`✝ ${p.mort != null ? `jour ${p.mort}` : ''}`.trim());
    if (p.metier && METIER[p.metier]) bits.push(METIER[p.metier]);
  }
  if (p.talent) bits.push(p.talent);
  void today;
  return `${p.prenom} ${p.famille} (${bits.join(', ')})`;
}

// Rendu en listes imbriquées (le texte passe par textContent).
export function renderTrees(container, trees, { maxDepth = 6 } = {}) {
  container.replaceChildren();
  const build = (n, depth) => {
    const li = document.createElement('li');
    const line = document.createElement('span');
    line.className = n.person.vivant ? 'vivant' : 'disparu';
    line.textContent = describe(n.person);
    li.appendChild(line);
    if (n.partner) {
      const partner = document.createElement('span');
      partner.className = n.partner.vivant ? 'vivant' : 'disparu';
      partner.textContent = ` ♥ ${describe(n.partner)}`;
      li.appendChild(partner);
    }
    if (n.children.length && depth < maxDepth) {
      const ul = document.createElement('ul');
      for (const c of n.children) ul.appendChild(build(c, depth + 1));
      li.appendChild(ul);
    }
    return li;
  };
  const ul = document.createElement('ul');
  ul.className = 'arbre';
  for (const t of trees) ul.appendChild(build(t, 0));
  container.appendChild(ul);
}
