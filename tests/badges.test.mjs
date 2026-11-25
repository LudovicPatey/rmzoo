// Badges of a person (site/js/badges.js) and the credits file (scripts/lib/credits.mjs,
// data/credits.yaml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { personBadges, creditCounts, personCredits, BADGES } from '../site/js/badges.js';
import { creditFact, creditFactInFile, describeResult, plainLabel } from '../scripts/lib/credits.mjs';
import { orcidValid } from '../scripts/lib/schema.mjs';

const A = '0000-0003-0351-3058', B = '0000-0001-6670-8325';
const credits = [
  { orcid: A, name: 'A', kind: 'fact', count: 3, date: '2026-11-18', note: 'x' },
  { orcid: A, name: 'A', kind: 'fact', date: '2026-11-13', note: 'y' },
  { orcid: A, name: 'A', kind: 'source', date: '2026-11-13', note: 'z' },
  { orcid: B, name: 'B', kind: 'fix', date: '2026-11-06', note: 'w' },
];

test('credit counts: facts summed with their count, fixes and sources one per entry', () => {
  assert.deepEqual(creditCounts(credits, A), { facts: 4, fixes: 0, sources: 1 });
  assert.deepEqual(creditCounts(credits, B), { facts: 0, fixes: 1, sources: 0 });
  assert.deepEqual(creditCounts(undefined, A), { facts: 0, fixes: 0, sources: 0 });
});

test('badges: only nonzero counts, in a fixed order, singular and plural labels', () => {
  const b = personBadges({ credits, orcid: A, endorsements: 1, comments: 0, uploads: 2 });
  assert.deepEqual(b.map((x) => [x.key, x.count, x.label]), [['facts', 4, 'facts entered'], ['sources', 1, 'source added'], ['endorsements', 1, 'endorsement'], ['uploads', 2, 'full texts shared']]);
  assert.deepEqual(personBadges({ credits, orcid: B, uploads: undefined }).map((x) => x.key), ['fixes'], 'uploads unknown on a static copy');
  assert.deepEqual(personBadges({ credits: [], orcid: 'nobody' }), []);
  assert.equal(new Set(BADGES.map((x) => x[0])).size, BADGES.length);
  assert.deepEqual(personCredits(credits, A).map((c) => c.date), ['2026-11-18', '2026-11-13', '2026-11-13']);
});

test('accepting contributed facts of one message adds one credit with a count', () => {
  const e = [];
  creditFact(e, { orcid: A, name: 'A', date: '2026-11-19', message: 'm1', note: 'NON ≤sW EM.' });
  creditFact(e, { orcid: A, name: 'A', date: '2026-11-19', message: 'm1', note: 'LBT ≤sW L.' });
  creditFact(e, { orcid: A, name: 'A', date: '2026-11-19', message: 'm2', note: 'ACA⁺ ≤W UC.' });
  assert.equal(e.length, 2);
  assert.equal(e[0].count, 2);
  assert.equal(e[0].note, 'NON ≤sW EM; LBT ≤sW L.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-credits-'));
  const file = path.join(dir, 'credits.yaml');
  fs.writeFileSync(file, '# header kept\n- { orcid: 0000-0001-6670-8325, name: B, kind: fix, date: 2026-11-06, note: w }\n');
  creditFactInFile({ orcid: A, name: 'A', date: '2026-11-19', message: 'm1', note: 'NON ≤sW EM.' }, file);
  creditFactInFile({ orcid: A, name: 'A', date: '2026-11-19', message: 'm1', note: 'LBT ≤sW L.' }, file);
  const text = fs.readFileSync(file, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(text, /^# header kept/);
  const back = YAML.parse(text);
  assert.equal(back.length, 2);
  assert.deepEqual([back[1].kind, back[1].count, back[1].message], ['fact', 2, 'm1']);
  assert.ok(text.trim().split('\n').slice(-1)[0].startsWith('- {'), 'entries stay one line each');
});

test('notes of credited facts in plain text', () => {
  assert.equal(plainLabel('\\mathsf{RT}^2_2'), 'RT²₂');
  assert.equal(plainLabel("\\mathsf{ACA}'"), 'ACA′');
  assert.equal(plainLabel("\\lim'"), 'lim′');
  assert.equal(plainLabel('\\Sigma^1_1\\text{-}\\mathsf{C}_2'), 'Σ¹₁-C₂');
  assert.equal(describeResult({ type: 'implication', from: 'em', to: 'non', over: 'sw' }, (s) => s.toUpperCase()), 'NON ≤sW EM');
  assert.equal(describeResult({ type: 'separation', from: 'aca-plus', to: 'ucnn', over: 'w' }), 'ucnn not ≤W aca-plus');
  assert.equal(describeResult({ type: 'property', statement: 'ucnn', property: 'parallelizable', value: true }), 'ucnn: parallelizable');
});

test('data/credits.yaml: valid entries', () => {
  const list = YAML.parse(fs.readFileSync('data/credits.yaml', 'utf8')) || [];
  assert.ok(list.length > 0);
  for (const c of list) {
    assert.ok(orcidValid(String(c.orcid)), c.orcid);
    assert.ok(['fact', 'fix', 'source'].includes(c.kind), c.kind);
    assert.ok(c.name && c.note && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date)));
  }
});
