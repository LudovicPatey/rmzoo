// Derive trivial implications (restrictions of instances and immediate
// reductions) that the database does not already yield. Each one is written
// to data/results/ai-derived.yaml with provenance: ai and its argument.
import fs from 'node:fs';
import { buildZoo } from '../../site/js/engine.js';

const zoo = buildZoo(JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8')));
const STABLE = 'Restriction to stable instances: every stable instance is an instance, with the same solutions.';
const COLORS = (k) => `Specialization: ${k}.`;
const POLAR = 'Given a homogeneous set H, the sequence (H, …, H) is polarized-homogeneous.';
const POLAR_T = 'Given a homogeneous subtree S, the sequence (S, …, S) is polarized-homogeneous.';
const INCR = 'A polarized-homogeneous sequence is homogeneous on increasing tuples.';
const TREE = 'Color a chain σ₁ ⊏ ⋯ ⊏ σₙ by the color of the tuple of lengths (|σ₁|, …, |σₙ|); along any path of a homogeneous subtree, the set of lengths of its nodes is an infinite homogeneous set.';
const LOWER = 'Lower the exponent: color an (n+1)-tuple by the color of its first n elements; an infinite homogeneous set for the new coloring is homogeneous for the original one.';
const LOWER_T = 'Lower the exponent: color a chain σ₁ ⊏ ⋯ ⊏ σₙ₊₁ by the color of σ₁ ⊏ ⋯ ⊏ σₙ; since every node of a subtree isomorphic to 2^{<ℕ} has extensions in it, a homogeneous subtree for the new coloring is homogeneous for the original one.';
const SUMS = 'Sums of one element are among the sums considered, so a solution is monochromatic for the coloring.';
const C = [
  ['rt2', 'rt23', 'restriction', COLORS('finitely many colors, at 3 colors')],
  ['rt', 'rt2', 'restriction', COLORS('every exponent, at exponent 2')],
  ['srt2', 'srt23', 'restriction', COLORS('finitely many colors, at 3 colors')],
  ['ttall', 'tt2', 'restriction', COLORS('every exponent, at exponent 2')],
  ['ttall', 'tt1', 'restriction', COLORS('every exponent, at exponent 1')],
  ['ttall', 'tt32', 'restriction', COLORS('every exponent and number of colors, at exponent 3 and 2 colors')],
  ['tt2', 'tt1', 'reduction', LOWER_T],
  ['tt32', 'tt22', 'reduction', LOWER_T],
  ['spt2', 'spt22', 'restriction', COLORS('finitely many colors, at 2 colors')],
  ['sipt2', 'sipt22', 'restriction', COLORS('finitely many colors, at 2 colors')],
  ['rrt', 'rrt22', 'restriction', COLORS('every exponent, at exponent 2')],
  ['rt23', 'srt23', 'restriction', STABLE],
  ['pt22', 'spt22', 'restriction', STABLE],
  ['pt2', 'spt2', 'restriction', STABLE],
  ['ipt22', 'sipt22', 'restriction', STABLE],
  ['ipt2', 'sipt2', 'restriction', STABLE],
  ['ptt22', 'sptt22', 'restriction', STABLE],
  ['ptt2', 'sptt2', 'restriction', STABLE],
  ['iptt22', 'siptt22', 'restriction', STABLE],
  ['iptt2', 'siptt2', 'restriction', STABLE],
  ['srt2', 'd2', 'reduction', 'An infinite homogeneous set for a stable coloring is limit-homogeneous.'],
  ['rt22', 'pt22', 'reduction', POLAR], ['rt2', 'pt2', 'reduction', POLAR], ['rt32', 'pt32', 'reduction', POLAR],
  ['rt3', 'pt3', 'reduction', POLAR], ['rt', 'pt', 'reduction', POLAR], ['srt22', 'spt22', 'reduction', POLAR],
  ['tt22', 'ptt22', 'reduction', POLAR_T], ['tt2', 'ptt2', 'reduction', POLAR_T], ['stt22', 'sptt22', 'reduction', POLAR_T],
  ['ptt22', 'iptt22', 'reduction', INCR], ['ptt2', 'iptt2', 'reduction', INCR], ['ptt3', 'iptt3', 'reduction', INCR],
  ['ptt32', 'iptt32', 'reduction', INCR], ['spt22', 'sipt22', 'reduction', INCR], ['sptt22', 'siptt22', 'reduction', INCR],
  ['pt22', 'ipt22', 'reduction', INCR], ['pt32', 'ipt32', 'reduction', INCR],
  ['tt22', 'rt22', 'reduction', TREE], ['tt12', 'rt12', 'reduction', TREE], ['tt2', 'rt2', 'reduction', TREE],
  ['tt1', 'rt1inf', 'reduction', TREE], ['tt32', 'rt32', 'reduction', TREE], ['ttall', 'rt', 'reduction', TREE],
  ['rt3', 'rt2', 'reduction', LOWER], ['rt22', 'rt12', 'reduction', LOWER],
  ['ht', 'rt1inf', 'reduction', SUMS], ['ht-le22', 'rt12', 'reduction', SUMS], ['ht-le33', 'rt13', 'reduction', SUMS],
  ['rt22', 'crt22', 'reduction', 'A coloring restricted to one of its homogeneous sets is constant, hence stable.'],
  ['rt22', 'ccac', 'reduction', 'Color {x < y} by comparability; a homogeneous set is a chain or an antichain, hence a stable suborder.'],
  ['cac', 'ccac', 'reduction', 'An infinite chain or antichain is a stable suborder.'],
  ['ads', 'cads', 'reduction', 'An infinite ascending or descending sequence is a suborder of type ω or ω*, hence stable.'],
  ['cac', 'ads', 'reduction', 'Given a linear order <_L, let x ≺ y iff x < y and x <_L y; infinite chains of ≺ are ascending sequences and infinite antichains are descending sequences.'],
  ['scac', 'sads', 'reduction', 'Given a linear order <_L of type ω + ω*, let x ≺ y iff x < y and x <_L y; this partial order is stable, its chains are ascending and its antichains descending sequences.'],
  ['dnr0', 'dnr', 'reduction', "By the s-m-n theorem there is a computable g with Φ^{X′}_{g(e)}(g(e)) = Φ^X_e(e) for all e; if f is DNC relative to X′ then f ∘ g is DNC relative to X."],
];
const OVERS = ['sw', 'rca0star'];
const out = [];
let skipped = 0;
for (const [a, b, kind, text] of C) {
  const ia = zoo.sidx.get(a), ib = zoo.sidx.get(b);
  if (ia === undefined || ib === undefined) { console.log('unknown statement', a, b); continue; }
  const over = OVERS.filter((r) => zoo.status(zoo.ridx.get(r), ia, ib) !== 'implies');
  if (!over.length) { skipped++; continue; }
  for (const r of over) if (zoo.status(zoo.ridx.get(r), ia, ib) === 'separated') console.log('CONFLICT', a, b, r);
  out.push({ type: 'implication', from: a, to: b, over: over.length === 1 ? over[0] : over, provenance: 'ai', justification: { kind, text, by: 'ai' } });
}
const q = (v) => JSON.stringify(v);
const lines = out.map((r) => `- {type: implication, from: ${r.from}, to: ${r.to}, over: ${q(r.over)}, provenance: ai, justification: {kind: ${r.justification.kind}, by: ai, text: ${q(r.justification.text)}}}`);
fs.writeFileSync('data/results/ai-derived.yaml',
  '# Trivial implications derived by an AI assistant (restrictions of instances and immediate reductions)\n' +
  '# that the cited literature did not already yield. Each carries its argument; they should be checked.\n' +
  '# Generated by scripts/import/derive_trivial.mjs.\n\n' + lines.join('\n') + '\n');
console.log(`${out.length} implications added, ${skipped} already derivable`);
