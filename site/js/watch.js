// Watchlists (docs/WATCH.md): a person follows principles through filters written in a
// small language; the viewer computes the facts each filter matches in the current
// database and reports those not seen before. The same grammar gives the completions of
// the filter field. Pure functions, tested in tests/watch.test.mjs.
//
// Filters (statement names as in the search field; "any" is every statement; reductions
// as in query mode: W, sW, c, ω-models, RCA0, …, several after "over" separated by commas):
//   RT22 vs COH [over W, c]        relations between them, both directions
//   RT22 ≤W SRT22, RT22 → COH      one direction only (its implication or separation)
//   RT22 vs any [over W], RT22     relations of RT22 with any statement
//   below RT22 [over W]            what RT22 implies (the statements below it)
//   above RT22 [over W]            what implies RT22
//   properties of RT22, SRT22      every known value of a property of these statements
//   cone avoidance of RT22         one property; "cone avoidance of any": of every statement
//   results on RT22                the entries of the database naming it
//   results from <paper>           the entries citing a paper (key, or authors and year)
//   questions on RT22, all questions   the status of recorded questions
//   papers on RT22                 the papers with results on it, or studying it
//   papers by <author>, new papers the references of an author, or all references
//   statements tagged <tag>, new statements   statements of a category, or all of them
//   errata [of <paper>]            the errata recorded for the papers
//   about RT22                     relations, properties, results and questions of RT22
// A fact is identified by a key; the person's watchlist keeps, per filter, short hashes of
// the keys already seen. New facts are the keys whose hash was not seen.
import { tokenize, resolveName, stmtText, redText, normalize } from './query.js';
import { questionStatus } from './engine.js';
import { surname } from './names.js';

