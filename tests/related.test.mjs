// Related statements (site/js/related.js) on a toy zoo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZoo } from '../site/js/engine.js';
import { relatedStatements } from '../site/js/related.js';

const st = (id, o = {}) => ({ id, kind: 'problem', ...o });
const imp = (from, to, ref) => ({ type: 'implication', from, to, over: 'rca0', refs: [{ ref }] });
const zoo = buildZoo({
  reductions: [{ id: 'rca0', finerThan: [] }],
  properties: [], classes: [],
  statements: [
    st('rca0', { kind: 'sentence', base: ['rca0'] }), st('a', { tags: ['ramsey'] }), st('b'), st('c'), st('d'),
    st('e', { tags: ['ramsey'] }), st('f', { tags: ['ramsey'] }), st('a2', { formulationOf: 'a' }),
  ],
  results: [
    imp('a', 'b', 'p1'), imp('b', 'a', 'p2'), imp('a', 'c', 'p2'),           // b: two papers with a, c: one
    imp('a', 'rca0', 'p1'), imp('a2', 'a', 'p1'),                            // base system, formulation
    ...['b', 'c', 'd', 'e'].map((x) => imp('a', x, 'book')), imp('f', 'f', 'other'), // a monograph
  ],
});
const ids = (s, o) => relatedStatements(zoo, zoo.sidx.get(s), o).map((x) => zoo.S[x.j].id);

test('statements studied in the same papers come first, monographs count less', () => {
  const r = ids('a');
  assert.deepEqual(r.slice(0, 2), ['b', 'c']);
  assert.ok(!r.includes('rca0') && !r.includes('a2') && !r.includes('a'), 'base systems, formulations and itself are left out');
  assert.ok(r.indexOf('e') < r.indexOf('d'), 'same area breaks ties');
});

test('few papers: completed with statements of the same area', () => {
  assert.ok(ids('a', { fill: 6 }).includes('f')); // no paper in common, same tag
  assert.ok(!ids('a', { fill: 0 }).includes('f'));
});
