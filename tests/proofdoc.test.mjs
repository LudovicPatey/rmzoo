// Structured proofs (site/js/proofdoc.js) and review items of kind `proof`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import { checkProof, proofDocHtml, proofSize, proofTexts } from '../site/js/proofdoc.js';
import { itemResults } from '../site/js/review.js';

const doc = {
  summary: 'By a commitment lemma.',
  blocks: [
    { env: 'definition', label: 'Definition 1', text: 'A set is *thin* if it avoids a colour.' },
    { env: 'lemma', label: 'Lemma A', text: 'Every finite set extends.', proof: ['By Ramsey [@ramsey1930].', { steps: ['First.', 'Second, by [#Definition 1].'] }] },
    { env: 'theorem', label: 'Theorem', text: 'X ≰ Y.', proof: [{ cases: [{ label: 'Case 1.', body: ['Use [#Lemma A].'] }, { label: 'Case 2.', body: ['Trivial.'] }] }] },
    { env: 'part', label: '(≥)', proof: ['Direct.'] },
  ],
};

test('a well-formed proof has no errors; its texts and size are collected', () => {
  assert.deepEqual(checkProof(doc), []);
  assert.ok(proofTexts(doc).includes('By Ramsey [@ramsey1930].'));
  assert.deepEqual(proofSize(doc), { blocks: 3, steps: 2 });
});

test('errors: unknown env, duplicate label, dangling reference, empty steps, unknown field', () => {
  const bad = { blocks: [
    { env: 'lema', text: 'x' },
    { env: 'lemma', label: 'L', text: 'a' }, { env: 'claim', label: 'L', text: 'b' },
    'See [#Nowhere].', { steps: [] }, { env: 'theorem', text: 'c', note: 'x' },
  ] };
  const e = checkProof(bad).join('\n');
  for (const re of [/env must be/, /label L used twice/, /unknown block \[#Nowhere\]/, /nonempty list/, /unknown field note/]) assert.match(e, re);
  // parts are headings: the same part label may recur
  assert.deepEqual(checkProof({ blocks: [{ env: 'part', label: 'Proof', proof: ['a'] }, { env: 'part', label: 'Proof', proof: ['b'] }] }), []);
  assert.ok(checkProof({ blocks: [] }).length);
});

test('rendering: environments, proofs with ∎, numbered steps, cases, cross-reference anchors', () => {
  const html = proofDocHtml(doc, (t) => t, { prefix: 'x' });
  assert.match(html, /class="pf-env pf-thm pf-lemma" id="x-lemma-a"/);
  assert.match(html, /<details class="pf-proof"><summary>Proof<\/summary>/);
  assert.match(html, /<ol class="pf-steps"><li>First\.<\/li>/);
  assert.match(html, /class="pf-ref" href="#x-definition-1" data-pf="x-definition-1">Definition 1<\/a>/);
  assert.match(html, /class="pf-case-label">Case 1\.<\/span>/);
  assert.match(html, /∎/);
  assert.doesNotMatch(html, /id="x-"/); // a part has no anchor
  assert.match(proofDocHtml(doc, (t) => t, { open: true }), /<details class="pf-proof" open>/);
});

test('a validated proof item becomes AI-derived results carrying the whole proof', () => {
  const it = { kind: 'proof', title: 'T', summary: 'S.', proof: doc, results: [{ type: 'separation', from: 'a', to: 'b', over: 'w' }, { type: 'property', statement: 'a', property: 'p', value: false }] };
  const r = itemResults(it);
  assert.equal(r.length, 2);
  assert.equal(r[0].provenance, 'ai');
  assert.deepEqual(r[0].justification, { kind: 'reduction', by: 'ai', text: 'S.', proof: doc });
  assert.equal(itemResults({ kind: 'lead' }).length, 0);
});

test('the proofs of the review queue are well formed', () => {
  const q = YAML.parse(fs.readFileSync('data/review.yaml', 'utf8')) || [];
  for (const it of q.filter((x) => x.kind === 'proof')) {
    assert.deepEqual(checkProof(it.proof, it.id), [], it.id);
    assert.ok(it.results?.length && it.title && it.summary, it.id);
  }
});
