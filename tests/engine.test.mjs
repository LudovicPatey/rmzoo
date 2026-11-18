import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildZoo, orderView, questionStatus } from '../site/js/engine.js';

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
  ['omega', 'ovw0', 'rt22', 'separated'],
  ['w', 'wkl-j', 'lim', 'implies'],
  ['rca0', 'rsg', 'aca', 'implies'],
  ['soc', 'sd', 'rt12', 'implies'],          // sc gives soc
  ['soc', 'rt22', 'rt12', 'implies'],        // sW → sc → soc
  ['sc', 'rt12', 'sd', 'separated'],         // a separation at soc holds at sc (HLL, Theorem 7.5)
  ['c', 'rt12.fin', 'rt13', 'implies'],
  ['c', 'rt12', 'sd', 'implies'],            // SD is computably true (prop-bottom), though SD ≰soc RT¹₂
  ['c', 'lpo', 'rt13', 'implies'],           // computably true problems are ≤c everything
  ['sc', 'rt13', 'lpo', 'implies'],          // first-order problems are ≤sc everything
  ['sc', 'wkl', 'cn', 'implies'],
  ['sc', 'lpo', 'wkl', 'separated'],
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

test('joint property laws: a parallelizable cylinder is strongly parallelizable', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [
      { id: 'cyl', closedUnder: 'sw', direction: 'equiv', domain: 'problems' },
      { id: 'par', closedUnder: 'w', direction: 'equiv', domain: 'problems' },
      { id: 'spar', closedUnder: 'sw', direction: 'equiv', domain: 'problems', implies: ['par'], jointly: [['par', 'cyl']] },
    ],
    statements: [{ id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'c', kind: 'problem' }],
    results: [
      { type: 'property', statement: 'a', property: 'par', value: true, refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'a', property: 'cyl', value: true, refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'b', property: 'spar', value: false, refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'b', property: 'cyl', value: true, refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'c', property: 'par', value: true, refs: [{ ref: 'x' }] },
    ],
  });
  const v = (p, s) => zoo.prop(zoo.pidx.get(p), zoo.sidx.get(s))?.v;
  assert.equal(v('spar', 'a'), true);   // par + cyl
  assert.equal(v('par', 'b'), false);   // not spar, cyl ⇒ not par
  assert.equal(v('spar', 'c'), undefined);
  assert.equal(zoo.contradictions.length, 0);
});

test('continuous and arithmetic Weihrauch reductions: coarser than W, their own laws', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: ['cw', 'aw', 'c'] },
      { id: 'cw', domain: 'problems', algebra: 'weak', finerThan: [] },
      { id: 'aw', domain: 'problems', algebra: 'arithmetic', finerThan: [] },
      { id: 'c', domain: 'problems', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'd', kind: 'problem' },
      { id: 'a.jump', kind: 'problem', op: 'jump', args: ['a'] },
      { id: 'b.jump', kind: 'problem', op: 'jump', args: ['b'] },
      { id: 'a.par', kind: 'problem', op: 'par', args: ['a'] },
      { id: 'b.par', kind: 'problem', op: 'par', args: ['b'] },
      { id: 'a.star.d', kind: 'problem', op: 'compose', args: ['a', 'd'] },
      { id: 'b.star.d', kind: 'problem', op: 'compose', args: ['b', 'd'] },
    ],
    results: [
      { type: 'implication', from: 'a', to: 'b', over: 'aw', refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'a', to: 'b', over: 'cw', refs: [{ ref: 'x' }] },
      { type: 'separation', from: 'd', to: 'a', over: 'cw', refs: [{ ref: 'x' }] },
    ],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('w', 'd', 'a'), 'separated');           // a ≰cW d ⇒ a ≰W d
  assert.equal(st('c', 'd', 'a'), 'open');                // but says nothing of computable reductions
  assert.equal(st('aw', 'd', 'a'), 'open');               // nor of arithmetic ones
  assert.equal(st('aw', 'a', 'a.jump'), 'implies');       // a′ ≡aW a
  assert.equal(st('aw', 'a.jump', 'b.jump'), 'implies');  // jumps monotone for ≤aW
  assert.equal(st('aw', 'a.par', 'b.par'), 'implies');    // parallelization monotone
  assert.equal(st('aw', 'a.star.d', 'b.star.d'), 'open'); // no monotonicity of ⋆ for ≤aW
  assert.equal(st('cw', 'a.star.d', 'b.star.d'), 'implies'); // all laws of ≤W for ≤cW
  assert.equal(st('cw', 'a.jump', 'b.jump'), 'open');     // but jumps are not monotone
  assert.equal(st('cw', 'a', 'a.jump'), 'open');
});

