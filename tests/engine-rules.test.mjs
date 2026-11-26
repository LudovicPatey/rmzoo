// Soundness of the inference rules: random models for the order rules, the
// justifications of the real database, and the rules without a test elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildZoo, factKey } from '../site/js/engine.js';

const st = (z, r, a, b) => z.status(z.ridx.get(r), z.sidx.get(a), z.sidx.get(b));
const pv = (z, p, s) => z.prop(z.pidx.get(p), z.sidx.get(s))?.v;

// ---- random models ------------------------------------------------------------
// A statement is a set of atoms 0..5; b ≤ a over `fine` when b ⊆ a, over `coarse` when
// b ∩ {0..3} ⊆ a ∩ {0..3} (atoms 4 and 5 are invisible there, so coarse is coarser). A
// conjunction is the union of its parts, the base the empty set. Properties are
// membership conditions, closed in the direction they claim. Every derived fact must
// hold in the model, whatever true facts are cited.
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
const COARSE = 0b1111;
const PROPS = [
  // id, closedUnder, direction, has(set)
  ['no0', 'coarse', 'down', (s) => !(s & 1)],
  ['no01', 'coarse', 'down', (s) => !(s & 3)],
  ['no1', 'coarse', 'down', (s) => !(s & 2)],
  ['has4', 'fine', 'up', (s) => !!(s & 16)],
  ['no5', 'fine', 'down', (s) => !(s & 32)],
];
function randomZoo(seed) {
  const rnd = rng(seed);
  const sets = { base: 0 };
  const statements = [{ id: 'base', kind: 'problem', base: true }];
  for (let i = 0; i < 9; i++) { sets[`s${i}`] = Math.floor(rnd() * 64); statements.push({ id: `s${i}`, kind: 'problem' }); }
  for (let i = 0; i < 3; i++) {
    const x = `s${Math.floor(rnd() * 9)}`, y = `s${Math.floor(rnd() * 9)}`;
    if (x === y || statements.some((s) => s.id === `${x}+${y}`)) continue;
    sets[`${x}+${y}`] = sets[x] | sets[y];
    statements.push({ id: `${x}+${y}`, kind: 'problem', conjunction: [x, y] });
  }
  const ids = statements.map((s) => s.id);
  const le = (r, b, a) => { const m = r === 'fine' ? 63 : COARSE; return ((sets[b] & m) & ~(sets[a] & m)) === 0; };
  const results = [];
  for (let k = 0; k < 40; k++) {
    const t = rnd();
    const a = ids[Math.floor(rnd() * ids.length)], b = ids[Math.floor(rnd() * ids.length)];
    const r = rnd() < 0.5 ? 'fine' : 'coarse';
    if (t < 0.7) {
      if (a === b) continue;
      results.push(le(r, b, a) ? { type: 'implication', from: a, to: b, over: r } : { type: 'separation', from: a, to: b, over: r });
    } else {
      const [id, , , has] = PROPS[Math.floor(rnd() * PROPS.length)];
      results.push({ type: 'property', statement: a, property: id, value: has(sets[a]) });
    }
  }
  const raw = {
    reductions: [
      { id: 'fine', domain: 'all', conjunction: true, finerThan: ['coarse'] },
      { id: 'coarse', domain: 'all', conjunction: true, finerThan: [] },
    ],
    properties: PROPS.map(([id, closedUnder, direction]) => ({ id, closedUnder, direction,
      ...(id === 'no01' ? { implies: ['no0', 'no1'], jointly: [['no0', 'no1']] } : {}) })),
    statements, results,
  };
  return { raw, sets, le };
}

