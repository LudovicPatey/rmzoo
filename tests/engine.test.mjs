import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildZoo, orderView } from '../site/js/engine.js';

// ---- toy zoo: checks the rules in isolation ---------------------------------
const toy = {
  reductions: [
    { id: 'fine', domain: 'problems', finerThan: ['coarse'] },
    { id: 'coarse', domain: 'all', conjunction: true, finerThan: [] },
  ],
  properties: [{ id: 'p', closedUnder: 'coarse', direction: 'down' }],
  statements: [
    { id: 'base', kind: 'problem', base: true },
    { id: 'a', kind: 'problem' },
    { id: 'b', kind: 'problem' },
    { id: 'c', kind: 'problem' },
    { id: 's', kind: 'sentence' },
    { id: 'bc', kind: 'sentence', conjunction: ['b', 'c'] },
  ],
  results: [
    { type: 'implication', from: 'a', to: 'b', over: 'fine' },
    { type: 'implication', from: 'a', to: 'c', over: 'coarse' },
    { type: 'property', statement: 'b', property: 'p', value: true },
    { type: 'property', statement: 's', property: 'p', value: false },
  ],
};

test('toy: coarsening, conjunction, domain', () => {
  const z = buildZoo(toy);
  const st = (r, a, b) => z.status(z.ridx.get(r), z.sidx.get(a), z.sidx.get(b));
  assert.equal(st('fine', 'a', 'b'), 'implies');
  assert.equal(st('coarse', 'a', 'b'), 'implies'); // coarsen
  assert.equal(st('coarse', 'a', 'bc'), 'implies'); // conj-intro
  assert.equal(st('fine', 'a', 's'), 'na'); // sentence outside problem domain
  assert.equal(st('coarse', 'b', 's'), 'separated'); // prop-sep
  assert.equal(st('coarse', 'a', 's'), 'open'); // a not known to have p... (only b does)
  assert.equal(z.contradictions.length, 0);
});

// ---- real database: known facts must be derived -----------------------------
const raw = JSON.parse(fs.readFileSync(new URL('../site/data/zoo.json', import.meta.url)));
const z = buildZoo(raw);
const st = (r, a, b) => z.status(z.ridx.get(r), z.sidx.get(a), z.sidx.get(b));

test('database is consistent', () => {
  assert.deepEqual(z.errors, []);
  assert.equal(z.contradictions.length, 0);
});

const expected = [
  ['rca0', 'rt22', 'wkl', 'separated'],      // Liu, via PA avoidance
  ['omega', 'wkl', 'srt22', 'separated'],    // low basis vs DHLS
  ['rca0', 'wkl', 'bsig2', 'separated'],     // Π¹₁ conservation
  ['rca0', 'rt22', 'aca', 'separated'],      // cone avoidance
  ['rca0', 'srt22', 'd22', 'implies'],
  ['rca0', 'd22', 'srt22', 'implies'],
  ['w', 'd22', 'srt22', 'separated'],
  ['rca0', 'rt22', 'coh-srt22', 'implies'],  // conj-intro
  ['omega', 'bsig2', 'rca0', 'implies'],
  ['omega', 'rca0', 'bsig2', 'implies'],     // first-order in ω-models
  ['rca0star', 'rcastar', 'isig1', 'separated'],
  ['rca0star', 'rca0', 'isig1', 'implies'],   // over RCA0*, RCA0 is a genuine statement
  ['rca0star', 'isig1', 'rca0', 'implies'],
  ['rca0', 'isig1', 'rca0', 'implies'],       // over RCA0 it is the bottom
  ['w', 'rca0', 'wkl', 'na'],                 // no base problem for Weihrauch reductions
  ['c', 'rt22', 'rt12', 'implies'],
  ['c', 'rt22', 'rt23', 'separated'],
  ['rca0', 'rt22', 'rt23', 'implies'],
  ['sw', 'rt22', 'cac', 'implies'],
  ['omega', 'em', 'rt22', 'separated'],
  ['rca0', 'rt22', 'rt1inf', 'implies'],     // via BΣ⁰₂
  ['rca0', 'rt22', 'bsig3', 'separated'],    // conservation over IΣ⁰₂ (CJS01) + Paris–Kirby
  ['w', 'wkl', 'llpo', 'implies'],
  ['w', 'llpo', 'wkl', 'separated'],
  ['c', 'adc', 'ads', 'implies'],
  ['w', 'adc', 'ads', 'separated'],          // ADC does not even compute SADS uniformly
  ['rca0', 'adc', 'ads', 'implies'],
  ['omega', 'ovw', 'rt22', 'separated'],
  ['w', 'wkl-j', 'lim', 'implies'],
  ['rca0', 'rsg', 'aca', 'implies'],
];
for (const [r, a, b, s] of expected)
  test(`${a} ${s} ${b} over ${r}`, () => assert.equal(st(r, a, b), s));