test('products commute, and a product is below the compositional products in either order', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'c', kind: 'problem' },
      { id: 'a.x.b', kind: 'problem', op: 'product', args: ['a', 'b'] },
      { id: 'b.x.a', kind: 'problem', op: 'product', args: ['b', 'a'] },
      { id: 'b.star.a', kind: 'problem', op: 'compose', args: ['b', 'a'] },
    ],
    // the pattern of Dzhafarov et al. 2018, Corollary 2.8: SRT²₂ × COH ≰W RT²₂
    results: [{ type: 'separation', from: 'c', to: 'a.x.b', over: 'w', refs: [{ ref: 'x' }] }],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('w', 'a.x.b', 'b.x.a'), 'implies');
  assert.equal(st('w', 'b.x.a', 'a.x.b'), 'implies');
  assert.equal(st('w', 'b.star.a', 'a.x.b'), 'implies'); // a × b ≡W b × a ≤W b ⋆ a
  assert.equal(st('w', 'c', 'b.star.a'), 'separated');
  assert.equal(st('sw', 'a.x.b', 'b.x.a'), 'open');      // the laws on products are only used for ≤W
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

test('unbounded finite parallelization: P* ≤sW P^u* ≤W P̂, monotone for ≤sW', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' },
      { id: 'a.fin', kind: 'problem', op: 'fin', args: ['a'] }, { id: 'a.ufin', kind: 'problem', op: 'ufin', args: ['a'] },
      { id: 'a.par', kind: 'problem', op: 'par', args: ['a'] }, { id: 'b.ufin', kind: 'problem', op: 'ufin', args: ['b'] },
    ],
    results: [{ type: 'implication', from: 'a', to: 'b', over: 'sw', refs: [{ ref: 'x' }] }],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('sw', 'a.ufin', 'a.fin'), 'implies');   // P* ≤sW P^u*
  assert.equal(st('w', 'a.par', 'a.ufin'), 'implies');    // P^u* ≤W P̂
  assert.equal(st('sw', 'a.par', 'a.ufin'), 'open');      // not strongly
  assert.equal(st('sw', 'a.ufin', 'b.ufin'), 'implies');  // monotone for ≤sW
});

test('parts: ¹P, Det(P) ≤W P, monotone, maximal; ¹ strongly monotone; not ≤sW P', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'sw', domain: 'problems', algebra: 'strong', finerThan: ['w'] },
      { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
    ],
    properties: [
      { id: 'first-order', domain: 'problems', opHas: ['fop'] },
      { id: 'single-valued', closedUnder: 'w', direction: 'equiv', domain: 'problems', opHas: ['det'] },
    ],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' }, { id: 'n', kind: 'problem' }, { id: 'f', kind: 'problem' }, { id: 'g', kind: 'problem' },
      { id: 'a.fop', kind: 'problem', op: 'fop', args: ['a'] }, { id: 'b.fop', kind: 'problem', op: 'fop', args: ['b'] },
      { id: 'a.det', kind: 'problem', op: 'det', args: ['a'] }, { id: 'b.det', kind: 'problem', op: 'det', args: ['b'] },
    ],
    results: [
      { type: 'implication', from: 'a', to: 'b', over: 'w', refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'a', to: 'n', over: 'w', refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'n', property: 'first-order', value: true, refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'a', to: 'f', over: 'w', refs: [{ ref: 'x' }] },
      { type: 'equivalence', from: 'f', to: 'g', over: 'w', refs: [{ ref: 'x' }] },
      { type: 'property', statement: 'g', property: 'single-valued', value: true, refs: [{ ref: 'x' }] },
    ],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('w', 'a', 'a.fop'), 'implies');        // ¹a ≤W a
  assert.equal(st('sw', 'a', 'a.fop'), 'open');
  assert.equal(st('w', 'a', 'a.det'), 'implies');
  assert.equal(st('sw', 'a.fop', 'b.fop'), 'implies');   // b ≤W a: ¹b ≤sW ¹a
  assert.equal(st('w', 'a.det', 'b.det'), 'implies');
  assert.equal(st('sw', 'a.fop', 'n'), 'implies');       // n first-order, n ≤W a: n ≤sW ¹a
  assert.equal(st('w', 'a.det', 'f'), 'implies');        // f ≡W g single-valued, f ≤W a: f ≤W Det(a)
  assert.equal(st('w', 'b.fop', 'n'), 'open');
});