test('random models: every derived implication, separation and property value holds', () => {
  let derived = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { raw, sets, le } = randomZoo(seed);
    const z = buildZoo(raw);
    assert.deepEqual(z.errors, [], `seed ${seed}`);
    assert.equal(z.contradictions.length, 0, `seed ${seed}`);
    const id = (i) => z.S[i].id;
    z.R.forEach((red, r) => {
      for (const k of z.I[r].keys()) {
        const a = id(Math.floor(k / z.n)), b = id(k % z.n);
        assert.ok(le(red.id, b, a), `seed ${seed}: ${a} → ${b} over ${red.id} (${z.I[r].get(k).rule}) is false in the model`);
        derived++;
      }
      for (const k of z.N[r].keys()) {
        const a = id(Math.floor(k / z.n)), b = id(k % z.n);
        assert.ok(!le(red.id, b, a), `seed ${seed}: ${a} ⇏ ${b} over ${red.id} (${z.N[r].get(k).rule}) is false in the model`);
        derived++;
      }
    });
    z.P.forEach((m, p) => {
      const has = PROPS.find(([pid]) => pid === z.raw.properties[p].id)[3];
      for (const [s, x] of m) assert.equal(x.v, has(sets[id(s)]), `seed ${seed}: ${z.raw.properties[p].id}(${id(s)}) by ${x.just.rule}`);
    });
  }
  assert.ok(derived > 10000); // the models are not trivial
});

// ---- the justifications of the real database ---------------------------------------
test('database: every premise of every justification holds, and no proof is circular', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../site/data/zoo.json', import.meta.url)));
  const z = buildZoo(raw);
  const facts = [];
  z.R.forEach((_, r) => {
    for (const k of z.I[r].keys()) facts.push({ t: 'I', r, a: Math.floor(k / z.n), b: k % z.n });
    for (const k of z.N[r].keys()) facts.push({ t: 'N', r, a: Math.floor(k / z.n), b: k % z.n });
  });
  z.P.forEach((m, p) => { for (const [s, x] of m) facts.push({ t: 'P', p, s, v: x.v }); });
  const missing = [];
  for (const f of facts) {
    const j = z.just(f);
    if (j.rule === 'direct' && j.result === undefined) missing.push(`${factKey(f)}: direct without a result`);
    for (const g of j.prem || []) if (!z.just(g)) missing.push(`${factKey(f)} (${j.rule}) rests on ${factKey(g)}, not derived`);
    if (missing.length > 20) break;
  }
  assert.deepEqual(missing, []);
  // circularity: a depth-first search over the premises of a sample of facts
  const state = new Map(); // 1 on the stack, 2 done
  const rnd = rng(7);
  for (let k = 0; k < 3000; k++) {
    const root = facts[Math.floor(rnd() * facts.length)];
    if (state.get(factKey(root)) === 2) continue;
    const stack = [[root, 0]];
    state.set(factKey(root), 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const prem = (z.just(top[0]).prem || []);
      if (top[1] < prem.length) {
        const g = prem[top[1]++], kg = factKey(g);
        const s = state.get(kg);
        assert.notEqual(s, 1, `circular proof through ${kg}`);
        if (!s) { state.set(kg, 1); stack.push([g, 0]); }
      } else { state.set(factKey(top[0]), 2); stack.pop(); }
    }
  }
});

