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
  'op-base': 'Algebra of Weihrauch degrees: a problem is below its jump, its parallelization, its finite and its unbounded finite parallelization (strongly; P* ≤sW P^u* ≤W P̂: Soldà and Valenti, Proposition 5.2), and below products and compositional products in which it occurs; a product is below the compositional products of its two factors, in either order',
  'op-comm': 'The product of Weihrauch problems is commutative and associative, the compositional product is associative: products with the same factors are equivalent however ordered and bracketed, and so are compositional products of the same problems in the same order (Brattka and Pauly 2018, Proposition 4.2)',
  'op-monotone': 'Algebra of Weihrauch degrees: parallelizations, finite and unbounded finite parallelizations, products, compositional products and the diamond operator are monotone; jumps are monotone for strong Weihrauch reducibility (unbounded finite parallelization: Soldà and Valenti, Theorem 5.5)',
  'op-arith-jump': 'Arithmetic Weihrauch reducibility: a jump is equivalent to the problem itself (P′ ≤sW P ∘ lim, and lim is arithmetic: Marcone and Valenti 2020, Proposition 5.4)',
  'op-diamond': 'Algebra of Weihrauch degrees: P⋄ is closed under products and compositional products (if Q, R ≤W P⋄ then Q × R ≤W P⋄ and Q ⋆ R ≤W P⋄)',
  'op-part': 'First-order and deterministic parts: ¹P ≤W P and Det(P) ≤W P; both are monotone for ≤W, and Q ≤W P gives ¹Q ≤sW ¹P (Dzhafarov, Solomon and Yokoyama, Corollary 2.3; Goh, Pauly and Valenti 2021, Corollary 3.3)',
  'op-part-max': 'First-order and deterministic parts are maximal: a first-order problem Weihrauch reducible to P is strongly Weihrauch reducible to ¹P (Dzhafarov, Solomon and Yokoyama, Theorem 2.2), and a single-valued function with codomain ℕ^ℕ Weihrauch reducible to P is Weihrauch reducible to Det(P) (Goh, Pauly and Valenti 2021, Theorem 3.2)',
  'weaken-left': 'Weakening the hypothesis',
  'strengthen-right': 'Strengthening the conclusion',
  conservation: 'Conservation: the conclusion has the right syntactic form and is not provable from the base',
  'cons-base': 'A base system is conservative over itself',
  'prop-equiv': 'A Weihrauch property is invariant under equivalence (the same Weihrauch degree, or strong degree for strong properties)',
  'prop-self': 'A problem has this property exactly when it is above the corresponding operation applied to itself (idempotent: P × P ≤W P; parallelizable: P̂ ≤W P; closed under compositional product: P ⋆ P ≤W P)',
  'prop-below': 'A problem reducible to one with this property has a weaker one (a problem computably reducible to a first-order problem has solutions computable from its instances): a problem failing the weaker one is not reducible to it',
  'prop-closure': 'A problem with a closure property lies above the closure of every problem below it (UC_ℕ^ℕ is closed under compositional product and lim ≤W UC_ℕ^ℕ, so lim⋄ ≤W UC_ℕ^ℕ; a parallelizable problem lies above P̂ when it lies above P; an idempotent problem lies above P × R when it lies above P and R)',
  'prop-joint': 'Properties that together imply another (a parallelizable cylinder is strongly parallelizable: P̂ ≤W P gives P̂ ≤sW P, Brattka, Gherardi and Pauly, Proposition 3.5)',
  'prop-op': 'Weihrauch operations produce problems with this property (P̂ is parallelizable, P* idempotent, P⋄ closed under compositional product, P ⋆ Q a cylinder; a jump P′ is finitely tolerant and a fractal, and the jump of a cylinder is a cylinder)',
  'prop-elim': 'Choice elimination: a problem with this property below a compositional product with a factor below the eliminated problem is below the other factor (a total fractal below g ⋆ C_ℕ is below g: Brattka, Gherardi and Pauly, Theorem 7.15; a single-valued problem below C_{2^ℕ} ⋆ g is below g: Theorem 7.25)',
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

// --- compact storage of derived facts -----------------------------------------
// Millions of implications and separations are derived. Each is stored as a rule code
// (one byte) and one number (the middle statement of a transitivity step, the other
// reduction of a coarsening, the property of a separation…), in arrays indexed by the
// statements in the domain of the reduction; the rare facts with richer proofs keep
// their justification object. `get` rebuilds the justification object of the old
// representation, so proofs read the same. Keys are a * n + b, as before.
const CODES = ['', 'obj', 'direct', 'refl', 'base', 'omega-fo', 'conj-elim', 'op-base', 'op-part', 'op-comm', 'op-arith-jump',
  'trans', 'coarsen', 'prop-bottom', 'prop-base', 'refine', 'weaken-left', 'strengthen-right', 'prop-sep'];