test('third-order statements: compared over RCA₀^ω (rca0, higherOrder) only; BISH isolated', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'rca0', domain: 'all', higherOrder: true, finerThan: ['omega'] },
      { id: 'omega', domain: 'all', omegaModels: true, finerThan: [] },
      { id: 'bish', domain: 'all', finerThan: [] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'sentence' }, { id: 'b', kind: 'sentence' }, { id: 'h', kind: 'sentence', order: 3 },
    ],
    results: [
      { type: 'implication', from: 'a', to: 'h', over: 'rca0', refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'h', to: 'b', over: 'rca0', refs: [{ ref: 'x' }] },
    ],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('rca0', 'a', 'b'), 'implies');   // through the third-order h (conservativity)
  assert.equal(st('omega', 'a', 'b'), 'implies');  // a second-order consequence goes to ω-models
  assert.equal(st('omega', 'a', 'h'), 'na');       // ω-models do not read third-order statements
  assert.equal(st('bish', 'a', 'b'), 'open');      // nothing classical reaches BISH
});

test('EL₀: finer than RCA₀ and BISH; nothing flows between RCA₀ and BISH', () => {
  const zoo = buildZoo({
    reductions: [
      { id: 'rca0', domain: 'all', finerThan: [] },
      { id: 'bish', domain: 'all', finerThan: [] },
      { id: 'el0', domain: 'all', finerThan: ['rca0', 'bish'] },
    ],
    properties: [],
    statements: [
      { id: 'a', kind: 'sentence' }, { id: 'b', kind: 'sentence' }, { id: 'c', kind: 'sentence' }, { id: 'd', kind: 'sentence' },
    ],
    results: [
      { type: 'implication', from: 'a', to: 'b', over: 'el0', refs: [{ ref: 'x' }] },
      { type: 'implication', from: 'c', to: 'd', over: 'rca0', refs: [{ ref: 'x' }] },
      { type: 'separation', from: 'd', to: 'c', over: 'bish', refs: [{ ref: 'x' }] },
    ],
  });
  const st = (r, x, y) => zoo.status(zoo.ridx.get(r), zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('rca0', 'a', 'b'), 'implies');    // EL₀ ⊢ a → b, so RCA₀ ⊢ a → b
  assert.equal(st('bish', 'a', 'b'), 'implies');    // and BISH ⊢ a → b
  assert.equal(st('el0', 'd', 'c'), 'separated');   // a separation in BISH holds over EL₀
  assert.equal(st('el0', 'c', 'd'), 'open');        // a classical implication says nothing over EL₀
  assert.equal(st('bish', 'c', 'd'), 'open');       // nor in BISH
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

test('associativity and commutativity of × and ⋆', () => {
  const ids = ['a', 'b', 'c'];
  const zoo = buildZoo({
    reductions: [{ id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] }],
    properties: [],
    statements: [
      ...ids.map((id) => ({ id, kind: 'problem' })),
      ...[['a.x.b', 'product', 'a', 'b'], ['b.x.c', 'product', 'b', 'c'], ['a.x.c', 'product', 'a', 'c'],
        ['(a.x.b).x.c', 'product', 'a.x.b', 'c'], ['a.x.(b.x.c)', 'product', 'a', 'b.x.c'], ['b.x.(a.x.c)', 'product', 'b', 'a.x.c'],
        ['a.star.b', 'compose', 'a', 'b'], ['b.star.c', 'compose', 'b', 'c'], ['b.star.a', 'compose', 'b', 'a'],
        ['(a.star.b).star.c', 'compose', 'a.star.b', 'c'], ['a.star.(b.star.c)', 'compose', 'a', 'b.star.c'], ['(b.star.a).star.c', 'compose', 'b.star.a', 'c']]
        .map(([id, op, x, y]) => ({ id, kind: 'problem', op, args: [x, y] })),
    ],
    results: [],
  });
  const st = (x, y) => zoo.status(0, zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('(a.x.b).x.c', 'a.x.(b.x.c)'), 'implies');
  assert.equal(st('a.x.(b.x.c)', '(a.x.b).x.c'), 'implies');
  assert.equal(st('b.x.(a.x.c)', '(a.x.b).x.c'), 'implies');       // commutativity and associativity together
  assert.equal(st('(a.star.b).star.c', 'a.star.(b.star.c)'), 'implies');
  assert.equal(st('a.star.(b.star.c)', '(a.star.b).star.c'), 'implies');
  assert.equal(st('(a.star.b).star.c', '(b.star.a).star.c'), 'open'); // ⋆ is not commutative
});

test('choice elimination: C_ℕ applied first, C_{2^ℕ} applied last, and the contrapositive', () => {
  const zoo = buildZoo({
    reductions: [{ id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] }],
    properties: [
      { id: 'tf', closedUnder: 'w', direction: 'equiv', domain: 'problems', eliminates: { side: 'right', factor: 'cn' } },
      { id: 'sv', closedUnder: 'w', direction: 'equiv', domain: 'problems', eliminates: { side: 'left', factor: 'wkl' } },
    ],
    statements: ['cn', 'ucn', 'wkl', 'llpo', 'g', 'f', 'f2', 'h', 'v', 'v2'].map((id) => ({ id, kind: 'problem' })).concat([
      { id: 'g.star.ucn', kind: 'problem', op: 'compose', args: ['g', 'ucn'] },
      { id: 'g.star.wkl', kind: 'problem', op: 'compose', args: ['g', 'wkl'] },
      { id: 'llpo.star.g', kind: 'problem', op: 'compose', args: ['llpo', 'g'] },
      { id: 'cn.star.g', kind: 'problem', op: 'compose', args: ['cn', 'g'] },
    ]),
    results: [
      { type: 'property', statement: 'f', property: 'tf', value: true },
      { type: 'property', statement: 'f2', property: 'tf', value: true },
      { type: 'property', statement: 'v', property: 'sv', value: true },
      { type: 'property', statement: 'v2', property: 'sv', value: true },
      { type: 'implication', from: 'cn', to: 'ucn', over: 'w' },
      { type: 'implication', from: 'wkl', to: 'llpo', over: 'w' },
      { type: 'implication', from: 'g.star.ucn', to: 'f', over: 'w' },  // f ≤W g ⋆ UC_ℕ, UC_ℕ ≤W C_ℕ
      { type: 'implication', from: 'llpo.star.g', to: 'v', over: 'w' }, // v ≤W LLPO ⋆ g, LLPO ≤W C_{2^ℕ}
      { type: 'separation', from: 'g', to: 'f2', over: 'w' },
      { type: 'separation', from: 'g', to: 'v2', over: 'w' },
      { type: 'implication', from: 'g.star.wkl', to: 'h', over: 'w' }, // h has no property: nothing follows
    ],
  });
  const st = (x, y) => zoo.status(0, zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(st('g', 'f'), 'implies');
  assert.equal(zoo.just({ t: 'I', r: 0, a: zoo.sidx.get('g'), b: zoo.sidx.get('f') }).rule, 'prop-elim');
  assert.equal(st('g', 'v'), 'implies');
  assert.equal(st('g.star.ucn', 'f2'), 'separated');  // f2 ≰ g gives f2 ≰ g ⋆ UC_ℕ
  assert.equal(st('llpo.star.g', 'v2'), 'separated'); // v2 ≰ g gives v2 ≰ LLPO ⋆ g
  assert.equal(st('g.star.wkl', 'f2'), 'open');       // WKL is not below C_ℕ
  assert.equal(st('cn.star.g', 'v2'), 'open');        // C_ℕ is not below C_{2^ℕ}
  assert.equal(st('g', 'h'), 'open');
  assert.equal(zoo.contradictions.length, 0);
});

test('a down property kept by operations (reducible to a finite codomain)', () => {
  const zoo = buildZoo({
    reductions: [{ id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] }],
    properties: [{ id: 'fin', closedUnder: 'w', direction: 'down', domain: 'problems', opKeeps: ['product', 'compose'] }],
    statements: ['a', 'b', 'cn', 'x'].map((id) => ({ id, kind: 'problem' })).concat([
      { id: 'a.x.b', kind: 'problem', op: 'product', args: ['a', 'b'] },
      { id: 'a.star.b', kind: 'problem', op: 'compose', args: ['a', 'b'] },
      { id: 'a.star.x', kind: 'problem', op: 'compose', args: ['a', 'x'] },
    ]),
    results: [
      { type: 'property', statement: 'a', property: 'fin', value: true },
      { type: 'property', statement: 'b', property: 'fin', value: true },
      { type: 'property', statement: 'cn', property: 'fin', value: false },
    ],
  });
  const v = (s) => zoo.prop(0, zoo.sidx.get(s))?.v;
  const st = (x, y) => zoo.status(0, zoo.sidx.get(x), zoo.sidx.get(y));
  assert.equal(v('a.x.b'), true);
  assert.equal(v('a.star.b'), true);
  assert.equal(v('a.star.x'), undefined);           // x is unknown
  assert.equal(st('a.star.b', 'cn'), 'separated');  // C_ℕ is not below a ⋆ b
});