// ---- rules without a test elsewhere ------------------------------------------------
const W2 = [
  { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
  { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
];

test('weaken-left, strengthen-right and refine', () => {
  const z = buildZoo({
    reductions: [{ id: 'fine', domain: 'all', finerThan: ['coarse'] }, { id: 'coarse', domain: 'all', finerThan: [] }],
    properties: [],
    statements: ['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'problem' })),
    results: [
      { type: 'separation', from: 'a', to: 'c', over: 'coarse' },
      { type: 'implication', from: 'a', to: 'b', over: 'coarse' },
      { type: 'implication', from: 'd', to: 'c', over: 'fine' },
    ],
  });
  assert.equal(st(z, 'coarse', 'b', 'c'), 'separated'); // a ⇏ c and a → b: b ⇏ c
  assert.equal(st(z, 'coarse', 'a', 'd'), 'separated'); // a ⇏ c and d → c: a ⇏ d
  assert.equal(st(z, 'fine', 'b', 'd'), 'separated');   // refined from the coarse separation b ⇏ d
  assert.equal(st(z, 'coarse', 'c', 'a'), 'open');
});

test('first-order statements hold in ω-models; a conjunction implies its parts', () => {
  const z = buildZoo({
    reductions: [{ id: 'omega', domain: 'all', omegaModels: true, conjunction: true, finerThan: [] }],
    properties: [],
    statements: [{ id: 'a', kind: 'sentence' }, { id: 'b', kind: 'sentence' }, { id: 'f', kind: 'sentence', firstOrder: true },
      { id: 'ab', kind: 'sentence', conjunction: ['a', 'b'] }],
    results: [],
  });
  assert.equal(st(z, 'omega', 'a', 'f'), 'implies');
  assert.equal(st(z, 'omega', 'ab', 'b'), 'implies');
  assert.equal(st(z, 'omega', 'a', 'ab'), 'open');
});

test('conservation: a statement conservative over the base proves no new sentence of the class', () => {
  const z = buildZoo({
    reductions: [{ id: 'rca0', domain: 'all', conservation: true, finerThan: [] }],
    properties: [],
    statements: [{ id: 'base', kind: 'sentence', base: true }, { id: 'wkl', kind: 'sentence' },
      { id: 'isig2', kind: 'sentence', firstOrder: true, form: 'Pi11' }, { id: 'aca', kind: 'sentence' }],
    results: [
      { type: 'conservation', statement: 'wkl', base: 'base', class: 'Pi11' },
      { type: 'separation', from: 'base', to: 'isig2', over: 'rca0' },
      { type: 'separation', from: 'base', to: 'aca', over: 'rca0' },
    ],
  });
  assert.equal(st(z, 'rca0', 'wkl', 'isig2'), 'separated');
  assert.equal(st(z, 'rca0', 'wkl', 'aca'), 'open'); // ACA₀ is not a Π¹₁ sentence
});

test('prop-bottom: a computably true problem is below every problem over c', () => {
  const z = buildZoo({
    reductions: [{ id: 'c', domain: 'problems', finerThan: [] }],
    properties: [{ id: 'ct', closedUnder: 'c', direction: 'down', bottomOf: 'c', domain: 'problems' }],
    statements: ['easy', 'x', 'y'].map((id) => ({ id, kind: 'problem' })),
    results: [{ type: 'property', statement: 'easy', property: 'ct', value: true }],
  });
  assert.equal(st(z, 'c', 'x', 'easy'), 'implies');
  assert.equal(st(z, 'c', 'x', 'y'), 'open');
});

test('prop-bottom: a uniformly computable problem is below every problem over w, not over sw', () => {
  const z = buildZoo({
    reductions: [{ id: 'sw', domain: 'problems', finerThan: ['w'] }, { id: 'w', domain: 'problems', finerThan: [] }],
    properties: [{ id: 'wc', closedUnder: 'w', direction: 'down', bottomOf: 'w', domain: 'problems' }],
    statements: ['easy', 'x', 'y'].map((id) => ({ id, kind: 'problem' })),
    results: [{ type: 'property', statement: 'easy', property: 'wc', value: true }],
  });
  assert.equal(st(z, 'w', 'x', 'easy'), 'implies');
  assert.equal(st(z, 'sw', 'x', 'easy'), 'open');
  assert.equal(st(z, 'w', 'x', 'y'), 'open');
});

test('pointed: the bottom rules and P ≤W P × Q skip the problems with no computable instance', () => {
  const z = buildZoo({
    reductions: [{ id: 'w', domain: 'problems', finerThan: [], algebra: 'weak' }],
    properties: [
      { id: 'wc', closedUnder: 'w', direction: 'down', bottomOf: 'w', domain: 'problems' },
      { id: 'pointed', closedUnder: 'w', direction: 'up', domain: 'problems' },
    ],
    statements: [...['easy', 'x', 'odd'].map((id) => ({ id, kind: 'problem' })), { id: 'x.x.odd', kind: 'problem', op: 'product', args: ['x', 'odd'] }],
    results: [
      { type: 'property', statement: 'easy', property: 'wc', value: true },
      { type: 'property', statement: 'odd', property: 'pointed', value: false },
    ],
  });
  assert.equal(st(z, 'w', 'x', 'easy'), 'implies');
  assert.equal(st(z, 'w', 'odd', 'easy'), 'open'); // easy may have computable instances
  assert.equal(st(z, 'w', 'x.x.odd', 'easy'), 'open');
  assert.equal(st(z, 'w', 'x.x.odd', 'x'), 'open'); // x ≤W x × odd needs odd pointed
  assert.equal(st(z, 'w', 'x.x.odd', 'odd'), 'implies'); // odd ≤W x × odd: x is pointed
});

test('closure, contrapositive: P̂ ≰W Q with Q parallelizable gives P ≰W Q', () => {
  const z = buildZoo({
    reductions: [{ id: 'w', domain: 'problems', finerThan: [], algebra: 'weak' }],
    properties: [{ id: 'par', closedUnder: 'w', direction: 'equiv', domain: 'problems', selfOp: 'par', opHas: ['par'], closure: ['par'] }],
    statements: [...['q', 'p', 'r'].map((id) => ({ id, kind: 'problem' })), { id: 'p.par', kind: 'problem', op: 'par', args: ['p'] }, { id: 'r.par', kind: 'problem', op: 'par', args: ['r'] }],
    results: [
      { type: 'property', statement: 'q', property: 'par', value: true },
      { type: 'separation', from: 'q', to: 'p.par', over: 'w' },
      { type: 'separation', from: 'p', to: 'r.par', over: 'w' },
    ],
  });
  assert.equal(st(z, 'w', 'q', 'p'), 'separated'); // p ≰W q
  const f = z.proof({ t: 'N', r: z.ridx.get('w'), a: z.sidx.get('q'), b: z.sidx.get('p') });
  assert.equal(f.rule, 'prop-closure');
  assert.equal(st(z, 'w', 'p', 'r'), 'open'); // p is not known to be parallelizable
});

test('below: failing computable truth by an ω-model separation separates from first-order problems over c', () => {
  const z = buildZoo({
    reductions: [{ id: 'c', domain: 'problems', finerThan: ['omega'] }, { id: 'omega', domain: 'all', omegaModels: true, finerThan: [] }],
    properties: [
      { id: 'ct', closedUnder: 'c', direction: 'down', baseImplication: 'omega', domain: 'problems' },
      { id: 'fo', domain: 'problems', implies: ['ct'], below: { property: 'ct', over: 'c' } },
    ],
    statements: [{ id: 'rca', kind: 'sentence', base: ['omega'] }, { id: 'non', kind: 'problem' }, { id: 'f', kind: 'problem', omegaAbsolute: false }],
    results: [
      { type: 'separation', from: 'rca', to: 'non', over: 'omega' },
      { type: 'property', statement: 'f', property: 'fo', value: true },
    ],
  });
  assert.equal(pv(z, 'ct', 'non'), false);
  assert.equal(st(z, 'c', 'f', 'non'), 'separated'); // non ≰c f, from the value read back from ω
});

test('characterized properties: not read from ω-models for a non-absolute statement', () => {
  const z = buildZoo({
    reductions: [{ id: 'c', domain: 'problems', finerThan: ['omega'] }, { id: 'omega', domain: 'all', omegaModels: true, finerThan: [] }],
    properties: [{ id: 'ct', closedUnder: 'c', direction: 'down', baseImplication: 'omega', domain: 'problems' }],
    statements: [{ id: 'rca', kind: 'sentence', base: ['omega'] }, { id: 'u', kind: 'problem', omegaAbsolute: false },
      { id: 'v', kind: 'problem', omegaAbsolute: false }, { id: 'hard', kind: 'problem' }],
    results: [
      { type: 'separation', from: 'rca', to: 'u', over: 'omega' },
      { type: 'implication', from: 'rca', to: 'v', over: 'omega' },
      { type: 'implication', from: 'v', to: 'hard', over: 'c' },
      { type: 'property', statement: 'hard', property: 'ct', value: false },
    ],
  });
  assert.equal(pv(z, 'ct', 'u'), undefined); // an ω-model separation says nothing of the true instances
  assert.equal(pv(z, 'ct', 'v'), false);     // from the c-reduction, not from the ω-model implication
  assert.equal(z.contradictions.length, 0);
  assert.equal(st(z, 'omega', 'rca', 'v'), 'implies'); // and no ω-model separation back from it
});

test('a derived cylinder lifts W-reductions to it; a derived total fractal eliminates C_ℕ', () => {
  // the values come from properties that imply them, not from cited results
  const z = buildZoo({
    reductions: W2,
    properties: [
      { id: 'cyl', closedUnder: 'sw', direction: 'equiv', domain: 'problems', lift: { from: 'w', to: 'sw' } },
      { id: 'scyl', closedUnder: 'sw', direction: 'equiv', domain: 'problems', implies: ['cyl'] },
      { id: 'tf', closedUnder: 'w', direction: 'equiv', domain: 'problems', eliminates: { side: 'right', factor: 'cn' } },
      { id: 'stf', closedUnder: 'w', direction: 'equiv', domain: 'problems', implies: ['tf'] },
    ],
    statements: [
      ...['a', 'b', 'g', 'cn', 'h', 'f'].map((id) => ({ id, kind: 'problem' })),
      { id: 'g.star.h', kind: 'problem', op: 'compose', args: ['g', 'h'] },
    ],
    results: [
      { type: 'property', statement: 'a', property: 'scyl', value: true },
      { type: 'implication', from: 'a', to: 'b', over: 'w' },
      { type: 'property', statement: 'f', property: 'stf', value: true },
      { type: 'implication', from: 'g.star.h', to: 'f', over: 'w' },
      { type: 'implication', from: 'cn', to: 'h', over: 'w' },
    ],
  });
  assert.equal(pv(z, 'cyl', 'a'), true);
  assert.equal(st(z, 'sw', 'a', 'b'), 'implies');
  assert.equal(st(z, 'w', 'g', 'f'), 'implies');
});

test('properties defined by an operation: derived values give the implication or separation, and back', () => {
  const z = buildZoo({
    reductions: W2,
    properties: [{ id: 'idem', closedUnder: 'w', direction: 'equiv', domain: 'problems', selfOp: 'product' }],
    statements: [
      ...['a', 'a2', 'b', 'b2', 'c', 'd'].map((id) => ({ id, kind: 'problem' })),
      ...['a2', 'b2', 'c', 'd'].map((x) => ({ id: `${x}.x.${x}`, kind: 'problem', op: 'product', args: [x, x] })),
    ],
    results: [
      { type: 'property', statement: 'a', property: 'idem', value: true },
      { type: 'equivalence', from: 'a', to: 'a2', over: 'w' },
      { type: 'property', statement: 'b', property: 'idem', value: false },
      { type: 'equivalence', from: 'b', to: 'b2', over: 'w' },
      { type: 'implication', from: 'c', to: 'd.x.d', over: 'w' },
      { type: 'equivalence', from: 'c', to: 'd', over: 'w' },
    ],
  });
  assert.equal(st(z, 'w', 'a2', 'a2.x.a2'), 'implies');   // derived idempotence
  assert.equal(st(z, 'w', 'b2', 'b2.x.b2'), 'separated'); // derived failure
  assert.equal(pv(z, 'idem', 'd'), true);                 // d → d × d by monotonicity and transitivity
  assert.equal(pv(z, 'idem', 'c'), true);
});

test('jointly: failing the target with all parts but one fails the last part', () => {
  const z = buildZoo({
    reductions: W2,
    properties: [
      { id: 'par', closedUnder: 'w', direction: 'equiv', domain: 'problems' },
      { id: 'cyl', closedUnder: 'sw', direction: 'equiv', domain: 'problems' },
      { id: 'spar', closedUnder: 'sw', direction: 'equiv', domain: 'problems', jointly: [['par', 'cyl']] },
    ],
    statements: [{ id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }],
    results: [
      { type: 'property', statement: 'a', property: 'par', value: true },
      { type: 'property', statement: 'a', property: 'cyl', value: true },
      { type: 'property', statement: 'b', property: 'cyl', value: true },
      { type: 'property', statement: 'b', property: 'spar', value: false },
    ],
  });
  assert.equal(pv(z, 'spar', 'a'), true);
  assert.equal(pv(z, 'par', 'b'), false);
});

test('proofs and sources: a derived fact traces back to its published results', () => {
  const z = buildZoo({
    reductions: [{ id: 'r', domain: 'all', finerThan: [] }],
    properties: [],
    statements: ['a', 'b', 'c'].map((id) => ({ id, kind: 'problem' })),
    results: [
      { type: 'implication', from: 'a', to: 'b', over: 'r' },
      { type: 'implication', from: 'b', to: 'c', over: 'r' },
      { type: 'separation', from: 'b', to: 'a', over: 'r' },
    ],
  });
  const s = (id) => z.sidx.get(id);
  const f = { t: 'N', r: 0, a: s('c'), b: s('a') };
  assert.deepEqual(z.sources(f).sort(), [1, 2]);
  const tree = z.proof(f);
  assert.equal(tree.rule, 'weaken-left');
  assert.ok(tree.children.every((c) => c.rule === 'direct'));
});