const C = Object.fromEntries(CODES.map((x, i) => [x, i]));
class FactTable {
  constructor(n, inDom, wide, decode) {
    this.n = n;
    this.loc = new Int32Array(n).fill(-1); // statement → index in the domain (−1: outside)
    let d = 0;
    for (let s = 0; s < n; s++) if (inDom(s)) this.loc[s] = d++;
    this.d = d;
    this.glob = new Int32Array(d); // index in the domain → statement
    for (let s = 0; s < n; s++) if (this.loc[s] >= 0) this.glob[this.loc[s]] = s;
    // the same facts as bit sets, by row (a: its b) and by column (b: its a), 32 per word,
    // so that the closure finds the new facts of a step a word at a time
    this.W = (d + 31) >>> 5;
    this.row = new Uint32Array(d * this.W);
    this.col = new Uint32Array(d * this.W);
    this.rule = new Uint8Array(d * d);
    this.aux = wide ? new Int32Array(d * d) : new Uint16Array(d * d);
    this.list = new Int32Array(1 << 12); // keys in the order of derivation
    this.size = 0;
    this.obj = new Map(); // key → justification object (code 'obj')
    this.decode = decode; // (a, b, code, aux) → justification object
  }
  idx(k) {
    const a = Math.floor(k / this.n), la = this.loc[a], lb = this.loc[k - a * this.n];
    return la < 0 || lb < 0 ? -1 : la * this.d + lb;
  }
  has(k) { const i = this.idx(k); return i >= 0 && this.rule[i] !== 0; }
  hasAB(a, b) { const la = this.loc[a], lb = this.loc[b]; return la >= 0 && lb >= 0 && this.rule[la * this.d + lb] !== 0; }
  get(k) {
    const i = this.idx(k);
    if (i < 0 || !this.rule[i]) return undefined;
    if (this.rule[i] === 1) return this.obj.get(k);
    const a = Math.floor(k / this.n);
    return this.decode(a, k - a * this.n, this.rule[i], this.aux[i]);
  }
  // stores the fact (a, b) at index i of the domain arrays; the caller checked it is new
  put(i, k, code, aux, obj) {
    this.rule[i] = code;
    const la = Math.floor(i / this.d), lb = i - la * this.d;
    this.row[la * this.W + (lb >>> 5)] |= 1 << (lb & 31);
    this.col[lb * this.W + (la >>> 5)] |= 1 << (la & 31);
    if (code === 1) this.obj.set(k, obj); else this.aux[i] = aux;
    if (this.size === this.list.length) { const l = new Int32Array(this.list.length * 2); l.set(this.list); this.list = l; }
    this.list[this.size++] = k;
  }
  *keys() { for (let i = 0; i < this.size; i++) yield this.list[i]; }
}
// calls f(statement) for each bit of x[xi…] & ~y[yi…] (W words): the statements in the
// first set and not in the second
function eachNew(x, xi, y, yi, W, glob, f) {
  for (let w = 0; w < W; w++) {
    let m = x[xi + w] & ~y[yi + w];
    while (m) {
      const low = m & -m;
      f(glob[(w << 5) + 31 - Math.clz32(low)]);
      m ^= low;
    }
  }
}

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

  // a third-order statement is compared only by the reductions marked higherOrder (RCA₀ read as RCA₀^ω)
  const inDomain = (r, a) => (R[r].domain !== 'problems' || S[a].kind === 'problem') && (S[a].order !== 3 || !!R[r].higherOrder);
  const key = (a, b) => a * n + b;

  // ω-implication reads a statement inside the model; Weihrauch and computable
  // reductions read a problem through its true instances. The two agree when
  // ω-models judge instances and solutions correctly, but not for a statement with
  // `omegaAbsolute: false` (instances or solutions defined by a Σ¹₁/Π¹₁ condition:
  // well-orders, trees with a path). A reduction over problems then says nothing
  // about ω-models, and an ω-model separation nothing about such reductions.
  const absolute = S.map((s) => s.omegaAbsolute !== false);
  const bridge = (fine, coarse, a, b) => !(R[coarse].omegaModels && R[fine].domain === 'problems') || (absolute[a] && absolute[b]);

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
  // auxiliary numbers fit in 16 bits while statements, results and properties are few
  const wide = Math.max(n, raw.results.length, raw.properties.length) >= 65535;
  const decodeI = (r) => (a, b, c, x) => {
    switch (c) {
      case C.trans: return { rule: 'trans', prem: [fI(r, a, x), fI(r, x, b)] };
      case C.coarsen: return { rule: 'coarsen', prem: [fI(x, a, b)] };
      case C['prop-bottom']: return { rule: 'prop-bottom', prem: [fP(x, b, true)] };
      case C.direct: case C['prop-base']: return { rule: CODES[c], result: x };
      default: return { rule: CODES[c] };
    }
  };
  const I = R.map((_, r) => new FactTable(n, (s) => inDomain(r, s), wide, decodeI(r)));
  const out = R.map(() => S.map(() => []));
  const inn = R.map(() => S.map(() => []));
  const queue = [];
  let qh = 0;

  const fI = (r, a, b) => ({ t: 'I', r, a, b });
  const fP = (p, s, v) => ({ t: 'P', p, s, v });
  // a new implication a → b over r: its rule code and number, or a justification object
  function addIc(r, a, b, code, aux) {
    const T = I[r], la = T.loc[a], lb = T.loc[b];
    if (la < 0 || lb < 0) return;
    const i = la * T.d + lb;
    if (T.rule[i]) return;
    T.put(i, a * n + b, code, aux);
    out[r][a].push(b);
    inn[r][b].push(a);
    queue.push(r, a, b);
  }
  function addI(r, a, b, just) {
    const T = I[r], la = T.loc[a], lb = T.loc[b];
    if (la < 0 || lb < 0) return;
    const i = la * T.d + lb;
    if (T.rule[i]) return;
    T.put(i, a * n + b, 1, 0, just);
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
      addIc(r, a, b, C.direct, ri);
      if (res.type === 'equivalence') addIc(r, b, a, C.direct, ri);
    }
  });

  // a statement is the bottom of the reductions listed in its `base` field
  const isBaseAt = (i, r) => S[i].base === true || (Array.isArray(S[i].base) && S[i].base.includes(R[r].id));
  // properties characterized by an implication from the base (`baseImplication: r`):
  // s has p  ⟺  the bottom of r implies s over r (for statements in the domain of p)
  const charProps = raw.properties.map((prop, p) => ({ p, r: ridx.get(prop.baseImplication), dom: ridx.get(prop.closedUnder) }))
    .filter((c) => c.r !== undefined);
  // the characterization through ω-models holds only for ω-absolute statements: an
  // ω-model reads a non-absolute instance inside the model (Σ¹₁ conditions may fail
  // there), while the property reads the true instances
  const charIn = (r, dom, s) => s !== undefined && inDomain(dom, s) && (absolute[s] || !R[r].omegaModels);
  // bottoms of r, most specific first (RCA₀ = [rca0, omega] before RCA₀* = [rca0star, rca0, omega])
  const basesAt = (r) => S.map((_, i) => i).filter((i) => isBaseAt(i, r))
    .sort((a, b) => (Array.isArray(S[a].base) ? S[a].base.length : 99) - (Array.isArray(S[b].base) ? S[b].base.length : 99));
  // a published property value gives the implication (true) or separation (false) from the base
  const charSeeds = (v) => charProps.flatMap(({ p, r, dom }) => directResults.flatMap((res, ri) =>
    res.type === 'property' && pidx.get(res.property) === p && !!res.value === v && charIn(r, dom, sidx.get(res.statement))
      ? basesAt(r).map((b) => ({ r, b, s: sidx.get(res.statement), ri })) : []));
  for (const { r, b, s, ri } of charSeeds(true)) addIc(r, b, s, C['prop-base'], ri);
  for (let r = 0; r < R.length; r++) {
    for (let a = 0; a < n; a++) addIc(r, a, a, C.refl, 0);
    for (let b = 0; b < n; b++)
      if (isBaseAt(b, r)) for (let a = 0; a < n; a++) addIc(r, a, b, C.base, 0);
    if (R[r].omegaModels)
      for (let b = 0; b < n; b++)
        if (S[b].firstOrder) for (let a = 0; a < n; a++) addIc(r, a, b, C['omega-fo'], 0);
    if (R[r].conjunction)
      conjParts.forEach((parts, k) => parts.forEach((p) => addIc(r, k, p, C['conj-elim'], 0)));
  }

  // --- algebra of Weihrauch degrees --------------------------------------------
  // Operator statements (op: jump | par | fin | product | compose, args: [ids]).
  // Laws, for reductions marked `algebra` (strong / weak / arithmetic Weihrauch):
  //   P ≤sW P', P ≤sW P̂, P ≤sW P*, P* ≤sW P̂; P* ≤sW P^u* ≤W P̂ (ufin: Soldà and Valenti,
  //   Proposition 5.2; monotone for ≤W and ≤sW, Theorem 5.5);   P, Q ≤W P × Q ≤W P ⋆ Q, P, Q ≤W P ⋆ Q;
  //   P × Q ≡W Q × P, hence also P × Q ≤W Q ⋆ P;
  //   P ≤W P⋄, and P⋄ is closed under × and ⋆ (diamond: weak only);
  //   all operations are monotone for ≤W except the jump, which is monotone for ≤sW