test('diagram view collapses SRT22 and D22 over RCA0 but not over W', () => {
  const v1 = orderView(z, ['srt22', 'd22', 'rt22'], z.ridx.get('rca0'));
  assert.equal(v1.classes.length, 2);
  assert.equal(z.S[v1.reps[v1.classOf.get(z.sidx.get('d22'))]].id, 'srt22'); // main formulation shown
  const v2 = orderView(z, ['srt22', 'd22', 'rt22'], z.ridx.get('w'));
  assert.equal(v2.classes.length, 3);
});

// ---- Weihrauch algebra -----------------------------------------------------------
test('operator statements: P below its jump, parallelization; monotonicity', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' },
      { id: 'a.jump', kind: 'problem', op: 'jump', args: ['a'] },
      { id: 'b.jump', kind: 'problem', op: 'jump', args: ['b'] },
      { id: 'a.fin', kind: 'problem', op: 'fin', args: ['a'] },
      { id: 'a.par', kind: 'problem', op: 'par', args: ['a'] },
      { id: 'a.x.b', kind: 'problem', op: 'product', args: ['a', 'b'] },
      { id: 'a.star.b', kind: 'problem', op: 'compose', args: ['a', 'b'] },
    ],
    results: [{ type: 'implication', from: 'a', to: 'b', over: 'sw', refs: [{ ref: 'x' }] }],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('sw', 'a.jump', 'a'), 'implies');      // a ≤sW a'
  assert.equal(st('sw', 'a.jump', 'b.jump'), 'implies'); // b ≤sW a ⇒ b' ≤sW a'
  assert.equal(st('sw', 'a.par', 'a.fin'), 'implies');   // a* ≤sW â
  assert.equal(st('w', 'a.x.b', 'b'), 'implies');        // b ≤W a × b
  assert.equal(st('sw', 'a.x.b', 'b'), 'open');          // products only for ≤W
  assert.equal(st('w', 'a.star.b', 'a.x.b'), 'implies'); // a × b ≤W a ⋆ b
  assert.equal(st('w', 'b.jump', 'a.jump'), 'open');
});

test('base lift: over RCA₀*, a statement implying RCA₀ has its RCA₀ consequences', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'rca0star', finerThan: ['rca0'] },
      { id: 'rca0', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'rcastar', kind: 'sentence', base: ['rca0star', 'rca0'] }, { id: 'rca0', kind: 'sentence', base: ['rca0'] },
      { id: 'a', kind: 'sentence' }, { id: 'b', kind: 'sentence' }, { id: 'c', kind: 'sentence' },
    ],
    results: [
      { type: 'implication', from: 'a', to: 'rca0', over: 'rca0star', refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'a', to: 'b', over: 'rca0', refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'c', to: 'b', over: 'rca0', refs: [{ ref: 'x' }] },
    ],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('rca0star', 'a', 'b'), 'implies');  // RCA₀* + a ⊢ IΣ⁰₁, so RCA₀* + a ⊇ RCA₀ + a ⊢ b
  assert.equal(st('rca0star', 'c', 'b'), 'open');     // c does not imply RCA₀
});

