// Query mode of the search field: questions asked in words or symbols, answered
// by the engine, with completions ranked by how likely they are.
//
//   comparisons   Is RT22 c-reducible to BRT32? · RT22 ≤c BRT32 · RT22 <=_W SRT22 · Does RT22 imply COH over ω-models?
//                 Is ADS equivalent to CAC? · ADS ≡ CAC · ADS ↔ CAC · Is WKL strictly stronger than WWKL? · RT22 vs WKL
//                 Does RT22 not imply WKL? · RT22 ⇏ WKL · Is every ω-model of RT22 a model of COH?
//   provability   Does RCA0 prove RT22 -> RT12? · RCA0 ⊢ RT22 → COH · RCA0 + RT22 ⊢ COH · Is COH provable in RCA0 + RT22?
//   properties    Does RT12 admit cone avoidance? · Does RT22 have the low basis property? · Is LLPO idempotent?
//                 Does COH preserve hyperimmunity? · Is SRT22 a cylinder?
//   navigation    Display RT22 · What is COH? · Diagram of RT22, COH, WKL · Compare RT22 and WKL · Questions about RT22
//
// The text is normalized (case, accents, Greek letters, sub/superscripts, TeX ^_{}), cut into tokens
// (keywords and symbols of the lexicon below, reductions, properties, names of statements), and the
// tokens are interpreted. Completions follow the slot being typed: statements related to the ones
// already given come first (papers studying them together, a decided comparison), properties already
// decided for the statement first, reductions where the comparison is decided first.
// Pure functions of the zoo (engine output); tested in tests/query.test.mjs.

const GREEK = { 'π': 'pi', 'σ': 'sigma', 'δ': 'delta', 'ω': 'omega', 'θ': 'theta', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'λ': 'lambda', 'ε': 'epsilon', 'φ': 'phi', 'ψ': 'psi' };

