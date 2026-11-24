// Query mode of the search field (site/js/query.js) on the real zoo: the forms of questions,
// their interpretation and the order of completions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildZoo } from '../site/js/engine.js';
import { relatedIndex } from '../site/js/related.js';
import { queryIndex, tokenize, interpret, answer, complete } from '../site/js/query.js';

const Z = buildZoo(JSON.parse(fs.readFileSync(new URL('../site/data/zoo.json', import.meta.url))));
const X = queryIndex(Z, { related: relatedIndex(Z) });
// a plain substring search, ids starting with the query first (the viewer passes its own, ranked one)
const search = (q, n) => {
  q = q.toLowerCase().replace(/\s+/g, '');
  return Z.S.map((s, i) => [i, `${s.id} ${s.name}`.toLowerCase().replace(/\s+/g, ''), s.id.toLowerCase().startsWith(q) ? 0 : 1]).filter(([, t]) => t.includes(q))
    .sort((a, b) => a[2] - b[2]).slice(0, n).map(([i]) => i);
};
const ask = (text, r = 'rca0') => {
  const q = interpret(X, tokenize(X, text).toks, { search, r: Z.ridx.get(r) });
  if (!q) return null;
  const id = (i) => Z.S[i].id;
  return {
    type: q.type, kind: q.kind, neg: q.neg || undefined,
    ...(q.x !== undefined ? { x: id(q.x), y: id(q.y), r: Z.R[q.r].id } : {}),
    ...(q.s !== undefined ? { s: id(q.s), p: Z.raw.properties[q.p].id } : {}),
    ...(q.ids ? { ids: q.ids.map(id) } : {}),
  };
};
const has = (text, expected, r) => {
  const got = ask(text, r);
  assert.ok(got, `${text}: not understood`);
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(got[k], v, `${text}: ${k}`);
};

test('comparisons in words and symbols', () => {
  for (const t of ['Is RT22 c-reducible to BRT32?', 'RT22 ≤c BRT32', 'RT^2_2 <=_c BRT^3_2', 'is rt22 computably reducible to brt32', 'RT22 ≤_{c} BRT32'])
    has(t, { type: 'rel', kind: 'le', x: 'rt22', y: 'brt32', r: 'c' });
  has('Is RT22 Weihrauch reducible to RT23?', { kind: 'le', r: 'w' });
  has('Is RT22 strongly Weihrauch reducible to RT23?', { kind: 'le', r: 'sw' });
  has('Is K_N ≤sW PCC', { x: 'kn', y: 'pcc', r: 'sw' });
  for (const t of ['C_N ≤cW LPO', 'Is C_N continuously Weihrauch reducible to LPO?', 'C_N <=_{cW} LPO'])
    has(t, { kind: 'le', x: 'cn', y: 'lpo', r: 'cw' });
  for (const t of ['C_N ≤aW LPO', 'Is C_N arithmetically Weihrauch reducible to LPO?', 'C_N ≤_arith LPO'])
    has(t, { kind: 'le', x: 'cn', y: 'lpo', r: 'aw' });
  has('RT22 ≥W SRT22', { kind: 'ge', r: 'w' });
  has('Is ADS equivalent to CAC?', { kind: 'eq', x: 'ads', y: 'cac' });
  for (const t of ['ADS ≡ CAC', 'ADS <-> CAC', 'ADS ↔ CAC over RCA0', 'ADS iff CAC']) has(t, { kind: 'eq', r: 'rca0' });
  has('Is WKL strictly stronger than WWKL?', { kind: 'gt', x: 'wkl', y: 'wwkl' });
  has('Is ADS weaker than CAC?', { kind: 'le' });
  has('RT22 vs WKL', { kind: 'vs' });
  has('Compare RT22 and WKL', { kind: 'vs' });
  has('Is weak König\'s lemma equivalent to WKL?', { x: 'wkl', y: 'wkl' });
});