//   only (par and fin are monotone for both).
  // The parts ¹P (op fop) and Det(P) (op det) are operators on Weihrauch degrees with
  // their own laws, over ≤W only (seeded at w, inherited by the coarser reductions):
  //   ¹P ≤W P, Det(P) ≤W P;  Q ≤W P gives ¹Q ≤sW ¹P and Det(Q) ≤W Det(P);
  //   a first-order Q ≤W P is ≤sW ¹P, a single-valued Q ≤W P is ≤W Det(P) (maximality,
  //   below, with the property values). ¹P is first-order; Det(P) is single-valued and
  //   a cylinder (properties.yaml, opHas).
  // "X implies Y" means Y ≤ X, so P ≤ op(P) is the implication op(P) → P.
  const ops = [];
  S.forEach((s, i) => { if (s.op) ops.push({ i, op: s.op, args: (s.args || []).map((id) => sidx.get(id)) }); });
  const unary = new Set(['jump', 'par', 'fin', 'ufin', 'diamond']);
  const opsByArg = new Map();
  ops.forEach((o) => o.args.forEach((x) => { if (!opsByArg.has(x)) opsByArg.set(x, []); opsByArg.get(x).push(o); }));
  // products (compositional products) with the same factors as a multiset (as a
  // sequence) once nested products are flattened: equivalent by commutativity and
  // associativity of × (associativity of ⋆)
  const opOf = new Map(ops.map((o) => [o.i, o]));
  const flat = (i, op) => { const o = opOf.get(i); return o && o.op === op && !o.args.includes(undefined) ? o.args.flatMap((x) => flat(x, op)) : [i]; };
  const sameShape = new Map();
  for (const op of ['product', 'compose']) {
    const groups = new Map();
    for (const o of ops) if (o.op === op && !o.args.includes(undefined)) {
      const f = flat(o.i, op);
      const k = (op === 'product' ? f.sort((x, y) => x - y) : f).join(',');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o.i);
    }
    for (const g of groups.values()) if (g.length > 1) for (const i of g) sameShape.set(i, g.filter((j) => j !== i));
  }
  const strongOK = (o) => unary.has(o.op) && o.op !== 'diamond';
  const PARTS = new Set(['fop', 'det']);
  const W = ridx.get('w'), SW = ridx.get('sw');
  // arithmetic Weihrauch reducibility (≤aW): the laws of ≤W hold (it is coarser), but
  // only these operations are monotone: arithmetic functionals can be applied
  // componentwise (lim⁽ⁿ⁾ is parallelizable), and P′ ≡aW P. The compositional product
  // and the diamond would need an arithmetic step between the two problems.
  const arithMono = new Set(['jump', 'par', 'fin', 'product']); // not ufin: its functional w is read by Φ_w
  const algebraAt = (r, o) => !PARTS.has(o.op) && (R[r].algebra === 'weak' || R[r].algebra === 'arithmetic' || (R[r].algebra === 'strong' && strongOK(o)));
  const seedOps = () => {
    // P → ¹P and P → Det(P): the part is below the problem
    if (W !== undefined) for (const o of ops) if (PARTS.has(o.op) && o.args[0] !== undefined) addIc(W, o.args[0], o.i, C['op-part'], 0);
    for (let r = 0; r < R.length; r++) {
      if (!R[r].algebra) continue;
      for (const o of ops) {
        if (!algebraAt(r, o) || o.args.some((x) => x === undefined)) continue;
        for (const x of o.args) addIc(r, o.i, x, C['op-base'], 0);
        if (o.op === 'jump' && R[r].algebra === 'arithmetic') addIc(r, o.args[0], o.i, C['op-arith-jump'], 0);
        const [x0, x1] = o.args;
        if (o.op === 'compose') { // P × Q ≤W P ⋆ Q, and Q × P ≤W P ⋆ Q since × is commutative
          for (const q of ops) if (q.op === 'product' && ((q.args[0] === x0 && q.args[1] === x1) || (q.args[0] === x1 && q.args[1] === x0))) addIc(r, o.i, q.i, C['op-base'], 0);
        }
        // P × Q ≡W Q × P, (P × Q) × R ≡W P × (Q × R), (P ⋆ Q) ⋆ R ≡W P ⋆ (Q ⋆ R)
        for (const q of sameShape.get(o.i) || []) addIc(r, o.i, q, C['op-comm'], 0);
        if (o.op === 'par') { // P* ≤sW P̂; P^u* ≤W P̂
          const fin = ops.find((q) => q.op === 'fin' && q.args[0] === o.args[0]);
          if (fin) addIc(r, o.i, fin.i, C['op-base'], 0);
          const ufin = ops.find((q) => q.op === 'ufin' && q.args[0] === o.args[0]);
          if (ufin && R[r].algebra !== 'strong') addIc(r, o.i, ufin.i, C['op-base'], 0);
        }
        if (o.op === 'ufin') { // P* ≤sW P^u*
          const fin = ops.find((q) => q.op === 'fin' && q.args[0] === o.args[0]);
          if (fin) addIc(r, o.i, fin.i, C['op-base'], 0);
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
  const monoAt = (r, o) => (R[r].algebra === 'arithmetic' ? arithMono.has(o.op)
    : o.op === 'jump' ? R[r].algebra === 'strong' : algebraAt(r, o));
  const monotone = (r, a, b) => {
    if (!R[r].algebra) return;
    diamondClosure(r, a, b);
    if (r === W) for (const o of opsByArg.get(b) || []) { // b ≤W a: ¹b ≤sW ¹a, Det(b) ≤W Det(a)
      if (!PARTS.has(o.op)) continue;
      for (const o2 of opsByArg.get(a) || []) if (o2.op === o.op)
        addI(o.op === 'fop' && SW !== undefined ? SW : W, o2.i, o.i, { rule: 'op-part', prem: [fI(W, a, b)] });
    }
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
  const citedHas = (p) => {
    const has = new Set();
    directResults.forEach((res) => { if (res.type === 'property' && res.value && pidx.get(res.property) === p) has.add(sidx.get(res.statement)); });
    for (let grew = true; grew;) {
      grew = false;
      for (const o of ops) if (!has.has(o.i) && (opLaw[p].has.has(o.op) || (opLaw[p].keeps.has(o.op) && o.args.length && o.args.every((x) => has.has(x))))) { has.add(o.i); grew = true; }
    }
    return has;
  };
  const lifting = [];
  raw.properties.forEach((prop, p) => {
    if (prop.lift) lifting.push({ p, from: ridx.get(prop.lift.from), to: ridx.get(prop.lift.to), has: citedHas(p) });
  });
  // closure laws (`closure: [ops]`): a statement Q with the property that implies every
  // argument of op(P…) implies op(P…), over closedUnder: P⋄ and P ⋆ R for closure under ⋆,
  // P̂ for parallelizability, P* and P × R for idempotence (Q × Q ≤ Q, products are
  // monotone). Like the lift, the implication loop uses the cited values and the laws on
  // operations; the loop of derived properties below uses every value.
  const closures = raw.properties.flatMap((prop, p) => (prop.closure
    ? [{ p, r: ridx.get(prop.closedUnder), ops: new Set([].concat(prop.closure)), has: citedHas(p) }] : []));
  // the operator statements o (of an op of c) with b among their arguments that a implies
  // argumentwise: a implies o
  const closeOver = (c, a, b) => {
    for (const o of opsByArg.get(b) || []) {
      if (!c.ops.has(o.op) || !o.args.length || o.args.includes(undefined) || I[c.r].hasAB(a, o.i)) continue;
      if (o.args.every((x) => x === a || I[c.r].hasAB(a, x)))
        addI(c.r, a, o.i, { rule: 'prop-closure', prop: c.p, prem: [fP(c.p, a, true), ...[...new Set(o.args)].filter((x) => x !== a).map((x) => fI(c.r, a, x))] });
    }
  };
  // choice elimination (`eliminates: {side, factor}`): if s has the property and
  // s ≤ g ⋆ h with h ≤ factor (side right: h is applied first) — or s ≤ h ⋆ g
  // (side left) — then s ≤ g, over closedUnder. `keep` is the index of g in the
  // arguments of the compositional product. Like the lift, the implication loop
  // uses the cited values and the laws on operations; the separations (the
  // contrapositive: s ≰ g gives s ≰ g ⋆ h) use every derived value.
  const elims = raw.properties.flatMap((prop, p) => (prop.eliminates
    ? [{ p, r: ridx.get(prop.closedUnder), F: sidx.get(prop.eliminates.factor), keep: prop.eliminates.side === 'left' ? 1 : 0, has: citedHas(p) }] : []));
  const elimI = (r, a, b) => {
    for (const e of elims) {
      if (e.r !== r || e.F === undefined) continue;
      const c = opOf.get(a);
      if (c && c.op === 'compose' && e.has.has(b) && !c.args.includes(undefined)) {
        const g = c.args[e.keep], h = c.args[1 - e.keep];
        if (I[r].hasAB(e.F, h)) addI(r, g, b, { rule: 'prop-elim', prop: e.p, prem: [fI(r, a, b), fP(e.p, b, true), fI(r, e.F, h)] });
      }
      if (a === e.F) for (const o of opsByArg.get(b) || []) {
        if (o.op !== 'compose' || o.args[1 - e.keep] !== b) continue;
        const g = o.args[e.keep];
        for (const s of [...out[r][o.i]]) if (e.has.has(s)) addI(r, g, s, { rule: 'prop-elim', prop: e.p, prem: [fI(r, o.i, s), fP(e.p, s, true), fI(r, e.F, b)] });
      }
    }
  };
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
      if (elims.length) elimI(r, a, b);
      for (const c of closures) if (c.r === r && c.has.has(a)) closeOver(c, a, b);
      for (const { fine, B } of liftsCoarse[r]) // a → b over the coarse frame
        if (I[fine].has(key(a, B))) addI(fine, a, b, { rule: 'base-lift', prem: [fI(fine, a, B), fI(r, a, b)] });
      for (const { coarse, B } of liftsFine[r]) // a → B over the fine frame
        if (b === B) for (const c of [...out[coarse][a]]) addI(r, a, c, { rule: 'base-lift', prem: [fI(r, a, B), fI(coarse, a, c)] });
      // transitivity, the code keeping the middle statement: a → c for the c that b
      // implies and a does not yet, z → b for the z that imply a and not yet b
      const T = I[r], W = T.W, la = T.loc[a], lb = T.loc[b];
      eachNew(T.row, lb * W, T.row, la * W, W, T.glob, (c) => addIc(r, a, c, C.trans, b));
      eachNew(T.col, la * W, T.col, lb * W, W, T.glob, (z) => addIc(r, z, b, C.trans, a));
      for (const r2 of coarserDirect[r]) if (bridge(r, r2, a, b)) addIc(r2, a, b, C.coarsen, r);
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
  // a property defined through instances and preserved by ω-implication (cone
  // avoidance, preservation properties) reads instances in the real world: it does
  // not apply to a statement that is not ω-absolute
  const trueInstances = (p) => raw.properties[p].domain === 'problems' && !!R[ridx.get(raw.properties[p].closedUnder)]?.omegaModels;
  const propIn = (p, s) => s !== undefined && (raw.properties[p].domain !== 'problems' || problemLike[s])
    && (absolute[s] || !trueInstances(p))
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

  // `jointly`: properties that together imply another (parallelizable + cylinder ⇒
  // strongly parallelizable); failing the target with all parts but one gives the last
  const joints = raw.properties.flatMap((prop, t) => (prop.jointly || []).map((ids) => ({ t, parts: ids.map((id) => pidx.get(id)) })))
    .filter((j) => j.parts.every((q) => q !== undefined));
  const jointsOf = raw.properties.map((_, p) => joints.filter((j) => j.t === p || j.parts.includes(p)));
  const P = raw.properties.map(() => new Map()); // s -> {v, just}
  const contradictions = [];
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
  // `restart`: from the first value again, along the implications derived since
  let ph = 0;
  function drainP(restart = true) {
    let h = restart ? 0 : ph;
    for (; h < pqueue.length;) {
      const p = pqueue[h++], s = pqueue[h++];
      const { v } = P[p].get(s);
      const prop = raw.properties[p];
      const r = ridx.get(prop.closedUnder); // undefined: preserved by no reduction (Σ⁰ₙ basis)
      for (const { t, parts } of jointsOf[p]) {
        const val = (q) => P[q].get(s)?.v;
        if (parts.every((q) => val(q) === true)) setP(t, s, true, { rule: 'prop-joint', prem: parts.map((q) => fP(q, s, true)) });
        const open = parts.filter((q) => val(q) !== true);
        if (val(t) === false && open.length === 1)
          setP(open[0], s, false, { rule: 'prop-joint', prem: [fP(t, s, false), ...parts.filter((q) => q !== open[0]).map((q) => fP(q, s, true))] });
      }
      if (v) for (const o of opsByArg.get(s) || []) if (opLaw[p].keeps.has(o.op) && o.args.every((x) => P[p].get(x)?.v))
        setP(p, o.i, true, { rule: 'prop-op', prem: o.args.map((x) => fP(p, x, true)) });
      if (prop.direction === 'equiv') { // invariant under equivalence over r (Weihrauch properties)
        for (const t of out[r][s]) if (t !== s && P[p].get(t)?.v !== v && I[r].has(key(t, s)))
          setP(p, t, v, { rule: 'prop-equiv', prem: [fP(p, s, v), fI(r, s, t), fI(r, t, s)] });
        for (const q of v ? impliesP[p] : impliedByP[p]) setP(q, s, v, { rule: 'prop-implies', prem: [fP(p, s, v)] });
        continue;
      }
      const down = prop.direction !== 'up';
      const toSucc = down ? v : !v;
      const Pp = P[p];
      for (const t of r === undefined ? [] : toSucc ? out[r][s] : inn[r][s]) {
        if (t === s || Pp.get(t)?.v === v) continue; // already known: no justification to build
        const prem = toSucc ? [fP(p, s, v), fI(r, s, t)] : [fP(p, s, v), fI(r, t, s)];
        setP(p, t, v, { rule: v === down ? 'prop-down' : 'prop-up', prem });
      }
      for (const q of v ? impliesP[p] : impliedByP[p]) setP(q, s, v, { rule: 'prop-implies', prem: [fP(p, s, v)] });
    }
    ph = h;
  }
  directResults.forEach((res, ri) => {
    if (res.type !== 'property') return;
    const p = pidx.get(res.property), s = sidx.get(res.statement);
    if (!propIn(p, s)) {
      errors.push(s !== undefined && !absolute[s] && trueInstances(p)
        ? `Result #${ri} (${res.statement} ${res.property}): the statement is not ω-absolute (omegaAbsolute: false), so ω-model properties do not apply`
        : `Result #${ri} (${res.statement} ${res.property}): the property only applies to statements formulated as problems`);
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
  // maximality of the parts: s ≤W P with s first-order gives s ≤sW ¹P; with s
  // single-valued (codomain ℕ^ℕ), s ≤W Det(P)
  const partMax = W === undefined ? [] : ops.filter((o) => PARTS.has(o.op) && o.args[0] !== undefined)
    .map((o) => ({ o, p: pidx.get(o.op === 'fop' ? 'first-order' : 'single-valued'), r: o.op === 'fop' && SW !== undefined ? SW : W }))
    .filter((x) => x.p !== undefined);
  for (let changed = true; changed;) {
    changed = false;
    const pbefore = pqueue.length;
    for (const { p, r, dom } of charProps)
      for (const b of basesAt(r).slice(0, 1))
        for (let s = 0; s < n; s++)
          if (charIn(r, dom, s) && !P[p].has(s) && I[r].has(key(b, s))) setP(p, s, true, { rule: 'prop-base', prem: [fI(r, b, s)] });
    drainP();
    const before = queue.length;
    for (const { p, r } of bottomProps)
      for (const [s, { v }] of P[p]) if (v && inDomain(r, s))
        for (let a = 0; a < n; a++) if (a !== s) addIc(r, a, s, C['prop-bottom'], p);
    for (const { o, p, r } of partMax)
      for (const s of out[W][o.args[0]]) if (s !== o.i && P[p].get(s)?.v && !I[r].hasAB(o.i, s) && inDomain(r, s))
        addI(r, o.i, s, { rule: 'op-part-max', prem: [fI(W, o.args[0], s), fP(p, s, true)] });
    // the lift, closure and elimination laws with the derived values (the implication
    // loop started with the cited ones): a new member gets the law on the implications
    // known so far, and drainI applies it to the later ones
    for (const l of lifting)
      for (const [s, { v }] of P[l.p]) if (v && !l.has.has(s)) {
        l.has.add(s);
        for (const b of [...out[l.from][s]]) addI(l.to, s, b, { rule: 'prop-lift', prem: [fI(l.from, s, b)] });
      }
    for (const c of closures)
      for (const [a, { v }] of P[c.p]) if (v && !c.has.has(a) && inDomain(c.r, a)) {
        c.has.add(a);
        for (const b of [...out[c.r][a]]) closeOver(c, a, b);
      }
    for (const e of elims)
      for (const [s, { v }] of P[e.p]) if (v && !e.has.has(s)) {
        e.has.add(s);
        for (const a of [...inn[e.r][s]]) elimI(e.r, a, s);
      }
    // properties defined by an operation: a derived value gives the implication
    // s → op(s, s), and a derived implication gives the value
    raw.properties.forEach((prop, p) => {
      if (!prop.selfOp) return;
      const r = ridx.get(prop.closedUnder);
      for (const [s, { v }] of P[p]) if (v) {
        const o = selfOpOf(p, s);
        if (o) addI(r, s, o.i, { rule: 'prop-self', prem: [fP(p, s, true)] });
      }
      for (const o of ops) if (o.op === prop.selfOp && o.args.length && o.args.every((x) => x === o.args[0]) && I[r].has(key(o.args[0], o.i)))
        setP(p, o.args[0], true, { rule: 'prop-self', prem: [fI(r, o.args[0], o.i)] });
    });
    if (queue.length > before) { changed = true; drainI(); }
    else if (pqueue.length > pbefore) changed = true;
  }

  // --- non-implications ----------------------------------------------------
  const fN = (r, a, b) => ({ t: 'N', r, a, b });
  const sepDown = raw.properties.map((prop) => prop.direction !== 'up');
  const decodeN = (r) => (a, b, c, x) => {
    switch (c) {
      case C.refine: return { rule: 'refine', prem: [fN(x, a, b)] };
      case C['weaken-left']: return { rule: 'weaken-left', prem: [fN(r, x, b), fI(r, x, a)] };
      case C['strengthen-right']: return { rule: 'strengthen-right', prem: [fN(r, a, x), fI(r, b, x)] };
      case C['prop-sep']: return { rule: 'prop-sep', prop: x, prem: [fP(x, a, sepDown[x]), fP(x, b, !sepDown[x])] };
      case C.direct: case C['prop-base']: return { rule: CODES[c], result: x };
      default: return { rule: CODES[c] };
    }
  };
  const N = R.map((_, r) => new FactTable(n, (s) => inDomain(r, s), wide, decodeN(r)));
  // The separations of each reduction, coarse to fine. Values read back from them
  // (characterized properties, properties defined by an operation) are propagated at
  // once, so the finer reductions see them (failing computable truth by an ω-model
  // separation gives the ≤c separations of `below`); the whole phase runs again while
  // new values appear, for the reductions already done.
  const NQ = R.map(() => []), NH = R.map(() => 0);
  // a new separation a ⇏ b over r: its rule code and number, or (code 1) a justification object
  const addNc = (r, a, b, code, aux, just) => {
    const T = N[r], la = T.loc[a], lb = T.loc[b];
    if (la < 0 || lb < 0) return;
    const i = la * T.d + lb;
    if (T.rule[i]) return;
    T.put(i, a * n + b, code, aux, just);
    NQ[r].push(a, b);
  };
  const addN = (r, a, b, just) => addNc(r, a, b, 1, 0, just);
  // refinement reads each separation of a coarser reduction once: refDone[r][r2] is
  // where it stopped in the list of N[r2]
  const refDone = R.map(() => new Map());
  const sepPass = (first) => {
    for (const r of order) {
      if (first) directResults.forEach((res, ri) => {
        if (res.type !== 'separation' || ![].concat(res.over).some((o) => ridx.get(o) === r)) return;
        const a = sidx.get(res.from), b = sidx.get(res.to);
        if (!inDomain(r, a) || !inDomain(r, b)) {
          errors.push(`Result #${ri} (${res.from} ⇏ ${res.to} over ${res.over}): statement outside the domain of the reduction`);
          return;
        }
        addNc(r, a, b, C.direct, ri);
      });
      if (first) for (const x of charSeeds(false)) if (x.r === r) addNc(r, x.b, x.s, C['prop-base'], x.ri);
      for (;;) {
        // a failure of a property defined by an operation: P does not imply op(P)
        raw.properties.forEach((prop, p) => {
          if (!prop.selfOp || ridx.get(prop.closedUnder) !== r) return;
          for (const [s, { v, just: j }] of P[p]) if (!v) {
            const o = selfOpOf(p, s);
            if (o) addN(r, s, o.i, j.rule === 'direct' ? { rule: 'prop-self', result: j.result } : { rule: 'prop-self', prem: [fP(p, s, false)] });
          }
        });
        // derived failures of a characterized property (failing cone avoidance ⇒ not
        // computably true) give the separation from the base too
        for (const { p, r: cr, dom } of charProps) {
          if (cr !== r) continue;
          for (const [x, { v, just: j }] of P[p])
            if (!v && j.rule !== 'direct' && charIn(cr, dom, x)) for (const b of basesAt(r)) addN(r, b, x, { rule: 'prop-base', prem: [fP(p, x, false)] });
        }
        raw.properties.forEach((prop, p) => {
          if (ridx.get(prop.closedUnder) !== r || prop.direction === 'equiv') return;
          const down = prop.direction !== 'up';
          const pos = [], neg = [];
          for (const [s, { v }] of P[p]) (v ? pos : neg).push(s);
          const [strong, weak] = down ? [pos, neg] : [neg, pos];
          for (const a of strong) for (const b of weak) addNc(r, a, b, C['prop-sep'], p);
        });
        // `below: {property: q, over: r}`: what is r-reducible to a problem with p has q on
        // its true instances (a problem c-reducible to a first-order one has solutions
        // computable from its instances, even when the first-order problem is not
        // ω-absolute and so not read as computably true). An ω-absolute t failing q is
        // therefore not r-reducible to s.
        raw.properties.forEach((prop, p) => {
          if (!prop.below || ridx.get(prop.below.over) !== r) return;
          const q = pidx.get(prop.below.property);
          const pos = [...P[p]].filter(([, x]) => x.v).map(([s]) => s).filter((s) => inDomain(r, s));
          const neg = [...P[q]].filter(([, x]) => !x.v).map(([t]) => t).filter((t) => absolute[t] && inDomain(r, t));
          for (const s of pos) for (const t of neg)
            if (s !== t) addN(r, s, t, { rule: 'prop-below', prop: p, prem: [fP(p, s, true), fP(q, t, false)] });
        });
        for (const r2 of coarserAll[r]) {
          const T2 = N[r2], T = N[r];
          for (let j = refDone[r].get(r2) || 0; j < T2.size; j++) {
            const k = T2.list[j];
            if (T.has(k)) continue;
            const a = Math.floor(k / n), b = k - a * n;
            if (bridge(r, r2, a, b)) addNc(r, a, b, C.refine, r2);
          }
          refDone[r].set(r2, T2.size);
        }
        const q = NQ[r];
        if (NH[r] === q.length) break;
        const conservationHere = R[r].conservation;
        while (NH[r] < q.length) {
          const a = q[NH[r]++], c = q[NH[r]++];
          if (conservationHere && consByBase.has(a)) {
            const f = formOf(c);
            if (f) for (const { x, cls, ri } of consByBase.get(a))
              if ((CLASS_MEMBERS[cls] || []).includes(f))
                addN(r, x, c, { rule: 'conservation', result: ri, prem: [fN(r, a, c)] });
          }
          // choice elimination, contrapositive: c ≰ a and c has p give c ≰ a ⋆ h (h ≤ factor)
          for (const e of elims) {
            if (e.r !== r || e.F === undefined || !P[e.p].get(c)?.v) continue;
            for (const o of opsByArg.get(a) || []) {
              if (o.op !== 'compose' || o.args[e.keep] !== a || o.args.includes(undefined)) continue;
              const h = o.args[1 - e.keep];
              if (I[r].has(key(e.F, h))) addN(r, o.i, c, { rule: 'prop-elim', prop: e.p, prem: [fN(r, a, c), fP(e.p, c, true), fI(r, e.F, h)] });
            }
          }
          // check before building the justification: most candidates are already known
          // b ⇏ c for the b that a implies, a ⇏ d for the d that imply c (I and N of r
          // share the indices of the domain of r)
          const T = N[r], TI = I[r], W = T.W, la = T.loc[a], lc = T.loc[c];
          eachNew(TI.row, la * W, T.col, lc * W, W, T.glob, (b) => addNc(r, b, c, C['weaken-left'], a));
          eachNew(TI.col, lc * W, T.row, la * W, W, T.glob, (d) => addNc(r, a, d, C['strengthen-right'], c));
        }
        // values read back from the separations of r: characterized properties (from
        // the base), properties defined by an operation (Det_Σ × Det_Σ ≰W Det_Σ: Det_Σ
        // is not idempotent); then their consequences, and again while r gets more
        const before = pqueue.length;
        for (const { p, r: cr, dom } of charProps) {
          if (cr !== r) continue;
          const b = basesAt(r)[0];
          if (b !== undefined) for (let s = 0; s < n; s++)
            if (charIn(r, dom, s) && !P[p].has(s) && N[r].has(key(b, s))) setP(p, s, false, { rule: 'prop-base', prem: [fN(r, b, s)] });
        }
        raw.properties.forEach((prop, p) => {
          if (!prop.selfOp || ridx.get(prop.closedUnder) !== r) return;
          for (const o of ops) if (o.op === prop.selfOp && o.args.length && o.args.every((x) => x === o.args[0]) && N[r].has(key(o.args[0], o.i)))
            setP(p, o.args[0], false, { rule: 'prop-self', prem: [fN(r, o.args[0], o.i)] });
        });
        drainP(false);
        if (pqueue.length === before) break;
      }
    }
  };
  for (let first = true; ; first = false) {
    const before = pqueue.length;
    sepPass(first);
    if (pqueue.length === before) break;
  }
  for (let r = 0; r < R.length; r++)
    for (const k of N[r].keys()) {
      if (I[r].has(k)) {
        const a = Math.floor(k / n), b = k % n;
        contradictions.push({ kind: 'implication', r, a, b, facts: [fI(r, a, b), fN(r, a, b)] });
      }
    }
  // characterized properties with a value from the implications only (the separations
  // gave theirs above)
  for (const { p, r, dom } of charProps)
    for (const b of basesAt(r).slice(0, 1))
      for (let s = 0; s < n; s++)
        if (charIn(r, dom, s) && !P[p].has(s) && I[r].has(key(b, s))) setP(p, s, true, { rule: 'prop-base', prem: [fI(r, b, s)] });
  drainP(false);

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
  // a question with sub-questions (`parts`): each part is settled on its own (its
  // comparisons, or its manual status; without either its status is not recorded:
  // `untracked`, left out of the count); the question is resolved when all the others
  // are, partially answered when some are. `parts` of the result: every comparison,
  // with `sub`, the index of its sub-question; `subs`: the status of each.
  if (q.parts?.length) {
    const subs = q.parts.map((p) => (p.formal?.length || p.status ? questionStatus(zoo, p) : { status: 'untracked', parts: [], results: [] }));
    const tracked = subs.filter((x) => x.status !== 'untracked');
    const n = tracked.filter((x) => x.status === 'resolved').length;
    const status = tracked.length && n === tracked.length ? 'resolved' : n || tracked.some((x) => x.status === 'partial') ? 'partial' : 'open';
    return { status, subs, parts: subs.flatMap((x, i) => x.parts.map((f) => ({ ...f, sub: i }))), results: [...new Set(subs.flatMap((x) => x.results))] };
  }
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