test('the jump is monotone for ≤sW only: b ≤W a does not give b′ ≤W a′', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' },
      { id: 'a.jump', kind: 'problem', op: 'jump', args: ['a'] },
      { id: 'b.jump', kind: 'problem', op: 'jump', args: ['b'] },
      { id: 'a.par', kind: 'problem', op: 'par', args: ['a'] },
      { id: 'b.par', kind: 'problem', op: 'par', args: ['b'] },
    ],
    results: [{ type: 'implication', from: 'a', to: 'b', over: 'w', refs: [{ ref: 'x' }] }],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('w', 'a.jump', 'b.jump'), 'open');    // the identity is below lim, its jump is lim
  assert.equal(st('w', 'a.par', 'b.par'), 'implies');   // parallelization is monotone for ≤W
});

test('diamond: P ≤W P⋄, closed under ⋆ and ×, monotone; not for ≤sW', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' },
      { id: 'a.diamond', kind: 'problem', op: 'diamond', args: ['a'] },
      { id: 'b.diamond', kind: 'problem', op: 'diamond', args: ['b'] },
      { id: 'b.star.b', kind: 'problem', op: 'compose', args: ['b', 'b'] },
    ],
    results: [{ type: 'implication', from: 'a', to: 'b', over: 'w', refs: [{ ref: 'x' }] }],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('w', 'a.diamond', 'a'), 'implies');
  assert.equal(st('sw', 'a.diamond', 'a'), 'open');
  assert.equal(st('w', 'b.diamond', 'b.star.b'), 'implies');     // b ⋆ b ≤W b⋄
  assert.equal(st('w', 'a.diamond', 'b.star.b'), 'implies');     // b ≤W a ≤W a⋄, closure under ⋆
  assert.equal(st('w', 'a.diamond', 'b.diamond'), 'implies');    // monotone
});

// ---- properties characterized by the base (baseImplication) ----------------
test('toy: computably true ⟺ the base implies it over ω-models', () => {
  const z = buildZoo({
    reductions: [{ id: 'c', domain: 'problems', finerThan: ['omega'] }, { id: 'omega', domain: 'all', finerThan: [] }],
    properties: [{ id: 'ct', closedUnder: 'c', direction: 'down', baseImplication: 'omega' }],
    statements: [
      { id: 'base', kind: 'sentence', base: ['omega'] },
      { id: 'non', kind: 'problem' }, { id: 'lpo', kind: 'problem' }, { id: 'easy', kind: 'problem' },
    ],
    results: [
      { type: 'separation', from: 'base', to: 'non', over: 'omega' },   // RCA₀ ⇏ NON over ω
      { type: 'property', statement: 'lpo', property: 'ct', value: true },
      { type: 'implication', from: 'lpo', to: 'easy', over: 'c' },
    ],
  });
  const ct = z.pidx.get('ct'), s = (id) => z.sidx.get(id);
  assert.equal(z.prop(ct, s('non')).v, false);                       // from the separation
  assert.equal(z.status(z.ridx.get('omega'), s('base'), s('lpo')), 'implies'); // from the property
  assert.equal(z.prop(ct, s('easy')).v, true);
  assert.equal(z.status(z.ridx.get('c'), s('lpo'), s('non')), 'separated');
  assert.equal(z.prop(ct, s('base')), undefined);                    // sentences are outside the domain
});