test('conservation properties: read from results, the base itself, failure for a smaller class, conjunctions', () => {
  const z = buildZoo({
    reductions: [{ id: 'rca0', domain: 'all', conjunction: true, finerThan: [] }],
    properties: [
      { id: 'c0', closedUnder: 'rca0', direction: 'down', fromConservation: { base: 'rca0', class: 'Pi11' }, implies: ['c1'] },
      { id: 'c1', closedUnder: 'rca0', direction: 'down', fromConservation: { base: 'b2', class: 'Pi11' } },
    ],
    classes: [{ id: 'arith' }, { id: 'Pi11', includes: ['arith'] }],
    statements: [
      { id: 'rca0', kind: 'sentence', base: true }, { id: 'b2', kind: 'sentence' }, { id: 'p', kind: 'sentence' },
      { id: 'w', kind: 'sentence' }, { id: 'pw', kind: 'sentence', conjunction: ['p', 'w'] }, { id: 'i2', kind: 'sentence' },
    ],
    results: [
      { type: 'conservation', statement: 'pw', base: 'b2', class: 'Pi11', value: true }, // WKL₀ + P over BΣ⁰₂
      { type: 'conservation', statement: 'i2', base: 'b2', class: 'arith', value: false }, // BΣ⁰₂ ⊬ IΣ⁰₂
      { type: 'implication', from: 'rca0', to: 'w', over: 'rca0' },
    ],
  });
  const v = (p, s) => z.prop(z.pidx.get(p), z.sidx.get(s))?.v;
  assert.equal(v('c1', 'b2'), true, 'a base is conservative over itself');
  assert.equal(v('c1', 'p'), true, 'a conjunct of a conservative conjunction is conservative');
  assert.equal(v('c1', 'i2'), false, 'not conservative for arithmetical sentences: not Π¹₁-conservative');
  assert.equal(v('c0', 'i2'), false, 'failing over BΣ⁰₂ means failing over RCA₀');
  assert.equal(v('c0', 'w'), true, 'what the base proves is conservative over it');
});

