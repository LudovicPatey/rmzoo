// Which cached full texts to give the AI reader (scripts/ai-analyze.mjs) first,
// when the budget does not cover all of them. A score from local signals only
// (no API call), meant to predict how many new facts a reading will bring:
//
//   leads      numbered theorems naming two catalogue statements whose relation
//              is still open in the database (the regex miner's candidates,
//              scripts/mine/facts.mjs; leads already screened are not counted)
//   property   numbered theorems naming a catalogue statement together with a
//              computability-theoretic or reduction phrase ("cone avoidance",
//              "low solution", "computable instance", "Weihrauch", "ω-model"…):
//              results the regex miner cannot read (MTT² has cone avoidance)
//   theorems   numbered statements naming at least one catalogue statement (2.6, or
//              II.3.4 as in books numbered by chapter)
//   breadth    distinct catalogue statements named anywhere in the text
//   defines    catalogue statements whose literature lists this paper (it
//              introduced or first analysed them)
//   covered    results of the database already citing the paper: each one
//              lowers the score a little (part of the paper is already read)
//
// score = (4·leads + 2·property + theorems + 3·defines + 2·log2(1 + breadth)) / (1 + covered/10)
// Tested in tests/paper-rank.test.mjs.
import fs from 'node:fs';
import { raw, dict, tokRe, normalize } from '../mine/common.mjs';
import { mineFacts } from '../mine/facts.mjs';

const THEOREM = /\n\s*(Theorem|Proposition|Corollary|Lemma|Claim|Fact|THEOREM|PROPOSITION|COROLLARY|LEMMA)\s+((?:[IVX]{1,5}\.)?\d+(?:\.\d+)*)\.?\s*(\([^)]{0,90}\))?\.?([\s\S]{0,600}?)(?=\n\s*(?:Proof|Theorem|Proposition|Corollary|Lemma|Definition|Example|Remark|Question|Claim|PROOF|THEOREM|PROPOSITION|COROLLARY|LEMMA|DEFINITION)\b|$)/g;
const PROPERTY = /cone[- ]avoid|avoids? cones|low ?2?[- ](basis|solution|set|degree)|low solutions?|computable instance|computable solution|computably true|hyperimmun|PA[- ](degree|over|avoid)|DNC|preserv|ω-model|omega-model|Turing ideal|Weihrauch|cylinder|idempotent|parallelizable|fractal|join-irreducible|≤ ?s?W|≡ ?s?W|<s?W|computabl[ey] reduc|conservative|Δ ?0 ?2|Σ ?0 ?2|Π ?0 ?[12]|arithmetical|admits|strictly weaker|does not imply|implies|equivalent/i;
const BASE = new Set(['rca0', 'rca0star']);

export function paperSignals(key, leadCount = 0, text = fs.readFileSync(`cache/fulltext/${key}.txt`, 'utf8')) {
  const ids = (s) => [...new Set([...normalize(s).matchAll(tokRe)].map((m) => dict.get(m[1])))].filter((x) => x && !BASE.has(x));
  let theorems = 0, property = 0, m;
  THEOREM.lastIndex = 0;
  while ((m = THEOREM.exec(text))) {
    const body = m[4].slice(0, 500);
    const n = ids(body).length;
    if (!n) continue;
    theorems++;
    if (n >= 2 || PROPERTY.test(body)) property++;
  }
  const breadth = ids(text).length;
  const defines = raw.statements.filter((s) => !s.op && (s.refs || []).some((r) => r.ref === key)).length;
  const covered = raw.results.filter((r) => (r.refs || []).some((x) => x.ref === key)).length;
  const score = (4 * leadCount + 2 * property + theorems + 3 * defines + 2 * Math.log2(1 + breadth)) / (1 + covered / 10);
  return { key, leads: leadCount, property, theorems, breadth, defines, covered, score: Math.round(score * 10) / 10, chars: text.length };
}

// The keys ranked by decreasing score (ties: newer papers first, then key).
export function rankPapers(keys) {
  const leads = new Map();
  for (const c of mineFacts(keys)) leads.set(c.ref, (leads.get(c.ref) || 0) + 1);
  return keys.map((k) => paperSignals(k, leads.get(k) || 0))
    .sort((a, b) => b.score - a.score || (raw.references[b.key]?.year || 0) - (raw.references[a.key]?.year || 0) || a.key.localeCompare(b.key));
}
