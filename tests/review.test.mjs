// The review queue (site/js/review.js, scripts/lib/review-queue.mjs, docs/REVIEW.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { reviewStatus, itemResult, screenKey, resultKey, KINDS } from '../site/js/review.js';
import { resultKey as schemaKey, SCHEMA } from '../scripts/lib/schema.mjs';
import { addToQueue } from '../scripts/lib/review-queue.mjs';

const V = (verdict, orcid = '0000-0002-1825-0097') => ({ orcid, verdict, date: '2026-11-03' });

test('one validation and no invalidation validates; both is a dispute', () => {
  assert.equal(reviewStatus(), 'open');
  assert.equal(reviewStatus([V('valid')]), 'validated');
  assert.equal(reviewStatus([V('invalid')]), 'invalidated');
  assert.equal(reviewStatus([V('valid'), V('invalid', '0000-0001-2345-6789')]), 'disputed');
});

test('a validated proposal becomes the entry that scripts/review.mjs writes', () => {
  const base = { kind: 'result', ref: 'p2020', loc: 'Theorem 3', result: { type: 'implication', from: 'a', to: 'b', over: 'rca0' } };
  assert.deepEqual(itemResult({ ...base, origin: 'stated' }).refs, [{ ref: 'p2020', loc: 'Theorem 3' }]);
  const d = itemResult({ ...base, origin: 'special-case', argument: 'Take k = 2.' });
  assert.equal(d.provenance, 'direct'); // a special case is a direct consequence
  assert.equal(d.justification.kind, 'restriction');
  assert.equal(itemResult({ ...base, origin: 'deduced', argument: 'Compose.' }).provenance, 'ai');
  assert.match(d.justification.text, /Take k = 2\. \(From Theorem 3 of \[@p2020\]\.\)/);
  assert.match(itemResult({ ...base, origin: 'cited', citedFrom: 'Smith 1990' }).refs[0].loc, /attributed to Smith 1990/);
  assert.equal(itemResult({ kind: 'statement' }), null);
});

test('the viewer and the schema agree on the identity of a result', () => {
  for (const r of [{ type: 'implication', from: 'a', to: 'b', over: ['rca0', 'omega'] }, { type: 'property', statement: 'a', property: 'low', value: true },
    { type: 'conservation', statement: 'a', base: 'b', class: 'pi11', value: false }]) assert.equal(resultKey(r), schemaKey(r));
});

test('consolidation items close through data/screened.yaml keys; every kind is documented', () => {
  assert.deepEqual(screenKey({ kind: 'lead', ref: 'p', loc: 'Theorem 2' }), ['facts', 'p|Theorem 2']);
  assert.deepEqual(screenKey({ kind: 'answer', question: 'q1', ref: 'p' }), ['resolutions', 'q1|p']);
  assert.equal(screenKey({ kind: 'result' }), null);
  for (const k of Object.keys(KINDS)) assert.match(SCHEMA.review.kind.doc, new RegExp(`\\b${k}\\b`));
});

test('the queue never adds an item twice and keeps proposals under discussion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-queue-'));
  const file = path.join(dir, 'review.yaml');
  const it = (id, extra = {}) => ({ id, ref: 'p', kind: 'result', status: 'pending', date: '2026-11-03', ...extra });
  assert.equal(addToQueue([it('p-1'), it('p-2'), it('p-1')], { file }), 2);
  // p-2 has a vote: a new reading of the paper replaces p-1 but keeps p-2
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  doc[1].votes = [V('valid')];
  fs.writeFileSync(file, YAML.stringify(doc));
  assert.equal(addToQueue([it('p-3')], { file, replace: (n) => n.get('ref') === 'p' }), 1);
  assert.deepEqual(YAML.parse(fs.readFileSync(file, 'utf8')).map((x) => x.id), ['p-2', 'p-3']);
  fs.rmSync(dir, { recursive: true });
});