// lowercase, without accents, Greek letters spelled out, ¹₂ as digits, without TeX ^_{} and \mathsf;
// a negated symbol (≰, ⇏, ≢) becomes "!" and the symbol. map[k]: the index in the raw text of
// the k-th normalized character (length-preserving enough to complete the raw text).
export function normalize(raw) {
  let s = '';
  const map = [];
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k].toLowerCase();
    let n;
    if (GREEK[c]) n = GREEK[c];
    else if (/[’‘`´]/.test(c)) n = "'";
    else if (/[–—−]/.test(c)) n = '-';
    else if (/[ \t\n]/.test(c)) n = ' ';
    else if ('^_{}'.includes(c)) n = '';
    else {
      const d = c.normalize('NFKD');
      n = d.includes('̸') ? '!' + d.replace(/[̀-ͯ]/g, '') : d.replace(/[̀-ͯ]/g, '');
    }
    for (const ch of n) { s += ch; map.push(k); }
  }
  map.push(raw.length);
  // TeX commands: \mathsf{RT} → rt (the braces are gone), \leq stays a symbol (lexicon)
  s = s.replace(/\\(?:mathsf|mathrm|mathbf|text|mathit)(?=[a-z])/g, (m) => ' '.repeat(m.length));
  // a hyphen between words is a space: first-order, c-reducible, ω-models (arrows keep theirs)
  s = s.replace(/(?<=[a-z0-9*'])-(?=[a-z0-9])/g, ' ');
  return { s, map };
}
const key = (x) => normalize(String(x)).s.replace(/\\[a-z]+/g, '').replace(/(?<=[a-z])'(?=s\b)/g, '').replace(/[\s".,]/g, '');
const plainLabel = (label) => String(label)
  .replace(/\\(lim|min|max|log)\b/g, '$1')
  .replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\(mathsf|mathrm|mathbf)\{([^}]*)\}/g, '$2')
  .replace(/\\star\b/g, '⋆').replace(/\\times\b/g, '×').replace(/\\(?:sqcup|sqcap)\b/g, '⊔').replace(/\\(?:to|rightarrow)\b/g, '→')
  .replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_\s]/g, '');

// ---- lexicon ----------------------------------------------------------------
// [pattern (on the normalized text), token]. Words match whole words; the longest match wins.
const RED_FORMS = {
  rca0star: ['rca0\\*', 'rca0 star', 'rca0star', 'rca\\*'],
  rca0: ['rca0', 'rca 0', 'rca'],
  omega: ['omega models?', 'omega model implication', 'omega', 'w models?'],
  soc: ['soc', 'strong(?:ly)? omnisciently computabl[ey]', 'strong(?:ly)? omniscient computabl[ey]'],
  sc: ['sc', 'strong(?:ly)? computabl[ey]'],
  gw: ['gw', 'generali[sz]ed weihrauch'],
  sw: ['sw', 'strong(?:ly)? weihrauch'],
  w: ['w', 'weihrauch'],
  c: ['c', 'computabl[ey]'],
};
const SUB = '(?:\\s?\\(?(rca0\\*|rca0star|rca0|rca|omega|soc|sc|gw|sw|w|c)\\)?(?![a-z0-9]))?';
const LEX = [
  // symbols (an optional reduction as subscript: ≤c, <=_W, ≤_{sW})
  ['!?(?:≤|⩽|≦|<=|=<|\\\\leq?)' + SUB, { role: 'op', kind: 'le' }],
  ['!?(?:≥|⩾|≧|>=|=>(?=\\s?(?:sw|w|c|sc|soc|gw)\\b)|\\\\geq?)' + SUB, { role: 'op', kind: 'ge' }],
  ['!?(?:≡|⇔|↔|⟺|<=>|<->|==|\\\\equiv|\\\\iff|\\\\leftrightarrow|~|≅)' + SUB, { role: 'op', kind: 'eq' }],
  ['(?:-/->|=/=>|-/>|=/>)' + SUB, { role: 'op', kind: 'imp', neg: true }],
  ['!?(?:⇒|→|⟹|⟶|=>|->|-->|\\\\to|\\\\rightarrow|\\\\implies|\\\\Rightarrow)' + SUB, { role: 'op', kind: 'imp' }],
  ['!?(?:<|\\\\lt)(?![=\\-])' + SUB, { role: 'op', kind: 'lt' }],
  ['!?(?:>|\\\\gt)(?!=)' + SUB, { role: 'op', kind: 'gt' }],
  ['!?=' + SUB, { role: 'op', kind: 'eq' }],
  ['\\|' + SUB, { role: 'op', kind: 'vs' }],
  ['⊢|\\|-|\\\\vdash', { role: 'prove' }],
  ['\\+|plus', { role: 'plus' }],
  [',|&|;', { role: 'list' }],
  ['\\?|!|\\.|:', { role: 'fill' }],
  // words
  ['(?:does not|doesn\'t|do not|don\'t|did not|not|fails? to|never)', { role: 'not' }],
  ['implies|imply|implied|implying|entails?|yields?|gives?|then|is enough for|suffices for|is sufficient for|computes the solutions of', { role: 'op', kind: 'imp' }],
  ['(?:is |a |is a )?models? of|is a model of|satisfies(?= (?:all|every|the)? ?(?:of )?[a-z0-9]+ ?(?:\\?|$))', { role: 'op', kind: 'imp' }],
  ['implied by|follows from|is a consequence of|consequence of|is provable from|provable from|derivable from', { role: 'op', kind: 'le' }],
  ['reducible to|reduces to|reduce to|reducible from|reduction to|is below|below|reducible|reduces', { role: 'op', kind: 'le' }],
  ['weaker than or equal to|at most as strong as|no stronger than|weaker or equal to', { role: 'op', kind: 'le' }],
  ['strictly weaker than|strictly below|strictly reducible to', { role: 'op', kind: 'lt' }],
  ['weaker than', { role: 'op', kind: 'le' }],
  ['stronger than or equal to|at least as strong as|is above|above', { role: 'op', kind: 'ge' }],
  ['strictly stronger than|strictly above', { role: 'op', kind: 'gt' }],
  ['stronger than', { role: 'op', kind: 'ge' }],
  ['equivalent to|equivalent with|equivalent|equiv to|equiv|if and only if|iff|the same as|same as', { role: 'op', kind: 'eq' }],
  ['incomparable (?:to|with)|incomparable', { role: 'op', kind: 'vs' }],
  ['vs\\.?|versus|compared to|compared with|against', { role: 'op', kind: 'vs' }],
  ['proves?|proving|prove that|proves that', { role: 'prove' }],
  ['provable in|derivable in|a theorem of|theorem of', { role: 'provin' }],
  ['(?:in |on |over )?(?:every|all|each|any) omega models? of', { role: 'red', r: 'omega', every: true }],
  ['over|in|on|within|under|relative to|with respect to|wrt|w\\.r\\.t\\.?|in all|in every|on all|for all', { role: 'over' }],
  ['admits?|admitting|has|have|having|satisfy|satisfies|satisfying|enjoys?|possess(?:es)?|with', { role: 'propv' }],
  ['preserves?|preserving', { role: 'propv', preserve: true }],
  ['display|show(?: me)?|open|go to|goto|view|see|look up|lookup|find|search(?: for)?|page of', { role: 'cmd', cmd: 'display' }],
  ['what is|what\'s|whats|what are|who is|define|definition of|meaning of|statement of|explain', { role: 'cmd', cmd: 'display' }],
  ['diagram(?: of| for| with)?|draw|plot|graph(?: of)?|picture of|zoo of', { role: 'cmd', cmd: 'diagram' }],
  ['compare|comparison (?:of|between)|relations? between|relationships? between|how does|how do|how is|how are|difference between|properties of', { role: 'cmd', cmd: 'compare' }],
  ['(?:open )?(?:questions?|problems?|conjectures?) (?:about|on|for|of|mentioning|involving|with)', { role: 'cmd', cmd: 'questions' }],
  ['(?:results?|facts?|theorems?|papers?|references?|literature) (?:about|on|for|of|mentioning|involving|with)', { role: 'cmd', cmd: 'results' }],
  ['and', { role: 'list' }],
  ['is|are|does|do|did|can|could|would|will|should|must|was', { role: 'q' }],
  ['a|an|the|property|principle|statement|problem|theorem|that|whether|if|true|known|it|please|tell me|i wonder|reduction|reducibility|degree|to|of|for|by|be|condition|question|holds?|always|really|still|yet|so', { role: 'fill' }],
];

// ---- index of the zoo ---------------------------------------------------------
export function queryIndex(Z, { related } = {}) {
  const { S, R, raw } = Z;
  const usage = new Array(S.length).fill(0);
  for (const r of raw.results) for (const id of [r.from, r.to, r.statement, r.base]) { const i = id && Z.sidx.get(id); if (i !== undefined) usage[i]++; }
  // exact names: id, plain label, aliases, name → statements (the most used first)
  const exact = new Map();
  const put = (k, i) => { if (!k) return; if (!exact.has(k)) exact.set(k, []); if (!exact.get(k).includes(i)) exact.get(k).push(i); };
  const ascii = S.map((s) => plainLabel(s.label || s.id).toLowerCase());
  S.forEach((s, i) => { put(key(s.id), i); put(key(ascii[i]), i); for (const a of s.aliases || []) put(key(a), i); put(key(s.name), i); });
  const weight = (i) => usage[i] - (S[i].minor ? 50 : 0) - (S[i].op ? 20 : 0) - (S[i].conjunction ? 30 : 0);
  for (const l of exact.values()) l.sort((a, b) => weight(b) - weight(a));
  // multiword names, protected from the keywords they contain ("Ascending and descending sequences")
  const phrases = new Map(); // first word → [[phrase, i]] (longest first)
  S.forEach((s, i) => {
    for (const n of [s.name, ...(s.aliases || [])]) {
      const p = normalize(String(n)).s.replace(/\s+/g, ' ').trim();
      if (!p.includes(' ') || p.length < 6 || /[$\\]/.test(p)) continue;
      const w = p.split(' ')[0];
      if (!phrases.has(w)) phrases.set(w, []);
      phrases.get(w).push([p, i]);
    }
  });
  for (const l of phrases.values()) l.sort((a, b) => b[0].length - a[0].length);
  // properties: their names and the usual ways of saying them
  const props = [];
  raw.properties.forEach((p, k) => {
    const name = normalize(p.name).s.replace(/\s*\([^)]*\)/g, '').trim();
    const forms = new Set([name, normalize(p.id).s.replace(/-/g, ' '), name.replace(/ property$/, '')]);
    const pres = name.match(/^preservation of (.+)$/);
    if (pres) { forms.add(pres[1]); forms.add(`${pres[1]} preservation`); forms.add(`preservation of ${pres[1]}`); }
    if (/ basis$/.test(name)) { forms.add(`${name} property`); forms.add(`${name} theorem`); }
    if (/ avoidance$/.test(name)) { const w = name.replace(/ avoidance$/, ''); forms.add(`${w} avoiding`); forms.add(`avoids ${w}s`); forms.add(`avoidance of ${w}s`); forms.add(`${w} avoidance property`); }
    if (p.id === 'computably-true') { forms.add('computable'); forms.add('computably solvable'); }
    if (p.id === 'first-order') forms.add('first order');
    if (p.id === 'compose-closed') { forms.add('closed under composition'); forms.add('closed under compositional products'); }
    for (const f of [...forms]) if (f.startsWith('pi11 ')) { forms.add(f.replace('pi11 ', 'pi 1 1 ')); forms.add(f.replace('pi11 ', 'pi11')); }
    for (const f of forms) if (f) props.push([f, k]);
  });
  props.sort((a, b) => b[0].length - a[0].length);
  const reds = [];
  for (const [rid, forms] of Object.entries(RED_FORMS)) if (Z.ridx.has(rid)) for (const f of forms) reds.push([new RegExp(f + '(?![a-z0-9])', 'y'), rid]);
  const lex = LEX.map(([p, t]) => [new RegExp(p, 'y'), t, /^[a-z(]/.test(p.replace(/^\(\?:/, ''))]);
  return { Z, usage, exact, ascii, phrases, props, reds, lex, related, relCache: new Map() };
}

// ---- tokens -------------------------------------------------------------------
const isW = (c) => !!c && /[a-z0-9*'.]/.test(c);
const SYM = /[≤≥⩽⩾≦≧<>=→⇒⟹⟶⇔↔⟺≡⊢|+,&;?~≅]/;
export function tokenize(X, raw) {
  const { s, map } = normalize(raw);
  const toks = [];
  let p = 0, chunk = -1;
  const flush = (end) => {
    if (chunk < 0) return;
    let e = end;
    while (e > chunk && s[e - 1] === ' ') e--;
    if (e > chunk) toks.push({ role: 'text', start: chunk, end: e, text: s.slice(chunk, e) });
    chunk = -1;
  };
  const prev = () => (chunk >= 0 ? { role: 'text' } : toks[toks.length - 1]);
  while (p < s.length) {
    if (s[p] === ' ') { p++; continue; }
    const wordStart = !isW(s[p - 1]);
    let best = null;
    const offer = (end, tok) => { if (end > p && (!best || end > best.end)) best = { ...tok, start: p, end }; };
    if (wordStart) {
      for (const [ph, i] of X.phrases.get(s.slice(p).split(' ')[0]) || [])
        if (s.startsWith(ph, p) && !isW(s[p + ph.length])) { offer(p + ph.length, { role: 'stmt', i, exact: true }); break; }
      for (const [f, k] of X.props) if (s.startsWith(f, p) && !isW(s[p + f.length])) { offer(p + f.length, { role: 'prop', p: k }); break; }
      // a reduction: after "over", before "reducible", "equivalent", "prove", "⊢", "+", or ending a comparison
      for (const [re, rid] of X.reds) {
        re.lastIndex = p;
        const m = re.exec(s);
        if (!m) continue;
        const end = p + m[0].length, rest = s.slice(end);
        const pv = prev();
        const ctx = pv?.role === 'over'
          || /^\s?(?:reducible|reduces?|reduction|equivalent|equiv|implies|implication|proves?|provable|⊢|\|-|\+|plus|models?\b)/.test(rest)
          || (m[0].length > 1 && toks.some((t) => t.role === 'op' || t.role === 'prove') && /^[\s?.!]*$/.test(rest));
        if (ctx) offer(end, { role: 'red', r: rid });
      }
    }
    for (const [re, tok, word] of X.lex) {
      if (word && !wordStart) continue;
      re.lastIndex = p;
      const m = re.exec(s);
      if (!m || (word && isW(s[p + m[0].length]))) continue;
      const t = { ...tok };
      if (t.role === 'op') { if (m[0].startsWith('!')) t.neg = true; if (m[1]) t.sub = { rca: 'rca0', 'rca0*': 'rca0star' }[m[1]] || m[1]; }
      offer(p + m[0].length, t);
    }
    if (best) { flush(p); toks.push(best); p = best.end; continue; }
    if (chunk < 0) chunk = p;
    const q = p;
    while (p < s.length && s[p] !== ' ' && !(p > q && SYM.test(s[p])) && !(s[p] === '-' && /[>/-]/.test(s[p + 1] || ''))) p++;
    if (p === q) p++;
  }
  flush(s.length);
  return { s, map, toks: resolveText(X, toks, s) };
}
// a chunk of text → statements: the whole chunk when it names one exactly, else a cut into exact
// names ("rt22 wkl coh"), else the best match of the search
export function resolveName(X, text, search) {
  const k = key(text);
  if (!k) return undefined;
  const e = X.exact.get(k);
  if (e) return { i: e[0], exact: true };
  if (!search || k.length < 2) return undefined;
  const r = search(text, 1)[0];
  return r === undefined ? undefined : { i: r, exact: false };
}
function segment(X, words) {
  // fewest exact pieces covering the words, or null
  const n = words.length, best = new Array(n + 1).fill(null);
  best[0] = [];
  for (let a = 0; a < n; a++) {
    if (!best[a]) continue;
    for (let b = n; b > a; b--) {
      const e = X.exact.get(key(words.slice(a, b).map((w) => w.w).join(' ')));
      const cost = (l) => l.reduce((c, g) => c + 1 + (X.Z.S[g.i].op || X.Z.S[g.i].conjunction ? 3 : 0), 0);
      if (e && (!best[b] || cost(best[b]) > cost(best[a]) + 1 + (X.Z.S[e[0]].op || X.Z.S[e[0]].conjunction ? 3 : 0))) best[b] = [...best[a], { a, b, i: e[0] }];
    }
  }
  return best[n];
}
const wordsOf = (t) => {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(t.text))) out.push({ w: m[0], start: t.start + m.index, end: t.start + m.index + m[0].length });
  return out;
};
function resolveText(X, toks, s) {
  const out = [];
  for (const t of toks) {
    if (t.role !== 'text') { out.push(t); continue; }
    const e = X.exact.get(key(t.text));
    if (e) { out.push({ ...t, role: 'stmt', i: e[0], exact: true }); continue; }
    const ws = wordsOf(t), seg = ws.length > 1 && segment(X, ws);
    if (seg) { for (const g of seg) out.push({ role: 'stmt', i: g.i, exact: true, start: ws[g.a].start, end: ws[g.b - 1].end, text: s.slice(ws[g.a].start, ws[g.b - 1].end) }); continue; }
    out.push({ ...t, role: 'stmt', i: undefined, exact: false });
  }
  return out;
}

// ---- interpretation -----------------------------------------------------------
// {type: rel, kind: imp|le|ge|eq|lt|gt|vs, x, y, r, neg} (x kind y), {type: prop, s, p, neg},
// {type: display|diagram|compare|questions|results, ids: [i]}; null when not a full question.
// search(text, n): statement indices matching a text (the viewer's search), for inexact names.
export function interpret(X, toks, { search, r: r0 } = {}) {
  const Z = X.Z;
  toks = toks.map((t) => (t.role === 'stmt' && t.i === undefined && search ? { ...t, ...(resolveName(X, t.text, search) || {}) } : t));
  const st = toks.filter((t) => t.role === 'stmt');
  if (st.some((t) => t.i === undefined)) return null;
  const at = (role) => toks.findIndex((t) => t.role === role);
  const neg = toks.some((t) => t.role === 'not') !== toks.some((t) => t.role === 'op' && t.neg);
  const rid = (id) => Z.ridx.get(id);
  const reds = toks.filter((t) => t.role === 'red');
  const red = reds.length ? rid(reds[reds.length - 1].r) : undefined;
  const defaultR = (a, b) => {
    const r = red ?? r0 ?? rid('rca0');
    return Z.inDomain(r, a) && Z.inDomain(r, b) ? r : rid('rca0');
  };
  const exact = st.every((t) => t.exact);
  const prop = toks.find((t) => t.role === 'prop');
  if (prop && st.length) return { type: 'prop', s: st[0].i, p: prop.p, neg, exact };
  const stIn = (a, b) => toks.slice(a, b).filter((t) => t.role === 'stmt');
  // provability: RCA0 ⊢ A → B · RCA0 + A ⊢ B · does RCA0 prove A → B · B provable in RCA0 + A
  const pv = at('prove'), pin = at('provin');
  if (pv >= 0 || pin >= 0) {
    const base = reds.find((t) => Z.R[rid(t.r)].domain !== 'problems');
    let a, b;
    if (pin >= 0) { b = stIn(0, pin).pop(); a = stIn(pin, toks.length)[0]; }
    else {
      const plus = at('plus'), op = toks.findIndex((t, k) => k > pv && t.role === 'op');
      if (plus >= 0 && plus < pv) { a = stIn(plus, pv)[0]; b = stIn(pv, toks.length)[0]; }
      else if (op >= 0) { a = stIn(pv, op).pop(); b = stIn(op, toks.length)[0]; }
      else { a = stIn(0, pv).pop(); b = stIn(pv, toks.length)[0]; }
    }
    if (!a || !b) return null;
    const r = base ? rid(base.r) : defaultR(a.i, b.i);
    return { type: 'rel', kind: 'imp', x: a.i, y: b.i, r, neg, exact };
  }
  const opk = at('op');
  if (opk >= 0) {
    const op = toks[opk];
    const x = stIn(0, opk).pop(), y = stIn(opk, toks.length)[0];
    if (!x || !y) return null;
    const r = op.sub ? rid(op.sub) : defaultR(x.i, y.i);
    return { type: 'rel', kind: op.kind, x: x.i, y: y.i, r, neg, exact };
  }
  const cmd = toks.find((t) => t.role === 'cmd')?.cmd;
  const ids = st.map((t) => t.i);
  if (!ids.length) return null;
  if (cmd === 'questions' || cmd === 'results') return { type: cmd, ids, exact };
  if (!cmd && toks.some((t) => t.role === 'propv' || t.role === 'not' || t.role === 'over')) return null;
  if (ids.length === 2 && (cmd === 'compare' || !cmd)) return { type: 'rel', kind: 'vs', x: ids[0], y: ids[1], r: defaultR(ids[0], ids[1]), neg: false, exact };
  if (ids.length >= 2) return { type: cmd === 'compare' ? 'compare' : 'diagram', ids, r: red, exact };
  if (toks.some((t) => t.role === 'q' || t.role === 'propv' || t.role === 'not')) return null; // a question still being asked
  return { type: 'display', ids, exact };
}

// the answer: verdict yes | no | open | na, and the two statuses
export function answer(X, q) {
  const Z = X.Z;
  if (q.type === 'prop') {
    const e = Z.prop(q.p, q.s);
    const dom = Z.raw.properties[q.p].domain === 'problems' && Z.S[q.s].kind !== 'problem';
    const v = dom ? 'na' : !e ? 'open' : (e.v !== q.neg ? 'yes' : 'no');
    return { verdict: v };
  }
  if (q.type !== 'rel') return null;
  const st = (a, b) => Z.status(q.r, a, b);
  const xy = st(q.x, q.y), yx = st(q.y, q.x); // x implies y, y implies x
  const yn = (c) => (c === 'implies' ? 'yes' : c === 'separated' ? 'no' : c === 'na' ? 'na' : c === 'contradiction' ? 'contradiction' : 'open');
  const both = (a, b) => (a === 'na' || b === 'na' ? 'na' : a === 'yes' && b === 'yes' ? 'yes' : a === 'no' || b === 'no' ? 'no' : 'open');
  const strict = (up, down) => both(yn(up), down === 'separated' ? 'yes' : down === 'implies' ? 'no' : down === 'na' ? 'na' : 'open');
  let v = {
    imp: () => yn(xy), ge: () => yn(xy), le: () => yn(yx), eq: () => both(yn(xy), yn(yx)),
    gt: () => strict(xy, yx), lt: () => strict(yx, xy), vs: () => null,
  }[q.kind]();
  if (q.neg && (v === 'yes' || v === 'no')) v = v === 'yes' ? 'no' : 'yes';
  return { verdict: v, xy, yx };
}

// ---- completions --------------------------------------------------------------
// Each item: {from, insert} (the raw text from `from` is replaced by `insert`), kind, and what it
// names (i, p, r); score orders them. ctx: {search, r: current reduction, cur: statement of the page}.
const RED_TEXT = { rca0star: 'RCA0*', rca0: 'RCA0', omega: 'ω-models', sw: 'sW', w: 'W', sc: 'sc', soc: 'soc', c: 'c', gw: 'gW' };
export const redText = (Z, r) => RED_TEXT[Z.R[r].id] || Z.R[r].short;
export function stmtText(X, i) {
  const s = X.Z.S[i];
  const words = /^\\textsf\{([^{}$\\]+)\}$/.exec(s.label || '');
  if (words && X.exact.get(key(words[1]))?.[0] === i) return words[1];
  const a = plainLabel(s.label || s.id);
  const e = X.exact.get(key(a));
  return e && e[0] === i && /^[\w*′'.()⋆×-]+$/.test(a) ? a : s.id;
}
// how likely two statements are asked about together: papers studying both, a decided comparison
function relScore(X, c, j, r) {
  const Z = X.Z;
  let sc = 0;
  if (X.related) {
    if (!X.relCache.has(c)) {
      const m = new Map();
      for (const ref of X.related.byStmt[c] || []) { const w = X.related.weight.get(ref); for (const k of X.related.papers.get(ref)) m.set(k, (m.get(k) || 0) + w); }
      X.relCache.set(c, m);
    }
    sc += Math.min(12, 6 * (X.relCache.get(c).get(j) || 0));
  }
  if (r !== undefined) {
    const a = Z.status(r, c, j), b = Z.status(r, j, c);
    if (a === 'na' || b === 'na') sc -= 30;
    else sc += (a !== 'open') * 4 + (b !== 'open') * 4;
  }
  return sc;
}
const popularity = (X, i) => Math.min(6, Math.log2(1 + X.usage[i])) - (X.Z.S[i].minor ? 4 : 0) - (X.Z.S[i].op ? 2 : 0) - (X.Z.S[i].conjunction ? 6 : 0);

export function complete(X, raw, ctx = {}) {
  const Z = X.Z;
  const { s, map, toks } = tokenize(X, raw);
  const endsSpace = /\s$/.test(raw) || raw === '';
  // the slot being typed: the trailing name (or its last words, after exact names)
  let before = toks, partial = '', from = raw.length;
  const last = toks[toks.length - 1];
  if (!endsSpace && last && last.end === s.length) {
    if (last.role === 'stmt') {
      const ws = wordsOf(last);
      let cut = 0;
      for (let k = ws.length - 1; k >= 1; k--) if (segment(X, ws.slice(0, k))) { cut = k; break; }
      const pre = cut ? segment(X, ws.slice(0, cut)).map((g) => ({ role: 'stmt', i: g.i, exact: true, start: ws[g.a].start, end: ws[g.b - 1].end })) : [];
      before = [...toks.slice(0, -1), ...pre];
      from = map[ws[cut].start];
      partial = raw.slice(from);
    } else if (['prop', 'red', 'cmd', 'q', 'propv', 'op', 'fill', 'list', 'over', 'not', 'prove', 'provin', 'plus'].includes(last.role) && /^[a-z]/.test(s[last.start])) {
      // a word that could still grow ("is rt22 c" → c-reducible, cylinder…)
      before = toks.slice(0, -1);
      from = map[last.start];
      partial = raw.slice(from);
    }
  }
  const lead = from > 0 && !/\s$/.test(raw.slice(0, from)) ? ' ' : '';
  const P = normalize(partial).s.trim();
  const items = [];
  const add = (insert, o) => items.push({ from, insert: lead + insert, ...o });
  const starts = (text) => !P || normalize(text).s.startsWith(P) || normalize(text).s.split(/\s+/).some((w) => w.startsWith(P));
  const real = before.filter((t) => t.role !== 'fill');
  const lt = real[real.length - 1];
  const stmts = before.filter((t) => t.role === 'stmt' && t.i !== undefined);
  const q = before.find((t) => t.role === 'q');
  const opTok = before.find((t) => t.role === 'op' || t.role === 'prove' || t.role === 'provin');
  const redTok = [...before].reverse().find((t) => t.role === 'red');
  const r = (opTok?.sub && Z.ridx.get(opTok.sub)) ?? (redTok && Z.ridx.get(redTok.r)) ?? ctx.r ?? Z.ridx.get('rca0');
  const mode = ctx.rInMode || (() => true), inMode = ctx.inMode || (() => true);

  const stmtItems = (context, then = '') => {
    let cands;
    if (P) {
      const hits = ctx.search ? ctx.search(partial, 60) : [];
      const ex = X.exact.get(key(partial)) || [];
      cands = [...new Set([...ex, ...hits])];
    } else {
      const pool = new Set();
      for (const c of context) if (X.relCache.get(c) || X.related) { relScore(X, c, c, undefined); for (const [j] of X.relCache.get(c) || []) pool.add(j); }
      if (ctx.cur !== undefined && !context.includes(ctx.cur)) pool.add(ctx.cur);
      if (pool.size < 30) X.usage.map((u, i) => [u, i]).sort((a, b) => b[0] - a[0]).slice(0, 40).forEach(([, i]) => pool.add(i));
      cands = [...pool];
    }
    const pk = key(partial);
    cands.forEach((i, rank) => {
      if (context.includes(i)) return;
      let sc = popularity(X, i) + (inMode(i) ? 0 : -15);
      if (P) {
        const ids = [key(Z.S[i].id), key(X.ascii[i])];
        sc += ids.includes(pk) ? 60 : ids.some((k) => k.startsWith(pk)) ? 25 : 12 - rank * 0.2;
      }
      for (const c of context) sc += relScore(X, c, i, opTok || stmts.length ? r : undefined) / context.length;
      if (ctx.cur === i && !context.length) sc += 8;
      add(stmtText(X, i) + then, { kind: 'stmt', i, score: sc, ctxStmts: context });
    });
  };
  // adjectives (idempotent, a cylinder) after "is", nouns (cone avoidance) after "admit"; decided ones first
  const propItems = (si, verb = '', how = 'noun', base = 0) => {
    Z.raw.properties.forEach((p, k) => {
      if (p.domain === 'problems' && Z.S[si].kind !== 'problem') return;
      let name = p.name.replace(/\s*\([^)]*\)/g, '');
      const adj = !/avoidance|basis|preservation/i.test(name);
      if (how === 'adj' && !adj) return;
      if (how === 'preserve') { if (!/^Preservation of /.test(name)) return; name = name.replace(/^Preservation of /, ''); }
      const text = (how === 'adj' && p.id === 'cylinder' ? 'a ' : '') + (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);
      if (!starts(verb + text) && !starts(text)) return;
      const e = Z.prop(k, si);
      add(verb + text, { kind: 'prop', p: k, s: si, score: base + (e ? 6 : 0) + (adj && how !== 'adj' ? -5 : 0) + (p.optional ? -1 : 0) });
    });
  };
  const redItems = (a, b, prefix = '') => {
    Z.R.forEach((R, rr) => {
      if (!mode(rr) && R.id !== Z.R[ctx.r ?? 0]?.id) return;
      if (a !== undefined && (!Z.inDomain(rr, a) || (b !== undefined && !Z.inDomain(rr, b)))) return;
      const t = prefix + redText(Z, rr);
      if (!starts(t) && !starts(redText(Z, rr)) && !starts(R.name)) return;
      const dec = a !== undefined && b !== undefined ? (Z.status(rr, a, b) !== 'open') + (Z.status(rr, b, a) !== 'open') : 0;
      add(t, { kind: 'red', r: rr, score: dec * 10 + (rr === ctx.r ? 3 : 0) + (mode(rr) ? 2 : 0), pair: a !== undefined && b !== undefined ? [a, b] : null });
    });
  };
  const kw = (text, score = 0, extra = {}) => { if (starts(text)) add(text, { kind: 'kw', score, ...extra }); };
  const problem = (i) => Z.S[i]?.kind === 'problem';

  if (!lt) {
    // the start: questions, or a statement to display
    const ex = ctx.cur !== undefined ? stmtText(X, ctx.cur) : 'RT22';
    [['Is ', 'Is A c-reducible to B? · Is A equivalent to B?'], ['Does ', 'Does A imply B? · Does A admit cone avoidance?'],
      ['Does RCA0 prove ', 'Does RCA0 prove A → B?'], ['Display ', `Display ${ex}`], ['Compare ', 'Compare A and B'],
      ['Diagram of ', 'Diagram of A, B, C'], ['Questions about ', 'Open questions about A']]
      .forEach(([t, hint], k) => kw(t, P ? 40 - k : 30 - k, { hint, template: true }));
    if (P) stmtItems([]);
  } else if (lt.role === 'q') {
    stmtItems([]);
    if (/^(?:does|do)$/.test(normalize(raw.slice(map[lt.start], map[lt.end])).s.trim())) {
      Z.R.forEach((R, rr) => { if (R.domain !== 'problems' && mode(rr) && R.id !== 'omega') kw(`${redText(Z, rr)} prove `, 5, { kind: 'red', r: rr }); });
      kw('every ω-model of ', 4);
    } else kw('every ω-model of ', 2);
  } else if (['cmd', 'list', 'op', 'plus', 'prove', 'not'].includes(lt.role) || (lt.role === 'red' && lt.every)) {
    if (lt.role === 'not') { kw('imply ', 10); kw('admit ', 8); }
    const context = stmts.map((t) => t.i);
    stmtItems(lt.role === 'cmd' ? [] : context.slice(-1).length && lt.role !== 'list' ? context.slice(-1) : context);
  } else if (lt.role === 'provin') {
    redItems(undefined, undefined); items.forEach((it) => { it.insert += ' + '; });
  } else if (lt.role === 'over') {
    const [a, b] = stmts.slice(-2).map((t) => t.i);
    redItems(a, b);
  } else if (lt.role === 'propv') {
    if (stmts.length) propItems(stmts[stmts.length - 1].i, '', lt.preserve ? 'preserve' : 'noun', 10);
  } else if (lt.role === 'red') {
    if (!opTok && !stmts.length) { kw('prove ', 10); kw('⊢ ', 5); kw('+ ', 4); }
    else if (!opTok) { kw('reducible to ', 10); kw('equivalent to ', 8); }
  } else if (lt.role === 'stmt' && lt.i !== undefined) {
    const si = lt.i;
    const cmd = before.find((t) => t.role === 'cmd');
    const complete = opTok && stmts.length >= 2;
    if (complete) {
      if (!redTok && !opTok.sub && opTok.role !== 'provin') {
        const [a, b] = stmts.slice(-2).map((t) => t.i);
        redItems(a, b, 'over ');
      }
    } else if (before.some((t) => t.role === 'red' && t.every)) {
      kw('is a model of ', 10); kw('satisfies ', 5);
    } else if (cmd || before.some((t) => t.role === 'list')) {
      if (cmd?.cmd !== 'questions' && cmd?.cmd !== 'results') {
        const saved = items.length;
        stmtItems(stmts.map((t) => t.i), '');
        for (const it of items.slice(saved)) { it.insert = (cmd?.cmd === 'compare' && stmts.length === 1 ? ' and ' : ', ') + it.insert.trimStart(); it.score -= 2; }
      }
    } else if (q && /^(?:is|are|was)$/.test(normalize(raw.slice(map[q.start], map[q.end])).s.trim())) {
      Z.R.forEach((R, rr) => {
        if (!mode(rr) || !Z.inDomain(rr, si)) return;
        if (R.domain === 'problems') kw(`${redText(Z, rr)}-reducible to `, 12 + (rr === ctx.r ? 3 : 0), { kind: 'red', r: rr });
      });
      kw('equivalent to ', 11); kw('stronger than ', 9); kw('strictly stronger than ', 6); kw('weaker than ', 8); kw('strictly weaker than ', 5);
      if (!problem(si) || mode(Z.ridx.get('rca0'))) kw('provable in ', 4);
      propItems(si, '', 'adj', 2);
    } else if (q) {
      kw('imply ', 14); kw('admit ', 11); kw('have ', 6); kw('preserve ', 5); kw('not imply ', 3);
      if (problem(si)) Z.R.forEach((R, rr) => { if (R.domain === 'problems' && mode(rr)) kw(`${redText(Z, rr)}-reduce to `, 4, { kind: 'red', r: rr }); });
      propItems(si, 'admit ', 'noun', 3);
    } else if (before.some((t) => t.role === 'red' && !t.every) && !opTok) {
      kw('⊢ ', 8);
    } else {
      kw('→ ', 10); kw('≡ ', 8); kw('vs ', 5); kw('admits ', 4);
      if (problem(si)) Z.R.forEach((R, rr) => { if (R.domain === 'problems' && mode(rr)) kw(`≤${redText(Z, rr)} `, 6 + (rr === ctx.r ? 2 : 0), { kind: 'red', r: rr }); });
    }
  }
  // the same insert once (best score), best first
  const seen = new Map();
  for (const it of items) if (!seen.has(it.insert) || seen.get(it.insert).score < it.score) seen.set(it.insert, it);
  return { items: [...seen.values()].sort((a, b) => b.score - a.score), from, partial, toks };
}
