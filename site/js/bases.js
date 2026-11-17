// Base systems (data/bases.yaml, docs/DESIGN.md "Bases"): which bases a result and a
// statement belong to. Shared by the build (statements' _bases) and the viewer (the
// results, including the validated proposals it adds itself).

// the bases with their defaults filled from the reductions
export function fillBases(bases, reductions) {
  const R = new Map(reductions.map((r) => [r.id, r]));
  return (bases || []).map((b) => {
    const r = R.get(b.reduction || b.id) || {};
    return { ...b, reduction: b.reduction || b.id, name: b.name || r.name, short: b.short || r.short, tex: b.tex || r.tex,
      description: b.description || r.description, properties: b.properties || [] };
  });
}

// does the result involve a third-order statement?
const third = (res, order) => [res.from, res.to, res.statement, res.base].some((id) => id && order(id) === 3);

// the bases of a result. order(id): the order of a statement (2 or 3); group(p): the group of a property
export function resultBases(res, bases, order, group) {
  const t = third(res, order);
  const fits = (b) => !b.order || (b.order === 3) === t;
  if (res.type === 'property') { const g = group(res.property); return bases.filter((b) => fits(b) && b.properties.includes(g)).map((b) => b.id); }
  if (res.type === 'conservation') return bases.filter((b) => fits(b) && b.conservation).map((b) => b.id);
  const over = [].concat(res.over || []);
  return bases.filter((b) => fits(b) && over.includes(b.reduction)).map((b) => b.id);
}