// the forms of a filter: the words that start it, what follows (a slot), how it is offered
export const FORMS = [
  { kind: 'about', re: /^(everything\s+)?about\s+/i, text: 'about ', slot: 'stmts', hint: 'relations, properties, results and questions of a statement' },
  { kind: 'below', re: /^(what\s+is\s+)?below\s+/i, text: 'below ', slot: 'stmts', hint: 'what it implies' },
  { kind: 'above', re: /^(what\s+is\s+)?above\s+/i, text: 'above ', slot: 'stmts', hint: 'what implies it' },
  { kind: 'prop', re: /^(new\s+)?propert(y|ies)\s+(of|for)\s+/i, text: 'properties of ', slot: 'stmts', hint: 'every property of statements' },
  { kind: 'resultsFrom', re: /^(new\s+)?results?\s+(from|citing|in)\s+/i, text: 'results from ', slot: 'paper', hint: 'entries citing a paper' },
  { kind: 'results', re: /^(new\s+)?results?\s+(on|about|of|for|naming|with)\s+/i, text: 'results on ', slot: 'stmts', hint: 'entries naming statements' },
  { kind: 'questionsAll', re: /^(all\s+|new\s+)?questions\s*$/i, text: 'all questions', slot: null, hint: 'status of every recorded question' },
  { kind: 'questions', re: /^(new\s+)?questions?\s+(on|about|of|for)\s+/i, text: 'questions on ', slot: 'stmts', hint: 'status of questions about statements' },
  { kind: 'papersOn', re: /^(new\s+)?papers?\s+(on|about|for)\s+/i, text: 'papers on ', slot: 'stmts', hint: 'papers with results on statements' },
  { kind: 'papersBy', re: /^(new\s+)?papers?\s+by\s+/i, text: 'papers by ', slot: 'author', hint: 'papers of an author' },
  { kind: 'papersAll', re: /^(all\s+|new\s+)?papers\s*$/i, text: 'new papers', slot: null, hint: 'papers added to the zoo' },
  { kind: 'tag', re: /^(new\s+)?statements?\s+(tagged|in)\s+/i, text: 'statements tagged ', slot: 'tag', hint: 'statements of a category' },
  { kind: 'stmtsAll', re: /^(all\s+|new\s+)?statements\s*$/i, text: 'new statements', slot: null, hint: 'statements added to the zoo' },
  { kind: 'errata', re: /^errata(\s+(of|in|for)\s+)?/i, text: 'errata', slot: 'paper?', hint: 'errata recorded for papers' },
  { kind: 'rel', re: /^(any\s+)?(new\s+)?relations?\s+(between|of)\s+/i, text: 'relations between ', slot: 'stmts', hint: 'relations between statements' },
];
export const KINDS = Object.fromEntries(FORMS.map((f) => [f.kind, f.hint]));
const ANYWORD = /\b(any(thing)?|any (statement|principle)|everything)\b|\*/gi;
const fold = (x) => String(x || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// papers matching a text: a reference key, or the surnames (and year) of the authors
export function findPapers(Z, text) {
  const t = String(text || '').trim();
  const refs = Z.raw.references || {};
  if (refs[t]) return [t];
  const words = fold(t).split(/[\s,;&]+|\band\b/).filter((w) => w.length > 1 && w !== 'et' && w !== 'al');
  if (!words.length) return [];
  return Object.keys(refs).filter((k) => {
    const r = refs[k];
    const names = (r.authors || []).map((a) => fold(surname(a)));
    return words.every((w) => (/^\d{4}$/.test(w) ? String(r.year) === w : names.some((n) => n === w || n.split(/[\s-]/).includes(w))));
  });
}

// text → a filter {kind, a, b, dir, r, p, refs, tag} or {error}
export function parseWatch(X, text, { search } = {}) {
  const Z = X.Z;
  let t = String(text || '').trim();
  if (!t) return { error: 'Write a filter, for instance “RT22 vs COH over W”.' };
  const form = FORMS.find((f) => f.re.test(t)) || { kind: 'rel', slot: 'stmts' };
  if (form.re) t = t.replace(form.re, '');
  const kind = form.kind;
  if (form.slot === null) return { kind };
  if (form.slot === 'paper' || form.slot === 'paper?') {
    if (!t && form.slot === 'paper?') return { kind, refs: null };
    const refs = findPapers(Z, t);
    return refs.length ? { kind, refs } : { error: `No paper matches “${t}” (a reference key, or authors' surnames and a year).` };
  }
  if (form.slot === 'author') {
    const refs = findPapers(Z, t);
    return t && refs.length ? { kind, refs, author: t } : { error: `No paper by “${t}”.` };
  }
  if (form.slot === 'tag') {
    const tag = (Z.raw.tags || []).find((g) => fold(g.id) === fold(t) || fold(g.name) === fold(t));
    return tag ? { kind, tag: tag.id } : { error: `Unknown category “${t}” (${(Z.raw.tags || []).map((g) => g.name).join(', ')}).` };
  }
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
  let any = 0;
  t = t.replace(ANYWORD, () => { any++; return ' '; });
  const toks = tokenize(X, t).toks;
  const a = [], b = [];
  let side = a, op = null;
  for (const k of toks) {
    if (k.role === 'op' || (k.role === 'text' && /^(vs\.?|versus)$/i.test(k.text.trim()) && a.length && !op)) { op = k.role === 'op' ? k : { kind: 'vs' }; side = b; if (k.sub) reds.push(k.sub); continue; }
    if (k.role !== 'stmt') continue;
    let i = k.i;
    if (i === undefined && search) i = resolveName(X, k.text, search)?.i;
    if (i === undefined) return { error: `Unknown statement “${k.text}”.` };
    if (!side.includes(i)) side.push(i);
  }
  const r = [...new Set([...reds, ...toks.filter((k) => k.role === 'red').map((k) => k.r)].map((x) => Z.ridx.get(x)).filter((x) => x !== undefined))];
  const p = [...new Set(toks.filter((k) => k.role === 'prop').map((k) => k.p))];
  const f = { kind, r: r.length ? r : null };
  if (p.length && (kind === 'rel' || kind === 'prop')) { f.kind = 'prop'; f.p = p; }
  else if (kind === 'prop') f.p = null;
  if (f.kind === 'prop' && f.p && any && !a.length) { f.a = 'any'; return f; }
  if (!a.length) return { error: 'Name at least one statement.' };
  f.a = a;
  if (f.kind === 'rel') {
    // "A and B" without vs: relations between all of them; ≤, →: one direction
    if (!op && a.length > 1 && !any) f.b = a;
    else f.b = any || !b.length ? 'any' : b;
    if (op && ['le', 'lt'].includes(op.kind)) { f.dir = 'up'; }
    else if (op && ['ge', 'gt', 'imp'].includes(op.kind)) { f.dir = 'down'; }
  }
  return f;
}

// a filter in words (labels in plain text)
// name(i): how a statement is shown; esc: escapes the other words (identity for plain text, the
// viewer's esc when name returns HTML such as rendered labels)
export function describeWatch(X, f, name = (i) => X.Z.S[i].id, esc = (t) => t) {
  const Z = X.Z;
  const list = (l) => (l === 'any' ? 'any statement' : l.map(name).join(', '));
  const over = f.r ? ` over ${f.r.map((r) => esc(redText(Z, r))).join(', ')}` : '';
  const papers = (refs) => (refs.length > 3 ? `${esc(refs.slice(0, 3).join(', '))} and ${refs.length - 3} more` : esc(refs.join(', ')));
  switch (f.kind) {
    case 'rel':
      if (f.dir) return `${f.dir === 'up' ? `Whether ${list(f.b)} implies ${list(f.a)}` : `Whether ${list(f.a)} implies ${list(f.b)}`}${over}`;
      return f.b !== 'any' && f.b.length === f.a.length && f.b.every((x) => f.a.includes(x)) ? `Relations among ${list(f.a)}${over}` : `Relations between ${list(f.a)} and ${list(f.b)}${over}`;
    case 'below': return `Statements implied by ${list(f.a)}${over}`;
    case 'above': return `Statements implying ${list(f.a)}${over}`;
    case 'prop': return `${f.p ? f.p.map((p) => esc(Z.raw.properties[p].name)).join(', ') : 'Properties'} of ${list(f.a)}`;
    case 'results': return `Results on ${list(f.a)}`;
    case 'resultsFrom': return `Results citing ${papers(f.refs)}`;
    case 'questions': return `Questions on ${list(f.a)}`;
    case 'questionsAll': return 'All recorded questions';
    case 'papersOn': return `Papers on ${list(f.a)}`;
    case 'papersBy': return `Papers by ${esc(f.author)} (${f.refs.length} now)`;
    case 'papersAll': return 'Papers of the zoo';
    case 'tag': return `Statements tagged ${esc((Z.raw.tags || []).find((g) => g.id === f.tag)?.name || f.tag)}`;
    case 'stmtsAll': return 'Statements of the zoo';
    case 'errata': return f.refs ? `Errata of ${papers(f.refs)}` : 'Errata';
    default: return `Everything about ${list(f.a)}${over}`;
  }
}

// the facts a filter matches: Map key → {type, …} (what the viewer needs to show it)
export function watchItems(Z, f) {
  const out = new Map();
  const R = f.r || Z.R.map((_, r) => r);
  const all = () => Z.S.map((_, i) => i).filter((i) => !Z.S[i].minor);
  const rid = (r) => Z.raw.reductions[r].id;
  const rel = (x, y, only) => {
    for (const r of R) {
      const st = Z.status(r, x, y);
      if (st === 'implies' || (st === 'separated' && only !== 'implies')) out.set(`${st === 'implies' ? 'I' : 'N'}|${rid(r)}|${Z.S[x].id}|${Z.S[y].id}`, { type: st, r, a: x, b: y });
    }
  };
  const props = (s) => Z.raw.properties.forEach((p, k) => {
    if (f.p && !f.p.includes(k)) return;
    const e = Z.P[k]?.get(s);
    if (e) out.set(`P|${p.id}|${Z.S[s].id}|${e.v}`, { type: 'property', p: k, s, v: e.v });
  });
  const results = (pred) => Z.raw.results.forEach((res, k) => { if (pred(res)) out.set(`R|${res._key}`, { type: 'result', ri: k }); });
  const question = (q) => out.set(`Q|${q.id}|${questionStatus(Z, q).status}`, { type: 'question', q: q.id, status: questionStatus(Z, q).status });
  const paper = (k) => out.set(`B|${k}`, { type: 'paper', ref: k });
  const names = (res, id) => [res.from, res.to, res.statement, res.base].includes(id);
  const A = f.a === 'any' ? all() : f.a || [];
  switch (f.kind) {
    case 'rel':
      for (const a of A) for (const b of f.b === 'any' ? all() : f.b) {
        if (a === b) continue;
        if (f.dir !== 'up') rel(a, b);
        if (f.dir !== 'down') rel(b, a);
      }
      break;
    case 'below': for (const a of A) for (const b of all()) if (a !== b) rel(a, b, 'implies'); break;
    case 'above': for (const a of A) for (const b of all()) if (a !== b) rel(b, a, 'implies'); break;
    case 'prop': A.forEach(props); break;
    case 'results': for (const a of A) results((res) => names(res, Z.S[a].id)); break;
    case 'resultsFrom': results((res) => (res.refs || []).some((x) => f.refs.includes(x.ref))); break;
    case 'questions': for (const a of A) (Z.raw.questions || []).filter((q) => (q.statements || []).includes(Z.S[a].id)).forEach(question); break;
    case 'questionsAll': (Z.raw.questions || []).forEach(question); break;
    case 'papersOn':
      for (const a of A) {
        const id = Z.S[a].id;
        Z.raw.results.forEach((res) => { if (names(res, id)) (res.refs || []).forEach((x) => paper(x.ref)); });
        for (const l of Object.values(Z.S[a].studied || {})) l.forEach(paper);
      }
      break;
    case 'papersBy': f.refs.forEach(paper); break;
    case 'papersAll': Object.keys(Z.raw.references || {}).forEach(paper); break;
    case 'tag': Z.S.forEach((s, i) => { if ((s.tags || []).includes(f.tag)) out.set(`S|${s.id}`, { type: 'statement', s: i }); }); break;
    case 'stmtsAll': Z.S.forEach((s, i) => { if (!s.op && !s.conjunction) out.set(`S|${s.id}`, { type: 'statement', s: i }); }); break;
    case 'errata': (Z.raw.errata || []).forEach((e) => { if (!f.refs || f.refs.includes(e.ref)) out.set(`E|${e.ref}|${e.loc}`, { type: 'erratum', ref: e.ref, loc: e.loc, kind: e.kind }); }); break;
    default: // about
      for (const a of A) {
        props(a);
        results((res) => names(res, Z.S[a].id));
        (Z.raw.questions || []).filter((q) => (q.statements || []).includes(Z.S[a].id)).forEach(question);
        for (const b of all()) if (a !== b) { rel(a, b); rel(b, a); }
      }
  }
  return out;
}

// ---- completions of the filter field -----------------------------------------------
// items {from, insert, kind, i?, r?, ref?, hint?, score}: replace raw.slice(from) by insert
export function completeWatch(X, raw, { search } = {}) {
  const Z = X.Z;
  const items = [];
  const add = (from, insert, o) => items.push({ from, insert, ...o });
  const lw = (x) => fold(x).trim();
  const form = FORMS.find((f) => f.re.test(raw));
  const body = form ? raw.replace(form.re, '') : raw;
  const off = raw.length - body.length;
  // the word being typed and where it starts
  // (after the last comma, "vs", "and", "over" or comparison sign)
  const seps = [...body.matchAll(/,\s*|\s+(?:vs\.?|and|over|or|≤\S*|<\S*|≥\S*|>\S*|→|->|=>|⇒|≡)\s+/gi)];
  const cut = seps.length ? seps[seps.length - 1].index + seps[seps.length - 1][0].length : 0;
  const tail = body.slice(cut).replace(/^\s+/, '');
  const from = raw.length - tail.length;
  const P = lw(tail);
  const starts = (x) => !P || lw(x).startsWith(P) || lw(x).split(/\s+/).some((w) => w.startsWith(P));
  const used = new Set(tokenize(X, raw).toks.filter((k) => k.role === 'stmt' && k.i !== undefined && k.end < normalize(raw).s.length - (P ? P.length : 0)).map((k) => k.i));
  const stmts = (prefix = '', score = 0) => {
    const cands = P ? [...new Set([...(X.exact.get(normalize(tail).s.trim()) || []), ...(search ? search(tail, 30) : [])])] : X.usage.map((u, i) => [u, i]).sort((x, y) => y[0] - x[0]).slice(0, 12).map(([, i]) => i);
    cands.filter((i) => !used.has(i)).forEach((i, k) => add(from, prefix + stmtText(X, i), { kind: 'stmt', i, score: score + 40 - k - (Z.S[i].minor ? 10 : 0) }));
  };
  const chosen = (raw.match(/\bover\s+(.*)$/i)?.[1] || '').split(/\s*,\s*/).slice(0, -1).map(lw);
  const reds = () => Z.R.forEach((R, r) => { const t = redText(Z, r); if ((starts(t) || starts(R.name)) && !chosen.includes(lw(t))) add(from, t, { kind: 'red', r, hint: R.name, score: 30 - r }); });
  // one property ("cone avoidance of …"), from the start
  const propItems = () => Z.raw.properties.forEach((p, k) => {
    const t = `${p.name.replace(/\s*\([^)]*\)/g, '')} of `;
    const q = lw(raw);
    if (q && lw(t).startsWith(q)) add(0, t[0].toLowerCase() + t.slice(1), { kind: 'prop', p: k, hint: 'one property', score: 45 });
  });
  const at = raw.trimEnd().length; // where a separator goes (after the last word, not after a space)
  // the start: the forms, the properties, and statements (relations)
  if (!form) {
    if (!/\s/.test(raw)) {
      FORMS.filter((f) => f.kind !== 'rel').forEach((f, k) => { if (starts(f.text)) add(0, f.text, { kind: 'form', hint: f.hint, score: 70 - k }); });
      propItems();
      if (P) stmts('', 0);
      return finish(items);
    }
    propItems();
    // a relation filter: after a statement, the operators; after one, statements or any
    const toks = tokenize(X, raw).toks;
    const lastTok = toks[toks.length - 1];
    const ended = /\s$/.test(raw);
    if (/\bover\s+[^,]*$/i.test(raw) || /\bover\s.*,\s*[^,]*$/i.test(raw)) { reds(); return finish(items); }
    if (ended && lastTok?.role === 'stmt' && lastTok.i !== undefined) {
      const hasOp = toks.some((k) => k.role === 'op') || /\bvs\b/i.test(raw);
      if (!hasOp) for (const [t, h, s] of [['vs ', 'relations with another statement', 30], ['vs any', 'relations with every statement', 28], ['≤W ', 'one direction', 20], ['→ ', 'one direction', 18], ['over ', 'restrict the reductions', 15]]) add(at + 1, t, { kind: 'kw', hint: h, score: s });
      else add(at + 1, 'over ', { kind: 'kw', hint: 'restrict the reductions', score: 30 });
      return finish(items);
    }
    if (ended && (lastTok?.role === 'op' || /\bvs\s$/i.test(raw))) add(raw.length, 'any', { kind: 'kw', hint: 'every statement', score: 45 });
    stmts('', 0);
    return finish(items);
  }
  const slot = form.slot;
  if (slot === null) return finish(items);
  if (slot === 'tag') { (Z.raw.tags || []).forEach((g, k) => { if (starts(g.name) || starts(g.id)) add(from, g.name, { kind: 'tag', hint: g.description, score: 30 - k }); }); return finish(items); }
  if (slot === 'paper' || slot === 'paper?' || slot === 'author') {
    const q = lw(body);
    const out = new Map();
    for (const [k, r] of Object.entries(Z.raw.references || {})) {
      const names = (r.authors || []).map((a) => surname(a));
      if (slot === 'author') { for (const n of names) if (q && lw(n).startsWith(q)) out.set(n, { n, k }); continue; }
      const label = `${names.join(', ')} ${r.year || ''}`;
      if (q && (k.startsWith(q) || lw(label).includes(q) || lw(r.title).includes(q))) out.set(k, { k, label, title: r.title, year: r.year });
    }
    [...out.values()].sort((x, y) => (y.year || 0) - (x.year || 0)).slice(0, 12)
      .forEach((x, j) => add(off, slot === 'author' ? x.n : x.k, slot === 'author' ? { kind: 'author', hint: 'author', score: 30 - j } : { kind: 'paper', ref: x.k, hint: `${x.label} · ${x.title}`, score: 30 - j }));
    return finish(items);
  }
  // statements: after a comma or the form; "over" lists reductions; "any" for a property of every statement
  if (/\bover\s/i.test(body)) { reds(); return finish(items); }
  if (/\s$/.test(raw) && body.trim() && !/,\s*$/.test(body)) {
    add(at, ', ', { kind: 'kw', hint: 'another statement', score: 30 });
    if (['about', 'below', 'above'].includes(form.kind)) add(at + 1, 'over ', { kind: 'kw', hint: 'restrict the reductions', score: 25 });
    return finish(items);
  }
  stmts('', 0);
  return finish(items);
}
function finish(items) {
  const seen = new Map();
  for (const it of items) if (!seen.has(it.from + '|' + it.insert) || seen.get(it.from + '|' + it.insert).score < it.score) seen.set(it.from + '|' + it.insert, it);
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 12);
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
