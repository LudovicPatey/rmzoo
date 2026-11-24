// Watchlists (docs/WATCH.md): a person follows principles through filters written in a
// small language; the viewer computes the facts each filter matches in the current
// database and reports those not seen before. Pure functions, tested in
// tests/watch.test.mjs.
//
// Filters (statement names as in the search field; "any" is every statement; the
// reductions as in query mode: W, sW, c, ω-models, RCA0, …):
//   RT22 vs COH [over W, c]        every relation between the two (both directions)
//   RT22 vs any [over W]           every relation of RT22 with any statement
//   properties of RT22, SRT22      every known value of a property of these statements
//   cone avoidance of RT22         one property
//   results on RT22                every result of the database naming it (published or derived by hand)
//   questions on RT22              the status of the recorded questions about it
//   about RT22                     all of the above for RT22 (relations with any statement)
// A fact is identified by a key; the person's watchlist keeps, per filter, the short
// hashes of the keys already seen. New facts are the keys whose hash was not seen.
import { tokenize, resolveName } from './query.js';
import { questionStatus } from './engine.js';

export const KINDS = { rel: 'relations', prop: 'properties', results: 'results', questions: 'questions', about: 'everything' };
const ANY = /^(any|anything|any statement|any principle|all|everything|\*)$/i;

// text → {kind, a: [i], b: [i] | 'any', r: [r] | null, p: [p] | null} or {error}
export function parseWatch(X, text, { search } = {}) {
  let t = String(text || '').trim();
  if (!t) return { error: 'Write a filter, for instance “RT22 vs COH over W”.' };
  let kind = 'rel';
  const lead = [
    [/^(everything\s+)?(about|on)\s+/i, 'about'], [/^watch\s+/i, 'about'],
    [/^(new\s+)?propert(y|ies)\s+(of|for)\s+/i, 'prop'],
    [/^(new\s+)?results?\s+(on|about|of|for|naming|with)\s+/i, 'results'],
    [/^(new\s+)?questions?\s+(on|about|of|for)\s+/i, 'questions'],
    [/^(any\s+)?(new\s+)?relations?\s+(between|of)\s+/i, 'rel'],
  ];
  for (const [re, k] of lead) if (re.test(t)) { kind = k; t = t.replace(re, ''); break; }
  const any = [];
  t = t.replace(/\b(any(thing)?|any (statement|principle)|everything)\b|\*/gi, () => { any.push(1); return ' '; });
  // "over W, c and ω-models": everything after "over" is a list of reductions
  const reds = [];
  const ov = t.match(/\s+over\s+(.*)$/i);
  if (ov) {
    t = t.slice(0, ov.index);
    for (const piece of ov[1].split(/\s*(?:,|;|\band\b|\bor\b)\s*/i).filter(Boolean)) {
      const r = tokenize(X, `over ${piece}`).toks.find((k) => k.role === 'red');
      if (!r) return { error: `Unknown reduction “${piece}”.` };
      reds.push(r.r);
    }
  }
  const toks = tokenize(X, t).toks;
  const a = [], b = [];
  let side = a, sawOp = false;
  for (const k of toks) {
    if (k.role === 'op' || (k.role === 'text' && /^(vs\.?|versus|and)$/i.test(k.text.trim()) && kind === 'rel' && a.length && !sawOp)) { sawOp = true; side = b; continue; }
    if (k.role !== 'stmt') continue;
    let i = k.i;
    if (i === undefined && search) i = resolveName(X, k.text, search)?.i;
    if (i === undefined) return { error: `Unknown statement “${k.text}”.` };
    if (!side.includes(i)) side.push(i);
  }
  // "RT22 and WKL" without vs: a list of statements (relations between all of them)
  if (kind === 'rel' && !sawOp && a.length > 1 && !any.length) { b.push(...a); }
  const r = [...new Set([...reds, ...toks.filter((k) => k.role === 'red').map((k) => k.r)].map((x) => X.Z.ridx.get(x)).filter((x) => x !== undefined))];
  const p = [...new Set(toks.filter((k) => k.role === 'prop').map((k) => k.p))];
  if (p.length && kind === 'rel') kind = 'prop';
  if (!a.length) return { error: 'Name at least one statement.' };
  const f = { kind, a, r: r.length ? r : null, p: p.length ? p : null };
  if (kind === 'rel') {
    if (any.length || !b.length) f.b = 'any';
    else f.b = b;
  }
  return f;
}

