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
  ['rca0star', 'rca0', 'isig1', 'separated'],
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