// ---- properties of problems; implications between properties ---------------------
test('properties of problems skip first-order sentences; implications between properties', () => {
  const zoo = buildZoo({
    reductions: [{ id: 'rca0', finerThan: ['omega'] }, { id: 'omega', finerThan: [] }],
    properties: [
      { id: 'low', closedUnder: 'omega', direction: 'down', domain: 'problems', implies: ['wlow'] },
      { id: 'wlow', closedUnder: 'omega', direction: 'down', domain: 'problems', implies: ['low2'] },
      { id: 'low2', closedUnder: 'omega', direction: 'down', domain: 'problems' },
    ],
    classes: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'c', kind: 'sentence' },
      { id: 'fo', kind: 'sentence', firstOrder: true }, { id: 'x', kind: 'problem' },
    ],
    results: [
      { type: 'property', statement: 'a', property: 'low', value: true, refs: [{ ref: 'r' }] },
      { type: 'implication', from: 'a', to: 'b', over: 'rca0', refs: [{ ref: 'r' }] },
      { type: 'implication', from: 'a', to: 'fo', over: 'rca0', refs: [{ ref: 'r' }] },
      { type: 'property', statement: 'x', property: 'low2', value: false, refs: [{ ref: 'r' }] },
      { type: 'property', statement: 'c', property: 'wlow', value: true, refs: [{ ref: 'r' }] },
    ],
  });
  const v = (p, s) => zoo.prop(zoo.pidx.get(p), zoo.sidx.get(s))?.v;
  assert.equal(v('low2', 'a'), true);   // low ⇒ weakly low ⇒ low₂
  assert.equal(v('low2', 'b'), true);   // and down along a ⇒ b
  assert.equal(v('low', 'fo'), undefined); // first-order: not a problem
  assert.equal(v('low', 'x'), false);   // fails low₂ ⇒ fails low
  assert.equal(v('low2', 'c'), true);   // a Π¹₂ sentence can carry them
  assert.equal(zoo.status(zoo.ridx.get('omega'), zoo.sidx.get('a'), zoo.sidx.get('x')), 'separated');
  assert.equal(zoo.contradictions.length, 0);
});

test('a property preserved by no reduction is only related to the others', () => {
  const zoo = buildZoo({
    reductions: [{ id: 'c', domain: 'problems', finerThan: [] }],
    properties: [
      { id: 'd2', closedUnder: 'c', direction: 'down', domain: 'problems', implies: ['s2'] },
      { id: 's2', domain: 'problems' },
    ],
    classes: [],
    statements: [{ id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'x', kind: 'problem' }],
    results: [
      { type: 'property', statement: 'a', property: 's2', value: true, refs: [{ ref: 'r' }] },
      { type: 'implication', from: 'a', to: 'b', over: 'c', refs: [{ ref: 'r' }] },
      { type: 'property', statement: 'x', property: 's2', value: false, refs: [{ ref: 'r' }] },
    ],
  });
  const v = (p, s) => zoo.prop(zoo.pidx.get(p), zoo.sidx.get(s))?.v;
  assert.equal(v('s2', 'b'), undefined); // not passed along a ⇒ b
  assert.equal(v('d2', 'x'), false);     // fails Σ⁰₂ ⇒ fails Δ⁰₂
  assert.equal(zoo.status(zoo.ridx.get('c'), zoo.sidx.get('a'), zoo.sidx.get('x')), 'open'); // no separation from s2 alone
});

test('salient properties: strongest held, weakest failed, open ones in a gap', () => {
  // ct ⇒ low ⇒ wlow ⇒ low2, low ⇒ d2 ⇒ s2; ca main property implied by ct
  const opt = { domain: 'problems', optional: true };
  const zoo = buildZoo({
    reductions: [{ id: 'omega', finerThan: [] }],
    properties: [
      { id: 'ct', domain: 'problems', implies: ['low', 'ca'] },
      { id: 'ca', domain: 'problems' },
      { id: 'low', domain: 'problems', implies: ['wlow', 'd2'] },
      { id: 'wlow', ...opt, implies: ['low2'] },
      { id: 'low2', ...opt },
      { id: 'd2', ...opt, implies: ['s2'] },
      { id: 's2', ...opt },
    ],
    classes: [],
    statements: [{ id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'c', kind: 'problem' }],
    results: [
      { type: 'property', statement: 'a', property: 'ct', value: true, refs: [{ ref: 'r' }] },
      { type: 'property', statement: 'b', property: 'wlow', value: true, refs: [{ ref: 'r' }] },
      { type: 'property', statement: 'b', property: 'ct', value: false, refs: [{ ref: 'r' }] },
      { type: 'property', statement: 'c', property: 'low2', value: false, refs: [{ ref: 'r' }] },
    ],
  });
  const names = (s) => zoo.salientProps(zoo.sidx.get(s)).map((p) => zoo.raw.properties[p].id).sort();
  assert.deepEqual(names('a'), ['ct']);                     // everything else follows
  assert.deepEqual(names('b'), ['ca', 'ct', 'low', 'wlow']); // low: open between wlow ✓ and ct ✗; ca: main, open
  assert.deepEqual(names('c'), ['ca', 'low2']);              // fails low2: wlow, low, ct fail too
});

