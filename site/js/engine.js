// Inference engine for the RM zoo.
//
// Facts:
//   I(r, a, b)   a implies b over reduction r   (b ≤_r a)
//   N(r, a, b)   a does not imply b over r
//   P(p, s, v)   statement s has (v = true) or fails (v = false) property p
//
// Every fact stores a justification { rule, result?, prem: [facts] }, so a
// proof tree ending in cited results can be rebuilt for any derived fact.
// Shared by the browser viewer and the Node build/validation script.

export const RULES = {
  direct: 'Published result',
  refl: 'Reflexivity',
  base: 'Everything implies the base theory of the reduction',
  'omega-fo': 'First-order statements hold in every ω-model',
  'conj-elim': 'A conjunction implies its conjuncts',
  'conj-intro': 'Implying every conjunct implies the conjunction',
  trans: 'Transitivity',
  coarsen: 'Implication at a finer reduction',
  'prop-down': 'Property inherited along an implication',
  'prop-up': 'Failure of a property inherited along an implication',
  'prop-sep': 'Separation by a property',
  refine: 'Separation at a coarser reduction',
  'weaken-left': 'Weakening the hypothesis',
  'strengthen-right': 'Strengthening the conclusion',
  conservation: 'Conservation: the conclusion has the right syntactic form and is not provable from the base',
};

// Syntactic classes for conservation results. A sentence of form F is in
// class C when F is listed in CLASS_MEMBERS[C]. First-order statements
// without explicit form are treated as arithmetical ('arith').
const ARITH = ['arith', 'Pi02', 'Sig02', 'Pi03', 'Sig03', 'Pi04', 'Sig04', 'Pi0k'];
export const CLASS_MEMBERS = {
  Pi02: ['Pi02'],
  Pi03: ['Pi02', 'Sig02', 'Pi03'],
  Sig03: ['Pi02', 'Sig02', 'Sig03'],
  uPi03: ['Pi02', 'Sig02', 'Pi03', 'uPi03'],
  uPi04: ['Pi02', 'Sig02', 'Pi03', 'Sig03', 'Pi04', 'uPi03', 'uPi04'],
  Pi04: ['Pi02', 'Sig02', 'Pi03', 'Sig03', 'Pi04'],
  Sig04: ['Pi02', 'Sig02', 'Pi03', 'Sig03', 'Sig04'],
  Pi0k: ARITH,
  arith: ARITH,
  Pi11: [...ARITH, 'uPi03', 'uPi04', 'Pi11'],
  rPi12: [...ARITH, 'uPi03', 'uPi04', 'Pi11', 'rPi12'],
};
// Classes given as data (data/classes.yaml: { id, notation, includes }) take
// precedence: members = reflexive-transitive closure of `includes`.
export function classMembers(classes) {
  if (!classes?.length) return CLASS_MEMBERS;
  const inc = new Map(classes.map((c) => [c.id, c.includes || []]));
  const out = {};
  for (const c of classes) {
    const seen = new Set([c.id]), todo = [c.id];
    while (todo.length) for (const d of inc.get(todo.pop()) || []) if (!seen.has(d)) { seen.add(d); todo.push(d); }
    out[c.id] = [...seen];
  }
  return out;
}
export const CLASS_NAMES = {
  Pi02: 'Π⁰₂', Pi03: 'Π⁰₃', uPi04: '∀Π⁰₄', Sig03: 'Σ⁰₃', uPi03: '∀Π⁰₃', Pi04: 'Π⁰₄', Sig04: 'Σ⁰₄', Pi0k: 'arithmetical',
  arith: 'arithmetical', Pi11: 'Π¹₁', rPi12: 'restricted Π¹₂',
};

