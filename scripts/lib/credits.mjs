// data/credits.yaml: what researchers' messages changed in the database, counted in
// the badges of their name (site/js/badges.js; entity `credit` in scripts/lib/schema.mjs).
// Used by scripts/review.mjs when a contributed fact is accepted; tested in
// tests/badges.test.mjs.
import fs from 'node:fs';
import YAML from 'yaml';

export const CREDITS = 'data/credits.yaml';
const HEADER = '# What researchers\' messages changed in the database (badges). See scripts/lib/schema.mjs, entity credit.\n';

// a statement label in plain text (TeX of data/statements/*.yaml → Unicode, roughly)
export function plainLabel(tex) {
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', '+': '⁺', '*': '*' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', n: 'ₙ', k: 'ₖ' };
  const map = (s, t) => ([...s].every((ch) => t[ch]) ? [...s].map((ch) => t[ch]).join('') : null);
  let s = String(tex)
    .replace(/\\mathbb\{N\}/g, 'ℕ').replace(/\\mathbb\{R\}/g, 'ℝ')
    .replace(/\\(?:mathsf|mathrm|textsf|text|mathit|mathfrak)\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:leq|le)\b/g, '≤').replace(/\\diamond\b/g, '⋄').replace(/\\star\b/g, '⋆').replace(/\\times\b/g, '×')
    .replace(/\\prime\b|'/g, '′').replace(/\\infty\b/g, '∞').replace(/\\omega\b/g, 'ω');
  s = s.replace(/\^\{([^{}]*)\}|\^(.)/g, (m, a, b) => map(a ?? b, SUP) ?? `^${a ?? b}`)
    .replace(/_\{([^{}]*)\}|_(.)/g, (m, a, b) => map(a ?? b, SUB) ?? `_${a ?? b}`);
  return s.replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '').trim();
}

// one line describing a result: "NON ≤sW EM", "UC_ℕᴺ is parallelizable"
export function describeResult(r, label = (id) => id) {
  const red = (o) => [].concat(o).map((x) => ({ w: '≤W', sw: '≤sW', c: '≤c', rca0: 'over RCA₀' }[x] || `(${x})`)).join(', ');
  if (r.type === 'property') return `${label(r.statement)}: ${r.property}${r.value === false ? ' fails' : ''}`;
  if (r.type === 'implication') return `${label(r.to)} ${red(r.over)} ${label(r.from)}`.replace(/ (over RCA₀) (.*)$/, ' implied by $2 $1');
  if (r.type === 'separation') return `${label(r.to)} not ${red(r.over)} ${label(r.from)}`;
  if (r.type === 'equivalence') return `${label(r.from)} ≡ ${label(r.to)} (${[].concat(r.over).join(', ')})`;
  return JSON.stringify(r);
}

// Credits a fact to a researcher: a new entry, or one more fact for the same message.
// person {orcid, name}, date of the message, message id, note: what was entered.
export function creditFact(entries, { orcid, name, date, message, note }) {
  const same = message && entries.find((c) => c.message === message && c.kind === 'fact');
  if (same) { same.count = (same.count ?? 1) + 1; same.note = `${same.note.replace(/\.$/, '')}; ${note}`; return entries; }
  entries.push({ orcid, name, kind: 'fact', date, ...(message ? { message } : {}), note });
  return entries;
}

// creditFact on the file (comments and other entries kept)
export function creditFactInFile(credit, file = CREDITS) {
  const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `${HEADER}[]\n`);
  if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
  const seq = doc.contents;
  const same = credit.message && seq.items.find((n) => n.get('message') === credit.message && n.get('kind') === 'fact');
  if (same) {
    same.set('count', (same.get('count') ?? 1) + 1);
    same.set('note', `${String(same.get('note')).replace(/\.$/, '')}; ${credit.note}`);
  } else {
    const n = doc.createNode({ orcid: credit.orcid, name: credit.name, kind: 'fact', date: credit.date, ...(credit.message ? { message: credit.message } : {}), note: credit.note });
    n.flow = true;
    seq.items.push(n);
  }
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));
}