// ---- Weihrauch properties (direction equiv, selfOp, opHas, opKeeps, lift) -----
test('Weihrauch properties: invariance, operations, cited values, cylinder lift', () => {
  const props = [
    { id: 'cyl', group: 'weihrauch', closedUnder: 'sw', direction: 'equiv', domain: 'problems', opHas: ['compose'], opKeeps: ['jump'], lift: { from: 'w', to: 'sw' } },
    { id: 'par', group: 'weihrauch', closedUnder: 'w', direction: 'equiv', domain: 'problems', selfOp: 'par', opHas: ['par'], implies: ['idem'] },
    { id: 'idem', group: 'weihrauch', closedUnder: 'w', direction: 'equiv', domain: 'problems', selfOp: 'product' },
  ];
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: props,
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'c', kind: 'problem' }, { id: 'd', kind: 'problem' },
      { id: 's', kind: 'sentence' },
      { id: 'a.par', kind: 'problem', op: 'par', args: ['a'] },
      { id: 'b.x.b', kind: 'problem', op: 'product', args: ['b', 'b'] },
      { id: 'c.x.c', kind: 'problem', op: 'product', args: ['c', 'c'] },
      { id: 'a.star.b', kind: 'problem', op: 'compose', args: ['a', 'b'] },
      { id: 'c.jump', kind: 'problem', op: 'jump', args: ['c'] },
    ],
    results: [
      { type: 'equivalence', from: 'a', to: 'a.par', over: 'w', refs: [{ ref: 'x' }] },    // a is parallelizable
      { type: 'separation', from: 'b', to: 'b.x.b', over: 'w', refs: [{ ref: 'x' }] },     // b is not idempotent
      { type: 'property', statement: 'c', property: 'idem', value: true, refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'c', property: 'cyl', value: true, refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'c', to: 'd', over: 'w', refs: [{ ref: 'x' }] },       // d ≤W c, c a cylinder
    ],
  });
  const P = (p, s) => zoo.prop(zoo.pidx.get(p), zoo.sidx.get(s))?.v;
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(P('par', 'a.par'), true);       // opHas: P̂ is parallelizable
  assert.equal(P('par', 'a'), true);           // invariant under ≡W (and selfOp from a → a.par)
  assert.equal(P('idem', 'a'), true);          // parallelizable ⇒ idempotent
  assert.equal(P('idem', 'b'), false);         // selfOp: b ⇏ b × b
  assert.equal(P('par', 'b'), false);          // failing idempotency ⇒ not parallelizable
  assert.equal(st('w', 'c', 'c.x.c'), 'implies'); // a cited value gives c → c × c
  assert.equal(P('cyl', 'a.star.b'), true);    // compositional products are cylinders
  assert.equal(P('cyl', 'c.jump'), true);      // the jump of a cylinder is a cylinder
  assert.equal(st('sw', 'c', 'd'), 'implies'); // lift: W-reductions to a cylinder are strong
  assert.equal(P('idem', 's'), undefined);     // sentences are outside the domain
  assert.equal(st('w', 'a', 'b'), 'open');     // Weihrauch properties separate nothing
  assert.equal(zoo.contradictions.length, 0);
});
