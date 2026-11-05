// Mechanical checks of the facts proposed by the AI reader (scripts/ai-analyze.mjs).
// The model proposes; this code decides what may be published without a human:
// see triage() for the rules. Tested in tests/ai-facts.test.mjs.
import { OPERATIONS, resultKey } from './schema.mjs';

// Locate a quote in a text, ignoring case, spacing and punctuation (text
// extracted from PDF breaks lines and spacing arbitrarily):
// locator(text)(quote) is the position of the quote in text, or -1. Quotes of
// fewer than 15 letters and digits are never "found" (too easy to match by chance).
export function locator(text) {
  // letters and digits only, compared after NFKC folding (math italic 𝑋 → x,
  // ligature ﬁ → fi), walking code points (𝑋 is two UTF-16 units)
  const keep = (c) => /[\p{L}\p{N}]/u.test(c);
  const fold = (ch) => [...ch.normalize('NFKC').toLowerCase()].filter(keep);
  const norm = [], pos = [];
  let i = 0;
  for (const ch of text) {
    for (const c of fold(ch)) { norm.push(c); pos.push(i); }
    i += ch.length;
  }
  const flat = norm.join('');
  return (quote) => {
    const q = [...String(quote ?? '')].flatMap(fold).join('');
    if (q.length < 15) return -1;
    const at = flat.indexOf(q);
    return at < 0 ? -1 : pos[at];
  };
}

// A base system written "RCA0 + BΣ2", "rca0+isig2" or "RCA0": the catalogue id
// (base systems extend RCA₀; IΣ⁰₁ is recorded as rca0, as the existing entries).
export const baseId = (b) => {
  const s = String(b ?? '').trim();
  if (/^rca0$/i.test(s) || /^isig1$/i.test(s)) return 'rca0';
  const m = s.match(/^rca0\s*\+\s*([a-z0-9]+)$/i);
  return m ? (m[1].toLowerCase() === 'isig1' ? 'rca0' : m[1].toLowerCase()) : s;
};

// The fact proposed by the model as a database entry (data/results/ format, no refs).
export function entry(f) {
  switch (f.type) {
    case 'implication': case 'separation': case 'equivalence':
      return { type: f.type, from: f.from, to: f.to, over: f.over };
    case 'property':
      return { type: 'property', statement: f.statement, property: f.property, value: f.value };
    case 'conservation':
      return { type: 'conservation', statement: f.statement, base: baseId(f.base), class: f.class, value: f.value };
    default: return null;
  }
}

// raw: the content of site/data/zoo.json; zoo: buildZoo(raw).
export function factChecker(raw, zoo) {
  const kindOf = new Map(raw.statements.map((s) => [s.id, s.kind]));
  const OPNAMES = new Set(Object.values(OPERATIONS).map((o) => o.dotted));
  // A dotted operator id (cn.x.lpo, (cn.x.lpo).jump) is acceptable when all its
  // components are known statements: the build creates the operator statement.
  const knownId = (id) => kindOf.has(id) || (/\./.test(id) && id.replace(/[()]/g, '').split('.').every((p) => kindOf.has(p) || OPNAMES.has(p)));
  const isProblem = (id) => (kindOf.has(id) ? kindOf.get(id) === 'problem' : id.includes('.'));
  const rmap = new Map(raw.reductions.map((r) => [r.id, r]));
  const pset = new Set(raw.properties.map((p) => p.id));
  const cset = new Set(raw.classes.map((c) => c.id));
  const entries = new Set(raw.results.map(resultKey));

  // Problems with an entry: unknown ids, statements outside the reduction's domain.
  function validity(e) {
    if (!e) return ['unknown kind of fact'];
    const errs = [];
    const ids = e.statement !== undefined ? [e.statement] : [e.from, e.to];
    if (e.base) ids.push(e.base);
    for (const id of ids) if (!id || !knownId(id)) errs.push(`statement "${id}" is not in the catalogue`);
    if (e.over !== undefined) {
      const r = rmap.get(e.over);
      if (!r) errs.push(`reduction "${e.over}" is unknown`);
      else if (r.domain === 'problems' && ![e.from, e.to].every(isProblem)) errs.push(`${e.over} compares problems only`);
    }
    if (e.property !== undefined && !pset.has(e.property)) {
      const family = /^((weakly-)?low\d+|delta\d+|sigma\d+|pi\d+)-basis$/.test(e.property);
      errs.push(family ? `property "${e.property}" is not in data/properties.yaml yet: add this level of its hierarchy` : `property "${e.property}" is unknown`);
    }
    const pi = zoo.pidx.get(e.property), si = zoo.sidx.get(e.statement);
    if (pi !== undefined && si !== undefined && !zoo.propIn(pi, si)) errs.push(`${e.property} only applies to statements formulated as problems`);
    if (e.type === 'conservation' && !cset.has(e.class)) errs.push(`formula class "${e.class}" is unknown`);
    return errs;
  }

  // What the database (with everything the engine derives) says of an entry:
  // 'known', 'contradicts' or 'new'.
  function standing(e) {
    const si = (id) => zoo.sidx.get(id);
    if (e.type === 'property') {
      const p = zoo.pidx.get(e.property), s = si(e.statement);
      if (p === undefined || s === undefined) return 'new';
      const v = zoo.prop(p, s)?.v;
      return v === undefined ? 'new' : v === e.value ? 'known' : 'contradicts';
    }
    if (e.type === 'conservation') return 'new';
    const r = zoo.ridx.get(e.over), a = si(e.from), b = si(e.to);
    if (r === undefined || a === undefined || b === undefined) return 'new';
    const st = (x, y) => zoo.status(r, x, y);
    if (e.type === 'implication') return st(a, b) === 'implies' ? 'known' : st(a, b) === 'separated' ? 'contradicts' : 'new';
    if (e.type === 'separation') return st(a, b) === 'separated' ? 'known' : st(a, b) === 'implies' ? 'contradicts' : 'new';
    const both = [st(a, b), st(b, a)];
    return both.every((x) => x === 'implies') ? 'known' : both.includes('separated') ? 'contradicts' : 'new';
  }

  // Decide what to do with a proposed fact f (before the verification call):
  //   'drop'   the database already has it (or derives it) and there is no identical
  //            entry to which the paper's citation could be added;
  //   'auto'   candidate for publication (still subject to the verifier and the build check):
  //            valid ids, quote found, theorem number, confidence high, origin stated or
  //            special-case, no contradiction;
  //   'review' anything else, with the reasons.
  function triage(f, locate) {
    const e = entry(f);
    const reasons = validity(e);
    if (locate(f.quote) < 0) reasons.push('the quoted passage was not found in the text');
    if (!String(f.loc ?? '').trim()) reasons.push('no theorem number');
    const st = reasons.length ? 'new' : standing(e);
    if (st === 'known' && !(f.origin === 'stated' && entries.has(resultKey(e)))) return { action: 'drop', e, reasons };
    if (st === 'contradicts') reasons.push('contradicts the database');
    if (f.confidence !== 'high') reasons.push(`extractor confidence: ${f.confidence}`);
    if (f.origin === 'cited') reasons.push(`attributed by the paper to ${f.citedFrom || 'another work'}: cite the original`);
    if (f.origin === 'deduced') reasons.push('deduction, not stated in the paper');
    return { action: reasons.length ? 'review' : 'auto', e, reasons, standing: st };
  }

  return { knownId, validity, standing, triage };
}