// a filter in words (labels in plain text)
export function describeWatch(X, f, name = (i) => X.Z.S[i].id) {
  const list = (l) => l.map(name).join(', ');
  const over = f.r ? ` over ${f.r.map((r) => X.Z.R[r].short || X.Z.raw.reductions[r].id).join(', ')}` : '';
  if (f.kind === 'rel') return `Relations between ${list(f.a)} and ${f.b === 'any' ? 'any statement' : list(f.b)}${over}`;
  if (f.kind === 'prop') return `${f.p ? f.p.map((p) => X.Z.raw.properties[p].name).join(', ') : 'Properties'} of ${list(f.a)}`;
  if (f.kind === 'results') return `Results on ${list(f.a)}`;
  if (f.kind === 'questions') return `Questions on ${list(f.a)}`;
  return `Everything about ${list(f.a)}${over}`;
}

// the facts a filter matches: Map key → {type, …} (what the viewer needs to show it)
export function watchItems(Z, f) {
  const out = new Map();
  const R = f.r || Z.R.map((_, r) => r);
  const rel = (a, bs) => {
    for (const r of R) for (const b of bs) {
      if (a === b) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        const st = Z.status(r, x, y);
        if (st === 'implies' || st === 'separated') out.set(`${st === 'implies' ? 'I' : 'N'}|${Z.raw.reductions[r].id}|${Z.S[x].id}|${Z.S[y].id}`, { type: st, r, a: x, b: y });
      }
    }
  };
  const all = () => Z.S.map((_, i) => i).filter((i) => !Z.S[i].minor);
  const props = (s) => Z.raw.properties.forEach((p, k) => {
    if (f.p && !f.p.includes(k)) return;
    const e = Z.P[k]?.get(s);
    if (e) out.set(`P|${p.id}|${Z.S[s].id}|${e.v}`, { type: 'property', p: k, s, v: e.v });
  });
  const results = (s) => Z.raw.results.forEach((res, k) => {
    const id = Z.S[s].id;
    if ([res.from, res.to, res.statement, res.base].includes(id)) out.set(`R|${res._key}`, { type: 'result', ri: k });
  });
  const questions = (s) => (Z.raw.questions || []).forEach((q) => {
    if (!(q.statements || []).includes(Z.S[s].id)) return;
    const st = questionStatus(Z, q).status;
    out.set(`Q|${q.id}|${st}`, { type: 'question', q: q.id, status: st });
  });
  for (const a of f.a) {
    if (f.kind === 'rel') rel(a, f.b === 'any' ? all() : f.b);
    if (f.kind === 'prop' || f.kind === 'about') props(a);
    if (f.kind === 'results' || f.kind === 'about') results(a);
    if (f.kind === 'questions' || f.kind === 'about') questions(a);
    if (f.kind === 'about') rel(a, all());
  }
  return out;
}

// short hash of a key (FNV-1a, 32 bits, base 36): the seen sets stay small
export function keyHash(k) {
  let h = 0x811c9dc5;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// the keys not seen yet
export function newKeys(items, seen) {
  const s = new Set(seen || []);
  return [...items.keys()].filter((k) => !s.has(keyHash(k)));
}

// a watchlist: {filters: [{id, text, created, seen: [hash]}]}; adding a filter marks what
// it matches now as seen (only later changes are reported)
export function addFilter(list, text, items, now = new Date().toISOString()) {
  const filters = list?.filters || [];
  if (filters.some((x) => x.text.trim().toLowerCase() === text.trim().toLowerCase())) return { filters };
  const id = `${now.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  return { filters: [...filters, { id, text: text.trim(), created: now.slice(0, 10), seen: [...items.keys()].map(keyHash) }] };
}
export function markSeen(list, id, items) {
  return { filters: (list?.filters || []).map((x) => (x.id === id ? { ...x, seen: [...items.keys()].map(keyHash) } : x)) };
}
export function removeFilter(list, id) {
  return { filters: (list?.filters || []).filter((x) => x.id !== id) };
}
// two watchlists (the browser's and the account's): filters of both, by text
export function mergeWatch(a, b) {
  const out = [...(a?.filters || [])];
  for (const f of b?.filters || []) if (!out.some((x) => x.text.trim().toLowerCase() === f.text.trim().toLowerCase())) out.push(f);
  return { filters: out };
}
