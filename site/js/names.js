// Author names in data/references/: "First Last", or "Last, First" when the surname has
// several words ("Le Houérou, Quentin", "Levy Patey, Ludovic"), as in BibTeX.
const SUFFIX = /,?\s+(Jr\.?|Sr\.?|III|II)$/;
// the surname: the part before the comma, else the last word (without Jr., III…)
export const surname = (a) => {
  const s = String(a || '').trim();
  const c = s.replace(SUFFIX, '').split(',').map((x) => x.trim()).filter(Boolean);
  return c.length > 1 ? c[0] : (c[0] || '').split(/\s+/).pop();
};
// the name as it is read: "Quentin Le Houérou"
export const fullName = (a) => {
  const s = String(a || '').trim();
  if (SUFFIX.test(s)) return s;
  const c = s.split(',').map((x) => x.trim()).filter(Boolean);
  return c.length === 2 ? `${c[1]} ${c[0]}` : c.join(', ');
};
