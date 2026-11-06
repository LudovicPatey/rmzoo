// The rules deciding what the AI reader (scripts/ai-analyze.mjs) may publish
// without a human (scripts/lib/ai-facts.mjs), and the writer of results
// (scripts/lib/results.mjs). No API call is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildZoo } from '../site/js/engine.js';
import { locator, factChecker } from '../scripts/lib/ai-facts.mjs';

const raw = {
  reductions: [
    { id: 'rca0', finerThan: ['omega'] },
    { id: 'omega', finerThan: [] },
    { id: 'w', domain: 'problems', algebra: 'weak', finerThan: [] },
  ],
  properties: [{ id: 'ca', closedUnder: 'omega', direction: 'down' }],
  classes: [],
  statements: [
    { id: 'aca', kind: 'sentence' }, { id: 'p', kind: 'problem' }, { id: 'q', kind: 'problem' },
    { id: 's', kind: 'sentence' },
  ],
  results: [
    { type: 'property', statement: 'aca', property: 'ca', value: false, refs: [{ ref: 'x' }] },
    { type: 'implication', from: 'p', to: 'q', over: 'rca0', refs: [{ ref: 'x' }] },
  ],
};
const zoo = buildZoo(raw);
const { triage, knownId } = factChecker(raw, zoo);
const text = 'Theorem 4.15. The product version of Milliken’s tree theorem for height\n2 admits cone avoidance.\nProof. …';
const locate = locator(text);
const fact = (o) => ({ type: 'property', from: '', to: '', over: '', statement: 'p', property: 'ca', base: '', class: '', value: true,
  loc: 'Theorem 4.15', quote: 'The product version of Milliken\'s tree theorem for height 2 admits cone avoidance', paperNotation: '',
  origin: 'stated', citedFrom: '', argument: '', confidence: 'high', concerns: '', ...o });

test('quotes are found despite line breaks, spacing and typographic apostrophes', () => {
  assert.ok(locate('the product version of Milliken\'s tree theorem for height 2') > 0);
  assert.equal(locate('admits strong cone avoidance'), -1);
  assert.equal(locate('cone'), -1); // too short to count
});

test('operator ids are known when their components are', () => {
  assert.ok(knownId('p.jump') && knownId('p.x.q') && knownId('(p.x.q).jump'));
  assert.ok(!knownId('r.jump') && !knownId('pmtt2'));
});

test('a stated, quoted, confident, new fact is a candidate for publication', () => {
  assert.equal(triage(fact({}), locate).action, 'auto');
  assert.equal(triage(fact({ origin: 'special-case', argument: 'd = 1' }), locate).action, 'auto');
});

test('everything else goes to review, with the reasons', () => {
  const why = (o) => { const t = triage(fact(o), locate); assert.equal(t.action, 'review'); return t.reasons.join('; '); };
  assert.match(why({ statement: 'pmtt2' }), /not in the catalogue/);
  assert.match(why({ quote: 'MTT2 admits low solutions for every computable instance' }), /not found/);
  assert.match(why({ loc: ' ' }), /no theorem number/);
  assert.match(why({ confidence: 'medium' }), /confidence/);
  assert.match(why({ origin: 'cited', citedFrom: '[12]' }), /cite the original/);
  assert.match(why({ origin: 'deduced' }), /deduction/);
  assert.match(why({ statement: 'aca' }), /contradicts/); // ACA fails cone avoidance
  assert.match(why({ type: 'implication', statement: '', from: 's', to: 'q', over: 'w' }), /compares problems only/);
  assert.match(why({ type: 'implication', statement: '', from: 'p', to: 'q', over: 'xyz' }), /reduction "xyz" is unknown/);
});

test('known facts are dropped, except a stated fact identical to an entry (citation merged)', () => {
  const imp = { type: 'implication', statement: '', property: '', from: 'p', to: 'q' };
  assert.equal(triage(fact({ ...imp, over: 'rca0' }), locate).action, 'auto');   // same entry: merge the citation
  assert.equal(triage(fact({ ...imp, over: 'omega' }), locate).action, 'drop');  // derived (coarser reduction)
  assert.equal(triage(fact({ ...imp, over: 'rca0', origin: 'cited' }), locate).action, 'drop');
});

