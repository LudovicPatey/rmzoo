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
  'prop-implies': 'Relation between properties (a low basis is a weakly low basis, a computably true problem has every preservation property…)',
  'prop-bottom': 'A problem with this property is below every problem over this reduction (a computably true problem P is computably reducible to every Q: the P-instance X computes a Q-instance, and itself a solution; a first-order problem is strongly computably reducible to every Q: every set computes a number)',
  'prop-base': 'A problem has this property exactly when the base system implies it over this reduction (e.g. computably true = holds in every ω-model)',
  refine: 'Separation at a coarser reduction',
  'base-lift': 'Over a weaker base theory, a statement implying the stronger base theory has all its consequences over that theory (over RCA₀*, a statement implying IΣ⁰₁ implies everything it implies over RCA₀)',
  'op-base': 'Algebra of Weihrauch degrees: a problem is below its jump, its parallelization and its finite parallelization (strongly), and below products and compositional products in which it occurs; a product is below the compositional products of its two factors, in either order',
  'op-comm': 'The product of Weihrauch problems is commutative: P × Q ≡W Q × P',
  'op-monotone': 'Algebra of Weihrauch degrees: parallelizations, finite parallelizations, products, compositional products and the diamond operator are monotone; jumps are monotone for strong Weihrauch reducibility',
  'op-diamond': 'Algebra of Weihrauch degrees: P⋄ is closed under products and compositional products (if Q, R ≤W P⋄ then Q × R ≤W P⋄ and Q ⋆ R ≤W P⋄)',
  'weaken-left': 'Weakening the hypothesis',
  'strengthen-right': 'Strengthening the conclusion',
  conservation: 'Conservation: the conclusion has the right syntactic form and is not provable from the base',
  'cons-base': 'A base system is conservative over itself',
  'prop-equiv': 'A Weihrauch property is invariant under equivalence (the same Weihrauch degree, or strong degree for strong properties)',
  'prop-self': 'A problem has this property exactly when it is above the corresponding operation applied to itself (idempotent: P × P ≤W P; parallelizable: P̂ ≤W P; closed under compositional product: P ⋆ P ≤W P)',
  'prop-op': 'Weihrauch operations produce problems with this property (P̂ is parallelizable, P* idempotent, P⋄ closed under compositional product, P ⋆ Q a cylinder; a jump P′ is finitely tolerant and a fractal, and the jump of a cylinder is a cylinder)',
  'prop-lift': 'For a cylinder, Weihrauch reductions to it are strong Weihrauch reductions (Brattka, Gherardi and Pauly, Proposition 3.5)',
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
  // membership of I (and N below) as byte arrays: the hot loops test them millions of times
  const Ib = R.map(() => new Uint8Array(n * n));
  const out = R.map(() => S.map(() => []));
  const inn = R.map(() => S.map(() => []));
  const queue = [];
  let qh = 0;

  const fI = (r, a, b) => ({ t: 'I', r, a, b });
  function addI(r, a, b, just) {
    if (!inDomain(r, a) || !inDomain(r, b)) return;
    const k = key(a, b);
    if (Ib[r][k]) return;
    Ib[r][k] = 1;
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
  // properties characterized by an implication from the base (`baseImplication: r`):
  // s has p  ⟺  the bottom of r implies s over r (for statements in the domain of p)
  const charProps = raw.properties.map((prop, p) => ({ p, r: ridx.get(prop.baseImplication), dom: ridx.get(prop.closedUnder) }))
    .filter((c) => c.r !== undefined);
  // bottoms of r, most specific first (RCA₀ = [rca0, omega] before RCA₀* = [rca0star, rca0, omega])
  const basesAt = (r) => S.map((_, i) => i).filter((i) => isBaseAt(i, r))
    .sort((a, b) => (Array.isArray(S[a].base) ? S[a].base.length : 99) - (Array.isArray(S[b].base) ? S[b].base.length : 99));
  // a published property value gives the implication (true) or separation (false) from the base
  const charSeeds = (v) => charProps.flatMap(({ p, r, dom }) => directResults.flatMap((res, ri) =>
    res.type === 'property' && pidx.get(res.property) === p && !!res.value === v && inDomain(dom, sidx.get(res.statement))
      ? basesAt(r).map((b) => ({ r, b, s: sidx.get(res.statement), ri })) : []));
  for (const { r, b, s, ri } of charSeeds(true)) addI(r, b, s, { rule: 'prop-base', result: ri });
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

  // --- algebra of Weihrauch degrees --------------------------------------------
  // Operator statements (op: jump | par | fin | product | compose, args: [ids]).
  // Laws, for reductions marked `algebra` (strong / weak Weihrauch):
  //   P ≤sW P', P ≤sW P̂, P ≤sW P*, P* ≤sW P̂;   P, Q ≤W P × Q ≤W P ⋆ Q, P, Q ≤W P ⋆ Q;
  //   P × Q ≡W Q × P, hence also P × Q ≤W Q ⋆ P;
  //   P ≤W P⋄, and P⋄ is closed under × and ⋆ (diamond: weak only);
  //   all operations are monotone for ≤W except the jump, which is monotone for ≤sW
//   only (par and fin are monotone for both).
  // "X implies Y" means Y ≤ X, so P ≤ op(P) is the implication op(P) → P.
  const ops = [];
  S.forEach((s, i) => { if (s.op) ops.push({ i, op: s.op, args: (s.args || []).map((id) => sidx.get(id)) }); });
  const unary = new Set(['jump', 'par', 'fin', 'diamond']);
  const opsByArg = new Map();
  ops.forEach((o) => o.args.forEach((x) => { if (!opsByArg.has(x)) opsByArg.set(x, []); opsByArg.get(x).push(o); }));
  const strongOK = (o) => unary.has(o.op) && o.op !== 'diamond';
  const algebraAt = (r, o) => R[r].algebra === 'weak' || (R[r].algebra === 'strong' && strongOK(o));
  const seedOps = () => {
    for (let r = 0; r < R.length; r++) {
      if (!R[r].algebra) continue;
      for (const o of ops) {
        if (!algebraAt(r, o) || o.args.some((x) => x === undefined)) continue;
        for (const x of o.args) addI(r, o.i, x, { rule: 'op-base' });
        const [x0, x1] = o.args;
        if (o.op === 'compose') { // P × Q ≤W P ⋆ Q, and Q × P ≤W P ⋆ Q since × is commutative
          for (const q of ops) if (q.op === 'product' && ((q.args[0] === x0 && q.args[1] === x1) || (q.args[0] === x1 && q.args[1] === x0))) addI(r, o.i, q.i, { rule: 'op-base' });
        }
        if (o.op === 'product' && x0 !== x1) { // P × Q ≡W Q × P
          const q = ops.find((p) => p.op === 'product' && p.args[0] === x1 && p.args[1] === x0);
          if (q) addI(r, o.i, q.i, { rule: 'op-comm' });
        }
        if (o.op === 'par') { // P* ≤sW P̂
          const fin = ops.find((q) => q.op === 'fin' && q.args[0] === o.args[0]);
          if (fin) addI(r, o.i, fin.i, { rule: 'op-base' });
        }
      }
    }
  };
  // P^⋄ is closed under products and compositional products:
  // if Q, R ≤W P^⋄ then Q × R ≤W P^⋄ and Q ⋆ R ≤W P^⋄
  const diamondClosure = (r, d, x) => {
    if (S[d].op !== 'diamond' || R[r].algebra !== 'weak') return;
    for (const c of opsByArg.get(x) || []) {
      if (c.op !== 'compose' && c.op !== 'product') continue;
      if (c.args.every((y) => I[r].has(key(d, y))))
        addI(r, d, c.i, { rule: 'op-diamond', prem: c.args.map((y) => fI(r, d, y)) });
    }
  };
  // monotonicity, applied when an implication between arguments is derived. The jump
  // is monotone for ≤sW only: P ≤W Q does not give P' ≤W Q' (the identity is below
  // every problem, but its jump is lim), so over ≤W jumps are compared only through
  // ≤sW facts.
  const monoAt = (r, o) => (o.op === 'jump' ? R[r].algebra === 'strong' : algebraAt(r, o));
  const monotone = (r, a, b) => {
    if (!R[r].algebra) return;
    diamondClosure(r, a, b);
    for (const o of opsByArg.get(b) || []) { // o = op(..., b, ...); look for o2 = op(..., a, ...)
      if (!monoAt(r, o)) continue;
      for (const o2 of opsByArg.get(a) || []) {
        if (o2.op !== o.op || o2.args.length !== o.args.length) continue;
        // o2 implies o when every argument of o2 implies the corresponding argument of o
        if (o2.args.every((x, k) => I[r].has(key(x, o.args[k]))))
          addI(r, o2.i, o.i, { rule: 'op-monotone', prem: o2.args.map((x, k) => fI(r, x, o.args[k])) });
      }
    }
  };
  seedOps();

  // properties with a law on operations (`opHas`: the operation always has it;
  // `opKeeps`: the operation has it when its arguments do) and lifting properties
  // (`lift: {from, to}`: if s has it, s implies over `to` what it implies over
  // `from`; a cylinder's Weihrauch reductions are strong). The lift needs the
  // property during the implication loop: it uses the cited values and the laws on
  // operations only.
  const opLaw = raw.properties.map((prop) => ({ has: new Set(prop.opHas || []), keeps: new Set(prop.opKeeps || []) }));
  const lifting = [];
  raw.properties.forEach((prop, p) => {
    if (!prop.lift) return;
    const has = new Set();
    directResults.forEach((res) => { if (res.type === 'property' && res.value && pidx.get(res.property) === p) has.add(sidx.get(res.statement)); });
    for (let grew = true; grew;) {
      grew = false;
      for (const o of ops) if (!has.has(o.i) && (opLaw[p].has.has(o.op) || (opLaw[p].keeps.has(o.op) && o.args.length && o.args.every((x) => has.has(x))))) { has.add(o.i); grew = true; }
    }
    lifting.push({ p, from: ridx.get(prop.lift.from), to: ridx.get(prop.lift.to), has });
  });
  // a cited value of a property defined by an operation (`selfOp`) gives the
  // implication to the operation applied to the statement itself (idempotent: P → P × P)
  const selfOpOf = (p, s) => ops.find((o) => o.op === raw.properties[p].selfOp && o.args.length && o.args.every((x) => x === s));
  directResults.forEach((res, ri) => {
    if (res.type !== 'property' || !res.value) return;
    const p = pidx.get(res.property), s = sidx.get(res.statement);
    const o = p !== undefined && raw.properties[p].selfOp && selfOpOf(p, s);
    if (o) addI(ridx.get(raw.properties[p].closedUnder), s, o.i, { rule: 'prop-self', result: ri });
  });

  // base lifts: when r2 is coarser than r and its base system B is an ordinary
  // statement at r (RCA₀ over RCA₀*), a statement implying B over r implies over r
  // everything it implies over r2: RCA₀* + A ⊢ IΣ⁰₁, so RCA₀* + A ⊇ RCA₀ + A.
  const lifts = [];
  for (let r = 0; r < R.length; r++) for (const r2 of coarserDirect[r])
    for (let B = 0; B < n; B++) if (isBaseAt(B, r2) && !isBaseAt(B, r) && inDomain(r, B)) lifts.push({ fine: r, coarse: r2, B });
  const liftsCoarse = R.map((_, r) => lifts.filter((l) => l.coarse === r));
  const liftsFine = R.map((_, r) => lifts.filter((l) => l.fine === r));

  function drainI() {
    while (qh < queue.length) {
      const r = queue[qh++], a = queue[qh++], b = queue[qh++];
      if (ops.length) monotone(r, a, b);
      for (const l of lifting) if (l.from === r && l.has.has(a)) addI(l.to, a, b, { rule: 'prop-lift', prem: [fI(r, a, b)] });
      for (const { fine, B } of liftsCoarse[r]) // a → b over the coarse frame
        if (I[fine].has(key(a, B))) addI(fine, a, b, { rule: 'base-lift', prem: [fI(fine, a, B), fI(r, a, b)] });
      for (const { coarse, B } of liftsFine[r]) // a → B over the fine frame
        if (b === B) for (const c of [...out[coarse][a]]) addI(r, a, c, { rule: 'base-lift', prem: [fI(r, a, B), fI(coarse, a, c)] });
      const ob = out[r][b];
      for (let i = 0, len = ob.length; i < len; i++) {
        const c = ob[i];
        if (!Ib[r][key(a, c)]) addI(r, a, c, { rule: 'trans', prem: [fI(r, a, b), fI(r, b, c)] });
      }
      const ia = inn[r][a];
      for (let i = 0, len = ia.length; i < len; i++) {
        const z = ia[i];
        if (!Ib[r][key(z, b)]) addI(r, z, b, { rule: 'trans', prem: [fI(r, z, a), fI(r, a, b)] });
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
  }
  drainI();

  // --- properties ----------------------------------------------------------
  // A property with `domain: problems` (defined through instances and solutions)
  // only applies to statements that can be formulated as problems: problems, and
  // sentences that are neither first-order nor marked `problemForm: false`; a
  // conjunction is excluded if one of its conjuncts is.
  const problemLike = S.map((s) => s.kind === 'problem'
    || (!s.firstOrder && s.problemForm !== false && !(s.conjunction || []).some((c) => S[sidx.get(c)]?.problemForm === false)));
  // a Weihrauch property (direction equiv) applies within the domain of its reduction
  const propIn = (p, s) => s !== undefined && (raw.properties[p].domain !== 'problems' || problemLike[s])
    && (raw.properties[p].direction !== 'equiv' || inDomain(ridx.get(raw.properties[p].closedUnder), s));
  // `implies`: having p implies having each q (low basis ⇒ weakly low basis);
  // failing q then implies failing p.
  const impliesP = raw.properties.map((prop) => (prop.implies || []).map((id) => pidx.get(id)).filter((q) => q !== undefined));
  const impliedByP = raw.properties.map(() => []);
  impliesP.forEach((qs, p) => qs.forEach((q) => impliedByP[q].push(p)));
  // reachP[p]: the properties q ≠ p that p implies, directly or through others
  const reachP = impliesP.map((_, p) => {
    const seen = new Set(), stack = [...impliesP[p]];
    while (stack.length) { const q = stack.pop(); if (!seen.has(q)) { seen.add(q); stack.push(...impliesP[q]); } }
    seen.delete(p);
    return seen;
  });

  const P = raw.properties.map(() => new Map()); // s -> {v, just}
  const contradictions = [];
  const fP = (p, s, v) => ({ t: 'P', p, s, v });
  const pqueue = [];
  function setP(p, s, v, just) {
    if (!propIn(p, s)) return;
    const cur = P[p].get(s);
    if (cur) {
      if (cur.v !== v) contradictions.push({ kind: 'property', p, s, facts: [fP(p, s, cur.v), fP(p, s, v)], other: just });
      return;
    }
    P[p].set(s, { v, just });
    pqueue.push(p, s);
  }
  // Propagate every new value: along the reduction of the property (down: has ⇒
  // what it implies has; fails ⇒ what implies it fails; up: dual), and along the
  // implications between properties. Implications are transitively closed, so
  // one step along the reduction suffices.
  function drainP() {
    for (let h = 0; h < pqueue.length;) {
      const p = pqueue[h++], s = pqueue[h++];
      const { v } = P[p].get(s);
      const prop = raw.properties[p];
      const r = ridx.get(prop.closedUnder); // undefined: preserved by no reduction (Σ⁰ₙ basis)
      if (prop.direction === 'equiv') { // invariant under equivalence over r (Weihrauch properties)
        for (const t of out[r][s]) if (t !== s && I[r].has(key(t, s)))
          setP(p, t, v, { rule: 'prop-equiv', prem: [fP(p, s, v), fI(r, s, t), fI(r, t, s)] });
        if (v) for (const o of opsByArg.get(s) || []) if (opLaw[p].keeps.has(o.op) && o.args.every((x) => P[p].get(x)?.v))
          setP(p, o.i, true, { rule: 'prop-op', prem: o.args.map((x) => fP(p, x, true)) });
        for (const q of v ? impliesP[p] : impliedByP[p]) setP(q, s, v, { rule: 'prop-implies', prem: [fP(p, s, v)] });
        continue;
      }
      const down = prop.direction !== 'up';
      const toSucc = down ? v : !v;
      for (const t of r === undefined ? [] : toSucc ? out[r][s] : inn[r][s]) {
        if (t === s) continue;
        const prem = toSucc ? [fP(p, s, v), fI(r, s, t)] : [fP(p, s, v), fI(r, t, s)];
        setP(p, t, v, { rule: v === down ? 'prop-down' : 'prop-up', prem });
      }
      for (const q of v ? impliesP[p] : impliedByP[p]) setP(q, s, v, { rule: 'prop-implies', prem: [fP(p, s, v)] });
    }
  }
  directResults.forEach((res, ri) => {
    if (res.type !== 'property') return;
    const p = pidx.get(res.property), s = sidx.get(res.statement);
    if (!propIn(p, s)) {
      errors.push(`Result #${ri} (${res.statement} ${res.property}): the property only applies to statements formulated as problems`);
      return;
    }
    setP(p, s, !!res.value, { rule: 'direct', result: ri });
  });
  // laws on operations, and properties defined by an operation, read off the implications
  raw.properties.forEach((prop, p) => {
    for (const o of ops) if (opLaw[p].has.has(o.op)) setP(p, o.i, true, { rule: 'prop-op' });
    if (!prop.selfOp) return;
    const r = ridx.get(prop.closedUnder);
    for (const o of ops) if (o.op === prop.selfOp && o.args.length && o.args.every((x) => x === o.args[0]) && I[r].has(key(o.args[0], o.i)))
      setP(p, o.args[0], true, { rule: 'prop-self', prem: [fI(r, o.args[0], o.i)] });
  });
  // properties defined as conservation over the base system
  raw.properties.forEach((prop, p) => {
    const fc = prop.fromConservation;
    if (!fc) return;
    // the base system is conservative over itself (and so is everything it implies)
    if (sidx.has(fc.base)) setP(p, sidx.get(fc.base), true, { rule: 'cons-base' });
    directResults.forEach((res, ri) => {
      if (res.type !== 'conservation' || res.base !== fc.base || !sidx.has(res.statement)) return;
      // conservative for a larger class: conservative for this one
      if (res.value !== false && (CLASS_MEMBERS[res.class] || []).includes(fc.class)) setP(p, sidx.get(res.statement), true, { rule: 'direct', result: ri });
      // not conservative for a smaller class: not conservative for this one
      if (res.value === false && (CLASS_MEMBERS[fc.class] || []).includes(res.class)) setP(p, sidx.get(res.statement), false, { rule: 'direct', result: ri });
    });
  });
  drainP();
  // properties that make a problem the bottom of a reduction (`bottomOf: r`: a
  // computably true problem is ≤c every problem). The values come from the cited
  // results, the laws above and the implications from the base (holding in every
  // ω-model); the new implications are closed, and may give new values, until nothing
  // changes. This runs before the separations, which then see these implications.
  const bottomProps = raw.properties.map((prop, p) => ({ p, r: ridx.get(prop.bottomOf) })).filter((x) => x.r !== undefined);
  for (let changed = bottomProps.length > 0; changed;) {
    changed = false;
    for (const { p, r, dom } of charProps)
      for (const b of basesAt(r).slice(0, 1))
        for (let s = 0; s < n; s++)
          if (inDomain(dom, s) && !P[p].has(s) && I[r].has(key(b, s))) setP(p, s, true, { rule: 'prop-base', prem: [fI(r, b, s)] });
    drainP();
    const before = queue.length;
    for (const { p, r } of bottomProps)
      for (const [s, { v }] of P[p]) if (v && inDomain(r, s))
        for (let a = 0; a < n; a++) if (a !== s && !Ib[r][key(a, s)]) addI(r, a, s, { rule: 'prop-bottom', prem: [fP(p, s, true)] });
    if (queue.length > before) { changed = true; drainI(); }
  }

  // --- non-implications ----------------------------------------------------
  const N = R.map(() => new Map());
  const Nb = R.map(() => new Uint8Array(n * n));
  const fN = (r, a, b) => ({ t: 'N', r, a, b });
  for (const r of order) {
    const q = [];
    let h = 0;
    const addN = (a, b, just) => {
      if (!inDomain(r, a) || !inDomain(r, b)) return;
      const k = key(a, b);
      if (Nb[r][k]) return;
      Nb[r][k] = 1;
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
    // a cited failure of a property defined by an operation: P does not imply op(P)
    directResults.forEach((res, ri) => {
      if (res.type !== 'property' || res.value) return;
      const p = pidx.get(res.property), s = sidx.get(res.statement);
      if (p === undefined || !raw.properties[p].selfOp || ridx.get(raw.properties[p].closedUnder) !== r) return;
      const o = selfOpOf(p, s);
      if (o) addN(s, o.i, { rule: 'prop-self', result: ri });
    });
    for (const x of charSeeds(false)) if (x.r === r) addN(x.b, x.s, { rule: 'prop-base', result: x.ri });
    // derived failures of a characterized property (failing cone avoidance ⇒ not
    // computably true) give the separation from the base too
    for (const { p, r: cr, dom } of charProps) {
      if (cr !== r) continue;
      for (const [x, { v, just: j }] of P[p])
        if (!v && j.rule !== 'direct' && inDomain(dom, x)) for (const b of basesAt(r)) addN(b, x, { rule: 'prop-base', prem: [fP(p, x, false)] });
    }
    raw.properties.forEach((prop, p) => {
      if (ridx.get(prop.closedUnder) !== r || prop.direction === 'equiv') return;
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
      // check before building the justification: most candidates are already known
      const Nr = Nb[r], oa = out[r][a], ic = inn[r][c];
      for (let i = 0, len = oa.length; i < len; i++) {
        const b = oa[i];
        if (b !== a && !Nr[key(b, c)]) addN(b, c, { rule: 'weaken-left', prem: [fN(r, a, c), fI(r, a, b)] });
      }
      for (let i = 0, len = ic.length; i < len; i++) {
        const d = ic[i];
        if (d !== c && !Nr[key(a, d)]) addN(a, d, { rule: 'strengthen-right', prem: [fN(r, a, c), fI(r, d, c)] });
      }
    }
    for (const k of N[r].keys()) {
      if (I[r].has(k)) {
        const a = Math.floor(k / n), b = k % n;
        contradictions.push({ kind: 'implication', r, a, b, facts: [fI(r, a, b), fN(r, a, b)] });
      }
    }
  }

  // characterized properties, read back from the implications and separations
  // from the base (no further propagation is needed: the reduction of the property
  // is finer than r, so the inherited values already follow through r)
  for (const { p, r, dom } of charProps)
    for (const b of basesAt(r).slice(0, 1))
      for (let s = 0; s < n; s++) {
        if (!inDomain(dom, s) || P[p].has(s)) continue;
        if (I[r].has(key(b, s))) setP(p, s, true, { rule: 'prop-base', prem: [fI(r, b, s)] });
        else if (N[r].has(key(b, s))) setP(p, s, false, { rule: 'prop-base', prem: [fN(r, b, s)] });
      }
  // properties defined by an operation fail when the statement does not imply the
  // operation applied to itself (Det_Σ × Det_Σ ≰W Det_Σ: Det_Σ is not idempotent)
  raw.properties.forEach((prop, p) => {
    if (!prop.selfOp) return;
    const r = ridx.get(prop.closedUnder);
    for (const o of ops) if (o.op === prop.selfOp && o.args.length && o.args.every((x) => x === o.args[0]) && N[r].has(key(o.args[0], o.i)))
      setP(p, o.args[0], false, { rule: 'prop-self', prem: [fN(r, o.args[0], o.i)] });
  });
  // values of the properties they imply (computably true ⇒ cone avoidance…); the
  // separations these could give already follow from the base comparison
  drainP();

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

  // The properties worth listing for statement s, given the implications between
  // properties: the strongest ones it has, the weakest ones it fails (the others
  // follow), and the open ones. An unknown property is listed when it is a main
  // one (not `optional`), or when it lies in a gap of the diagram (it implies a
  // property s has and is implied by one s fails) and is the strongest or the
  // weakest unknown property of that gap.
  const above = (a, b) => reachP[a].has(b) && !reachP[b].has(a); // a strictly implies b
  function salientProps(s) {
    const ps = raw.properties.map((_, p) => p).filter((p) => propIn(p, s));
    const v = (p) => P[p].get(s)?.v;
    const gap = (p) => v(p) === undefined
      && ps.some((f) => v(f) === false && above(f, p)) && ps.some((t) => v(t) === true && above(p, t));
    return ps.filter((p) => {
      const x = v(p);
      if (x === true) return !ps.some((q) => v(q) === true && above(q, p));
      if (x === false) return !ps.some((q) => v(q) === false && above(p, q));
      if (!raw.properties[p].optional) return true;
      return gap(p) && (!ps.some((q) => gap(q) && above(q, p)) || !ps.some((q) => gap(q) && above(p, q)));
    });
  }

  return {
    raw, S, R, n, sidx, ridx, pidx, order, coarserAll, coarserDirect,
    I, N, P, out, inn, errors, contradictions,
    inDomain, status, just, proof, sources,
    prop: (p, s) => P[p].get(s), // {v, just} | undefined
    propIn, // (p, s): does property p apply to statement s
    propImplies: (a, b) => reachP[a].has(b), // does having property a imply having b
    salientProps, // (s): the properties worth listing for s (see above)
    problemLike,
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