export function buildZoo(raw) {
  const S = raw.statements;
  const R = raw.reductions;
  const CLASS_MEMBERS = classMembers(raw.classes);
  const n = S.length;
  const sidx = new Map(S.map((s, i) => [s.id, i]));
  const ridx = new Map(R.map((r, i) => [r.id, i]));
  const pidx = new Map(raw.properties.map((p, i) => [p.id, i]));
  const errors = [];

  // --- reduction lattice ---------------------------------------------------
  const coarserDirect = R.map((r) => (r.finerThan || []).map((id) => ridx.get(id)));
  // all coarser reductions (transitive), excluding self
  const coarserAll = R.map((_, i) => {
    const seen = new Set();
    const stack = [...coarserDirect[i]];
    while (stack.length) {
      const j = stack.pop();
      if (seen.has(j)) continue;
      seen.add(j);
      stack.push(...coarserDirect[j]);
    }
    return seen;
  });
  // coarse-to-fine order: r after everything coarser than r
  const order = [];
  const placed = new Set();
  while (order.length < R.length) {
    let progress = false;
    for (let i = 0; i < R.length; i++) {
      if (placed.has(i)) continue;
      if ([...coarserAll[i]].every((j) => placed.has(j))) {
        order.push(i);
        placed.add(i);
        progress = true;
      }
    }
    if (!progress) { errors.push('Cycle in reduction lattice'); break; }
  }

  const inDomain = (r, a) => R[r].domain !== 'problems' || S[a].kind === 'problem';
  const key = (a, b) => a * n + b;

  // conjunctions
  const conjParts = S.map((s) => (s.conjunction || []).map((id) => sidx.get(id)));
  const conjOf = S.map(() => []);
  conjParts.forEach((parts, k) => parts.forEach((p) => conjOf[p].push(k)));

  const formOf = (i) => S[i].form || (S[i].firstOrder ? 'arith' : null);
  // conservation results: base index -> [{x, cls, ri}]
  const consByBase = new Map();
  raw.results.forEach((res, ri) => {
    if (res.type !== 'conservation' || res.value === false) return;
    const b = sidx.get(res.base), x = sidx.get(res.statement);
    if (!consByBase.has(b)) consByBase.set(b, []);
    consByBase.get(b).push({ x, cls: res.class, ri });
  });

  // --- implications --------------------------------------------------------
  const I = R.map(() => new Map());
  const out = R.map(() => S.map(() => []));
  const inn = R.map(() => S.map(() => []));
  const queue = [];
  let qh = 0;

  const fI = (r, a, b) => ({ t: 'I', r, a, b });
  function addI(r, a, b, just) {
    if (!inDomain(r, a) || !inDomain(r, b)) return;
    const k = key(a, b);
    if (I[r].has(k)) return;
    I[r].set(k, just);
    out[r][a].push(b);
    inn[r][b].push(a);
    queue.push(r, a, b);
  }

  const directResults = raw.results;
  // seed published results first so that proofs prefer them
  directResults.forEach((res, ri) => {
    if (res.type !== 'implication' && res.type !== 'equivalence') return;
    const a = sidx.get(res.from), b = sidx.get(res.to);
    for (const over of [].concat(res.over)) {
      const r = ridx.get(over);
      if (!inDomain(r, a) || !inDomain(r, b)) {
        errors.push(`Result #${ri} (${res.from} → ${res.to} over ${over}): statement outside the domain of the reduction`);
        continue;
      }
      addI(r, a, b, { rule: 'direct', result: ri });
      if (res.type === 'equivalence') addI(r, b, a, { rule: 'direct', result: ri });
    }
  });

  // a statement is the bottom of the reductions listed in its `base` field
  const isBaseAt = (i, r) => S[i].base === true || (Array.isArray(S[i].base) && S[i].base.includes(R[r].id));
  for (let r = 0; r < R.length; r++) {
    for (let a = 0; a < n; a++) addI(r, a, a, { rule: 'refl' });
    for (let b = 0; b < n; b++)
      if (isBaseAt(b, r)) for (let a = 0; a < n; a++) addI(r, a, b, { rule: 'base' });
    if (R[r].omegaModels)
      for (let b = 0; b < n; b++)
        if (S[b].firstOrder) for (let a = 0; a < n; a++) addI(r, a, b, { rule: 'omega-fo' });
    if (R[r].conjunction)
      conjParts.forEach((parts, k) => parts.forEach((p) => addI(r, k, p, { rule: 'conj-elim' })));
  }

  while (qh < queue.length) {
    const r = queue[qh++], a = queue[qh++], b = queue[qh++];
    const ob = out[r][b];
    for (let i = 0, len = ob.length; i < len; i++) {
      const c = ob[i];
      if (!I[r].has(key(a, c))) addI(r, a, c, { rule: 'trans', prem: [fI(r, a, b), fI(r, b, c)] });
    }
    const ia = inn[r][a];
    for (let i = 0, len = ia.length; i < len; i++) {
      const z = ia[i];
      if (!I[r].has(key(z, b))) addI(r, z, b, { rule: 'trans', prem: [fI(r, z, a), fI(r, a, b)] });
    }
    for (const r2 of coarserDirect[r]) addI(r2, a, b, { rule: 'coarsen', prem: [fI(r, a, b)] });
    if (R[r].conjunction) {
      for (const k of conjOf[b]) {
        const parts = conjParts[k];
        if (parts.every((p) => I[r].has(key(a, p))))
          addI(r, a, k, { rule: 'conj-intro', prem: parts.map((p) => fI(r, a, p)) });
      }
    }
  }

  // --- properties ----------------------------------------------------------
  const P = raw.properties.map(() => new Map()); // s -> {v, just}
  const contradictions = [];
  const fP = (p, s, v) => ({ t: 'P', p, s, v });
  function setP(p, s, v, just) {
    const cur = P[p].get(s);
    if (cur) {
      if (cur.v !== v) contradictions.push({ kind: 'property', p, s, facts: [fP(p, s, cur.v), fP(p, s, v)], other: just });
      return;
    }
    P[p].set(s, { v, just });
  }
  directResults.forEach((res, ri) => {
    if (res.type !== 'property') return;
    setP(pidx.get(res.property), sidx.get(res.statement), !!res.value, { rule: 'direct', result: ri });
  });
  // properties defined as conservation over the base system
  raw.properties.forEach((prop, p) => {
    const fc = prop.fromConservation;
    if (!fc) return;
    directResults.forEach((res, ri) => {
      if (res.type !== 'conservation' || res.value === false) return;
      if (res.base !== fc.base || !(CLASS_MEMBERS[res.class] || []).includes(fc.class)) return;
      setP(p, sidx.get(res.statement), true, { rule: 'direct', result: ri });
    });
  });
  raw.properties.forEach((prop, p) => {
    const r = ridx.get(prop.closedUnder);
    const down = prop.direction !== 'up';
    const direct = [...P[p].entries()];
    for (const [s, { v }] of direct) {
      // down: has ⇒ successors have; lacks ⇒ predecessors lack.  up: dual.
      const toSucc = down ? v : !v;
      const targets = toSucc ? out[r][s] : inn[r][s];
      for (const t of targets) {
        if (t === s) continue;
        const prem = toSucc ? [fP(p, s, v), fI(r, s, t)] : [fP(p, s, v), fI(r, t, s)];
        setP(p, t, v, { rule: v === down ? 'prop-down' : 'prop-up', prem });
      }
    }
  });

  // --- non-implications ----------------------------------------------------
  const N = R.map(() => new Map());
  const fN = (r, a, b) => ({ t: 'N', r, a, b });
  for (const r of order) {
    const q = [];
    let h = 0;
    const addN = (a, b, just) => {
      if (!inDomain(r, a) || !inDomain(r, b)) return;
      const k = key(a, b);
      if (N[r].has(k)) return;
      N[r].set(k, just);
      q.push(a, b);
    };
    directResults.forEach((res, ri) => {
      if (res.type !== 'separation' || ![].concat(res.over).some((o) => ridx.get(o) === r)) return;
      const a = sidx.get(res.from), b = sidx.get(res.to);
      if (!inDomain(r, a) || !inDomain(r, b)) {
        errors.push(`Result #${ri} (${res.from} ⇏ ${res.to} over ${res.over}): statement outside the domain of the reduction`);
        return;
      }
      addN(a, b, { rule: 'direct', result: ri });
    });
    raw.properties.forEach((prop, p) => {
      if (ridx.get(prop.closedUnder) !== r) return;
      const down = prop.direction !== 'up';
      const pos = [], neg = [];
      for (const [s, { v }] of P[p]) (v ? pos : neg).push(s);
      const [strong, weak] = down ? [pos, neg] : [neg, pos];
      for (const a of strong) for (const b of weak)
        addN(a, b, { rule: 'prop-sep', prop: p, prem: [fP(p, a, down), fP(p, b, !down)] });
    });
    for (const r2 of coarserAll[r]) {
      for (const k of N[r2].keys()) {
        const a = Math.floor(k / n), b = k % n;
        addN(a, b, { rule: 'refine', prem: [fN(r2, a, b)] });
      }
    }
    const conservationHere = R[r].conservation;
    while (h < q.length) {
      const a = q[h++], c = q[h++];
      if (conservationHere && consByBase.has(a)) {
        const f = formOf(c);
        if (f) for (const { x, cls, ri } of consByBase.get(a))
          if ((CLASS_MEMBERS[cls] || []).includes(f))
            addN(x, c, { rule: 'conservation', result: ri, prem: [fN(r, a, c)] });
      }
      for (const b of out[r][a]) if (b !== a) addN(b, c, { rule: 'weaken-left', prem: [fN(r, a, c), fI(r, a, b)] });
      for (const d of inn[r][c]) if (d !== c) addN(a, d, { rule: 'strengthen-right', prem: [fN(r, a, c), fI(r, d, c)] });
    }
    for (const k of N[r].keys()) {
      if (I[r].has(k)) {
        const a = Math.floor(k / n), b = k % n;
        contradictions.push({ kind: 'implication', r, a, b, facts: [fI(r, a, b), fN(r, a, b)] });
      }
    }
  }

  // --- queries -------------------------------------------------------------
  function just(f) {
    if (f.t === 'I') return I[f.r].get(key(f.a, f.b));
    if (f.t === 'N') return N[f.r].get(key(f.a, f.b));
    const e = P[f.p].get(f.s);
    return e && e.v === f.v ? e.just : undefined;
  }

  function status(r, a, b) {
    if (!inDomain(r, a) || !inDomain(r, b)) return 'na';
    const k = key(a, b);
    const i = I[r].has(k), x = N[r].has(k);
    if (i && x) return 'contradiction';
    if (i) return 'implies';
    if (x) return 'separated';
    return 'open';
  }

  // Proof tree. Shared sub-proofs are expanded once and referenced afterwards.
  function proof(f, seen = new Set(), depth = 0) {
    const j = just(f);
    const id = factKey(f);
    if (!j) return { fact: f, rule: 'missing' };
    if (seen.has(id) && j.rule !== 'refl') return { fact: f, rule: j.rule, ref: true };
    seen.add(id);
    const node = { fact: f, rule: j.rule, result: j.result, prop: j.prop };
    if (j.prem && depth < 40) {
      // skip trivial reflexive premises in display
      node.children = j.prem
        .filter((pf) => !(pf.t === 'I' && pf.a === pf.b))
        .map((pf) => proof(pf, seen, depth + 1));
    }
    return node;
  }

  // Every published result a derived fact depends on.
  function sources(f) {
    const acc = new Set();
    const seen = new Set();
    const walk = (g) => {
      const id = factKey(g);
      if (seen.has(id)) return;
      seen.add(id);
      const j = just(g);
      if (!j) return;
      if (j.result !== undefined) acc.add(j.result);
      (j.prem || []).forEach(walk);
    };
    walk(f);
    return [...acc];
  }

  return {
    raw, S, R, n, sidx, ridx, pidx, order, coarserAll, coarserDirect,
    I, N, P, out, inn, errors, contradictions,
    inDomain, status, just, proof, sources,
    prop: (p, s) => P[p].get(s), // {v, just} | undefined
    classMembers: CLASS_MEMBERS,
  };
}