test('addResults appends without reformatting, merges citations, and can be undone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    fs.mkdirSync('data/results/literature', { recursive: true });
    const before = '# hand-written\n- {type: implication, from: a, to: b, over: ["sw","rca0star"], refs: [{ref: x}]}\n';
    fs.writeFileSync('data/results/ai-derived.yaml', before);
    const { addResults } = await import('../scripts/lib/results.mjs');
    let res = addResults({ _ai: [{ type: 'property', statement: 'a', property: 'ca', value: true, justification: { kind: 'restriction', by: 'ai', text: 't' } }] });
    const after = fs.readFileSync('data/results/ai-derived.yaml', 'utf8');
    assert.ok(after.startsWith(before), 'existing lines untouched');
    assert.match(after, /provenance: direct, justification/); // kind restriction: a direct consequence
    res.restore();
    assert.equal(fs.readFileSync('data/results/ai-derived.yaml', 'utf8'), before);

    res = addResults({ k: [{ type: 'implication', from: 'a', to: 'b', over: ['sw', 'rca0star'], loc: 'Theorem 1, (2)' }, { type: 'separation', from: 'b', to: 'a', over: 'w', loc: 'Theorem 2' }] });
    assert.equal(res.merged, 1);
    assert.equal(res.added, 1);
    assert.match(fs.readFileSync('data/results/ai-derived.yaml', 'utf8'), /ref: k, loc: "Theorem 1, \(2\)"/);
    assert.match(fs.readFileSync('data/results/literature/k.yaml', 'utf8'), /separation/);
    res.restore();
    assert.ok(!fs.existsSync('data/results/literature/k.yaml'));
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('properties of problems are refused for first-order sentences; unknown lowness levels are named', () => {
  const raw2 = { ...raw, properties: [{ id: 'ca', closedUnder: 'omega', direction: 'down', domain: 'problems' }],
    statements: [...raw.statements, { id: 'fo', kind: 'sentence', firstOrder: true }] };
  const { triage: t2 } = factChecker(raw2, buildZoo(raw2));
  assert.match(t2(fact({ statement: 'fo' }), locate).reasons.join(), /formulated as problems/);
  assert.match(t2(fact({ property: 'weakly-low3-basis' }), locate).reasons.join(), /level of its hierarchy/);
  assert.match(t2(fact({ property: 'sigma5-basis' }), locate).reasons.join(), /level of its hierarchy/);
});

test('quotes are found in texts with math italic letters and ligatures', () => {
  // pdftotext output of books: 𝑋 is two UTF-16 units, ﬁ a ligature
  const book = 'Proposition 9.4.10. If 𝑐 : [𝜔]𝑛 → 𝜔 is an instance of RRT, there exists an inﬁnite 𝑐-computable set 𝐼 ⊆ 𝜔.';
  const at = locator(book);
  assert.ok(at('there exists an infinite c-computable set I') > 0);
  assert.ok(at('there exists an inﬁnite 𝑐-computable set 𝐼') > 0);
  assert.equal(book.slice(at('If c : [ω]n → ω is an instance of RRT')).startsWith('If 𝑐'), true);
  assert.equal(at('there exists a finite c-computable set J'), -1);
});

test('AI reader: base systems of conservation results are catalogue ids', async () => {
  const { entry, baseId } = await import('../scripts/lib/ai-facts.mjs');
  assert.equal(baseId('rca0 + bsig2'), 'bsig2');
  assert.equal(baseId('RCA0+isig2'), 'isig2');
  assert.equal(baseId('RCA0'), 'rca0');
  assert.equal(baseId('isig1'), 'rca0'); // RCA₀ contains IΣ⁰₁: recorded over rca0
  assert.equal(baseId('rcastar + not isig1'), 'rcastar + not isig1'); // left as is: rejected as unknown
  assert.equal(entry({ type: 'conservation', statement: 'ads', base: 'rca0 + bsig2', class: 'Pi11', value: true }).base, 'bsig2');
});

test('AI reader: conjunctions of principles are kept, as sorted conjunction ids', async () => {
  const { entry, conjId } = await import('../scripts/lib/ai-facts.mjs');
  assert.equal(conjId('wkl-coh-fs'), 'coh-fs-wkl');
  assert.equal(conjId('WKL + RT22'), 'rt22-wkl');
  assert.equal(conjId('wkl-j', (id) => id === 'wkl-j'), 'wkl-j'); // a catalogue id containing "-"
  assert.equal(conjId('(cn.x.lpo).jump'), '(cn.x.lpo).jump');
  assert.deepEqual(entry({ type: 'separation', from: 'wkl-fs-coh', to: 'srt22', over: 'omega' }), { type: 'separation', from: 'coh-fs-wkl', to: 'srt22', over: 'omega' });
  const raw = { statements: [{ id: 'coh' }, { id: 'fs' }, { id: 'wkl' }, { id: 'srt22' }], reductions: [], properties: [], classes: [], results: [] };
  const { factChecker } = await import('../scripts/lib/ai-facts.mjs');
  const zoo = { pidx: new Map(), sidx: new Map(), propIn: () => true };
  assert.deepEqual(factChecker(raw, zoo).validity({ type: 'conservation', statement: 'coh-fs-wkl', base: 'coh', class: 'Pi11', value: true }).filter((e) => /catalogue/.test(e)), []);
  assert.ok(factChecker(raw, zoo).validity({ type: 'conservation', statement: 'coh-xyz', base: 'coh', class: 'Pi11', value: true }).some((e) => /catalogue/.test(e)));
});
