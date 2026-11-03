// The order in which the AI reader takes the papers (scripts/lib/paper-rank.mjs),
// on synthetic texts (the cache of full texts is not part of the repository).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperSignals } from '../scripts/lib/paper-rank.mjs';
import { raw } from '../scripts/mine/common.mjs';

const text = `Introduction.
We study RT22 and COH.
Theorem 2.1. RT22 admits cone avoidance.
Proof. Omitted.
Theorem 2.2. Every computable instance of COH has a low2 solution.
Proof. Omitted.
Lemma 2.3. Every finite graph has a vertex.
Proof. Omitted.
THEOREM 3.1. WKL does not imply RT22 over ω-models.
Proof. Omitted.
`;

test('theorems about catalogue statements count, the others do not', () => {
  const s = paperSignals('nosuchpaper', 0, text);
  assert.equal(s.theorems, 3);    // Lemma 2.3 names no catalogue statement
  assert.equal(s.property, 3);    // cone avoidance, computable instance, two statements
  assert.ok(s.breadth >= 3);      // rt22, coh, wkl
  assert.equal(s.covered, 0);
  assert.equal(paperSignals('nosuchpaper', 0, 'A paper about something else.\nTheorem 1. Every set is a set.\n').score, 0);
});

test('open leads weigh most; results already citing the paper lower the score', () => {
  const base = paperSignals('nosuchpaper', 0, text).score;
  assert.ok(paperSignals('nosuchpaper', 2, text).score > base + 7);
  const cited = Object.keys(raw.references).find((k) => raw.results.filter((r) => (r.refs || []).some((x) => x.ref === k)).length >= 10);
  const c = paperSignals(cited, 0, text);
  assert.ok(Math.abs(c.score * (1 + c.covered / 10) - (base + 3 * c.defines)) < 0.2); // divided by 1 + covered/10
  assert.ok(c.score < base + 3 * c.defines);
});