export const factKey = (f) => (f.t === 'P' ? `P|${f.p}|${f.s}|${f.v}` : `${f.t}|${f.r}|${f.a}|${f.b}`);

// --------------------------------------------------------------------------
// Order-theoretic views of a selection at one reduction.

export function orderView(zoo, ids, r, { selectionOrder } = {}) {
  const sel = ids.map((id) => zoo.sidx.get(id)).filter((i) => i !== undefined && zoo.inDomain(r, i));
  const imp = (a, b) => zoo.I[r].has(a * zoo.n + b);
  // equivalence classes
  const classes = [];
  const classOf = new Map();
  for (const a of sel) {
    let c = classes.find((cl) => imp(a, cl[0]) && imp(cl[0], a));
    if (!c) { c = []; classes.push(c); }
    c.push(a);
  }
  const rank = (a) => {
    const s = zoo.S[a];
    let score = 0;
    if (s.base) score -= 1000;
    if (s.formulationOf) score += 100;
    if (s.conjunction) score += 200;
    // label equivalence classes by logical principles rather than by theorems
    // of ordinary mathematics, and never by an unchecked definition
    if ((s.tags || []).some((t) => ['analysis', 'graphs', 'well-orders'].includes(t))) score += 50;
    if (s.todo) score += 20;
    score += (s.priority || 0);
    score += (selectionOrder ? selectionOrder.indexOf(zoo.S[a].id) : sel.indexOf(a)) / 1000;
    return score;
  };
  classes.forEach((c, ci) => {
    c.sort((x, y) => rank(x) - rank(y));
    c.forEach((a) => classOf.set(a, ci));
  });
  const reps = classes.map((c) => c[0]);
  const m = classes.length;
  const less = (i, j) => i !== j && imp(reps[i], reps[j]); // i strictly stronger than j
  const hasse = [];
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    if (!less(i, j)) continue;
    let covered = false;
    for (let k = 0; k < m && !covered; k++) if (k !== i && k !== j && less(i, k) && less(k, j)) covered = true;
    if (!covered) hasse.push([i, j]);
  }
  // non-redundant separations / open questions: (i, j) is kept unless some
  // other pair (i2, j2) of the same status has i2 ⇒ i and j ⇒ j2.
  const frontier = (pred) => {
    const pairs = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j && pred(i, j)) pairs.push([i, j]);
    const geq = (x, y) => x === y || imp(reps[x], reps[y]);
    return pairs.filter(([i, j]) => !pairs.some(([i2, j2]) =>
      (i2 !== i || j2 !== j) && geq(i2, i) && geq(j, j2)));
  };
  const st = (i, j) => zoo.status(r, reps[i], reps[j]);
  const separations = frontier((i, j) => st(i, j) === 'separated');
  const open = frontier((i, j) => st(i, j) === 'open');
  const excluded = ids.filter((id) => {
    const a = zoo.sidx.get(id);
    return a !== undefined && !zoo.inDomain(r, a);
  });
  return { classes, reps, hasse, separations, open, excluded, classOf };
}

// Status of an open question of data/questions.yaml. A formal question (a list
// of "does `from` imply `to` over `over`?") is resolved when the database
// settles every part, partially resolved when it settles some; its solving
// results are the published results the settling proofs rest on. Other
// questions carry a manual status.
export function questionStatus(zoo, q) {
  if (!q.formal?.length) return { status: q.status || 'open', parts: [], results: [] };
  const parts = q.formal.map((f) => {
    const r = zoo.ridx.get(f.over), a = zoo.sidx.get(f.from), b = zoo.sidx.get(f.to);
    if (r === undefined || a === undefined || b === undefined) return { ...f, status: 'unknown' };
    return { ...f, r, a, b, status: zoo.status(r, a, b) };
  });
  const settled = parts.filter((p) => p.status === 'implies' || p.status === 'separated');
  const results = new Set();
  for (const p of settled) for (const ri of zoo.sources({ t: p.status === 'implies' ? 'I' : 'N', r: p.r, a: p.a, b: p.b })) results.add(ri);
  const status = settled.length === parts.length ? 'resolved' : settled.length ? 'partial' : 'open';
  return { status, parts, results: [...results] };
}