test('implications, negations, ω-models, provability', () => {
  for (const t of ['Does RT22 imply COH?', 'RT22 -> COH', 'RT22 → COH', 'RT22 => COH', 'RT22 implies COH']) has(t, { type: 'rel', kind: 'imp', x: 'rt22', y: 'coh', r: 'rca0' });
  has('Does RT22 imply COH over ω-models?', { r: 'omega' });
  has('RT22 -> COH in omega models', { r: 'omega' });
  has('Is every ω-model of RT22 a model of COH?', { kind: 'imp', x: 'rt22', y: 'coh', r: 'omega' });
  has('Does RT22 not imply WKL?', { neg: true, x: 'rt22', y: 'wkl' });
  has('RT22 ⇏ WKL', { neg: true });
  has('RT22 ≰W RT12', { neg: true, kind: 'le', r: 'w' });
  for (const t of ['Does RCA0 prove RT22 -> RT12?', 'RCA0 ⊢ RT22 → RT12', 'RCA0 + RT22 ⊢ RT12', 'RCA0 |- RT22 -> RT12', 'Is RT12 provable in RCA0 + RT22?'])
    has(t, { kind: 'imp', x: 'rt22', y: 'rt12', r: 'rca0' }, 'w');
  has('Does RCA0* prove RT22 -> RT12?', { r: 'rca0star' });
  has('Does WKL imply MIN over EL0?', { x: 'wkl', y: 'minprinciple', r: 'el0' });
  // an ambiguous name is read in the framework of the reduction (MIN: minimum principle or minimum of a sequence)
  has('Is MIN Weihrauch reducible to LPO?', { x: 'minrange', y: 'lpo', r: 'w' });
  has('Does WKL imply LLPO constructively?', { x: 'wkl', y: 'llpo', r: 'bish' });
  // a problem reduction does not apply to sentences: RCA₀ instead
  has('Does ISig2 imply BSig2?', { x: 'isig2', y: 'bsig2', r: 'rca0' }, 'w');
});

test('properties', () => {
  has('Does RT12 admit cone avoidance?', { type: 'prop', s: 'rt12', p: 'cone-avoidance' });
  has('Does RT22 have the low basis property?', { p: 'low-basis' });
  has('Does COH preserve hyperimmunity?', { p: 'hyperimmunity-preservation' });
  has('Is LLPO idempotent?', { p: 'idempotent' });
  has('Is SRT22 a cylinder?', { p: 'cylinder' });
  has('Is WKL Π¹₁-conservative?', { p: 'pi11-conservative' });
  has('Is RT22 Π11-conservative over RCA0 + BΣ2?', { type: 'prop' });
  const q = interpret(X, tokenize(X, 'Does RT12 admit cone avoidance?').toks, { search });
  assert.equal(answer(X, q).verdict, 'yes'); // Seetapun's theorem, for RT¹₂
});

test('first-order and deterministic parts', () => {
  for (const t of ['Is the first-order part of WKL Weihrauch reducible to LPO?', 'fop(WKL) ≤W LPO', 'wkl.fop ≤W LPO'])
    has(t, { type: 'rel', kind: 'le', x: 'wkl.fop', y: 'lpo', r: 'w' });
  has('Is the deterministic part of DS equivalent to lim?', { kind: 'eq', x: 'ds.det', y: 'lim' }, 'w');
  has('Det(DS) ≡W lim', { kind: 'eq', x: 'ds.det', y: 'lim', r: 'w' });
  has('Display the first-order part of WKL', { type: 'display', ids: ['wkl.fop'] });
});

test('pages', () => {
  has('Display RT22', { type: 'display', ids: ['rt22'] });
  has('What is COH?', { type: 'display', ids: ['coh'] });
  has('Diagram of RT22, COH, WKL', { type: 'diagram', ids: ['rt22', 'coh', 'wkl'] });
  has('rt22 wkl coh', { type: 'diagram', ids: ['rt22', 'wkl', 'coh'] });
  has('Compare RT22, COH and WKL', { type: 'compare' });
  has('Questions about RT22', { type: 'questions', ids: ['rt22'] });
  // an unfinished question is not a request to open the page
  assert.equal(ask('Does RT12 '), null);
  assert.equal(ask('Is RT22'), null);
});

test('completions follow the slot and rank likely answers first', () => {
  const c = (text, r = 'c') => complete(X, text, { search, r: Z.ridx.get(r) }).items.map((it) => text.slice(0, it.from) + it.insert);
  assert.ok(c('').includes('Is '));
  assert.equal(c('Is RT22 ')[0], 'Is RT22 c-reducible to ');
  assert.equal(c('Is RT22 c-reducible to B')[0], 'Is RT22 c-reducible to BRT32');
  assert.equal(c('Does RT12 ')[0], 'Does RT12 imply ');
  assert.ok(c('Does RT12 admit ').slice(0, 5).includes('Does RT12 admit cone avoidance'));
  assert.ok(c('Does COH preserve ').includes('Does COH preserve hyperimmunity'));
  assert.ok(c('RT22 -> COH over ').some((t) => t.endsWith('over RCA0')));
  // statements studied with RT22 come before unrelated ones
  const after = c('Is RT22 c-reducible to ').slice(0, 15);
  assert.ok(after.some((t) => /SRT22|COH|ADS|CAC|EM|RT23/.test(t)), after.join(' | '));
  // an inserted name is read back as the same statement
  for (const t of c('Display RT22, ').slice(0, 10)) assert.ok(ask(t), t);
});