test('a question with sub-questions: each settled on its own, untracked parts left out', () => {
  const q = (parts) => questionStatus(z, { id: 'x', asked: [], parts });
  const yes = { question: 'a', formal: [{ from: 'rt22', to: 'rt12', over: 'c' }] };
  const no = { question: 'b', formal: [{ from: 'rt22', to: 'aca', over: 'rca0' }] };
  const op = { question: 'c', status: 'open' };
  const un = { question: 'd' };
  assert.equal(q([yes, no]).status, 'resolved');
  assert.equal(q([yes, op]).status, 'partial');
  assert.deepEqual(q([yes, op]).subs.map((s) => s.status), ['resolved', 'open']);
  assert.equal(q([yes, un]).status, 'resolved');  // a part without a recorded status does not count
  assert.equal(q([op, un]).status, 'open');
  assert.equal(q([yes, no]).parts[1].sub, 1);      // comparisons keep their sub-question
});

test('ω-models read statements inside the model: no bridge from reductions over problems for non-ω-absolute statements', () => {
  const z = buildZoo({
    reductions: [
      { id: 'w', domain: 'problems', finerThan: ['omega'] },
      { id: 'rca0', domain: 'all', finerThan: ['omega'] },
      { id: 'omega', domain: 'all', omegaModels: true, finerThan: [] },
    ],
    properties: [{ id: 'ca', closedUnder: 'omega', direction: 'down', domain: 'problems' }],
    statements: [
      { id: 'a', kind: 'problem' }, { id: 'b', kind: 'problem' },
      { id: 'u', kind: 'problem', omegaAbsolute: false }, { id: 'v', kind: 'problem', omegaAbsolute: false },
      { id: 's', kind: 'sentence' },
    ],
    results: [
      { type: 'implication', from: 'a', to: 'b', over: 'w' },
      { type: 'implication', from: 'u', to: 'a', over: 'w' },
      { type: 'separation', from: 'v', to: 'a', over: 'omega' },
      { type: 'separation', from: 'b', to: 's', over: 'omega' },
      { type: 'implication', from: 'v', to: 's', over: 'rca0' },
    ],
  });
  const st = (r, a, b) => z.status(z.ridx.get(r), z.sidx.get(a), z.sidx.get(b));
  assert.equal(st('omega', 'a', 'b'), 'implies'); // ω-absolute problems: coarsen as usual
  assert.equal(st('omega', 'u', 'a'), 'open'); // a Weihrauch reduction gives no ω-model implication
  assert.equal(st('w', 'v', 'a'), 'open'); // an ω-model separation gives no Weihrauch separation
  assert.equal(st('omega', 'v', 's'), 'implies'); // provability over RCA₀ still gives the ω-model implication
  assert.equal(z.propIn(0, z.sidx.get('u')), false); // cone-avoidance-like properties do not apply
  assert.equal(z.contradictions.length, 0);
});
