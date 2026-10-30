// One-off pass over the folklore results (kept for provenance):
// - free-text citations from the RM Zoo import become proper references;
// - immediate facts get a short argument, marked as written by AI;
// - the rest are marked "unreferenced" or "classical".
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const R = (kind, text) => ({ kind, text, by: 'ai' });
const restriction = (text) => R('restriction', text);
const reduction = (text) => R('reduction', text);
const STABLE = 'Restriction to stable instances: every stable instance is an instance, with the same solutions.';
const SPECIAL = (what) => `Specialization of a parameter: ${what}.`;

// key: "from>to" for implications/equivalences/separations, "prop:statement:property" for properties,
// "cons:statement:base" for conservation results.
const RULES = {
  // ---- seed results -------------------------------------------------------
  'prop:wkl:pa-avoidance': { justification: reduction('The tree of DNC₂ functions (equivalently, of complete consistent extensions of PA) is a computable instance of WKL all of whose paths have PA degree.') },
  'prop:aca:cone-avoidance': { justification: reduction("The jump problem has the computable instance ∅ whose only solution ∅′ is not computable.") },
  'prop:aca:low-basis': { justification: reduction("The only solution to the instance ∅ is ∅′, which is not low.") },
  'prop:aca:arith-preservation': { justification: reduction('The set ∅′ is not Δ⁰₁, but it is Δ⁰₁ relative to ∅′, the only solution of the computable instance ∅.') },
  'prop:rca0:computably-true': { justification: R('classical', 'The identity problem: every instance is its own solution.') },
  'prop:rca0:pi11-conservative': { justification: R('classical', 'Trivial: RCA₀ is conservative over itself.') },
  'wkl>wwkl': { justification: restriction('WWKL is WKL restricted to trees of positive measure.') },
  'rca0>isig1': { refs: [{ ref: 'simpson2009', loc: 'Definition II.1.5' }], justification: R('classical', 'Σ⁰₁ induction is one of the axioms of RCA₀.') },
  'atr>aca-plus': { justification: reduction('Apply arithmetical transfinite recursion along the well-ordering ω to iterate the jump.') },
  'aca-plus>aca-prime': { justification: reduction('X⁽ⁿ⁾ is computable uniformly from X^(ω).') },
  'aca-prime>aca': { justification: restriction('Take n = 1.') },
  'aca-prime>aca-plus': { justification: R('classical', 'The arithmetical sets form an ω-model of ACA′ which does not contain ∅^(ω).') },
  'gowers>ht': { justification: restriction('FIN₁ is Hindman’s theorem.') },
  'lim>aca': { justification: R('classical', 'lim is the problem form of the Turing jump; over RCA₀*, ACA is equivalent to the statement that every set has a jump.') },
  'rca0>lpo': { justification: R('classical', 'Classically provable by the law of excluded middle: either p is the zero sequence or it is not.') },
  'rca0>llpo': { justification: R('classical', 'Classically provable: if p has a 1 at position n, the parity of n answers; otherwise any answer is correct.') },
  'ads>adc': { justification: reduction('An ascending (descending) sequence is an ascending (descending) chain; conversely an infinite chain can be enumerated in increasing order of ℕ and thinned out to a monotone sequence.') },
  'wkl-j>wkl': { refs: [{ ref: 'brattkagherardimarcone2012', loc: 'Proposition 5.6(1)' }] },
  'wkl-jj>wkl-j': { refs: [{ ref: 'brattkagherardimarcone2012', loc: 'Proposition 5.6(1)' }] },
  'rt22>ht-eq22': { justification: reduction('Given c : ℕ → 2, color the pair {x, y} by c(x + y); an infinite homogeneous set has all sums of exactly two elements of the same color.') },
  'ht>ht-le33': { justification: restriction('A set all of whose finite sums are monochromatic has its sums of at most 3 elements monochromatic, and a 3-coloring is a finite coloring.') },
  'ht>ht-le22': { justification: restriction('Same solutions, restricted to 2-colorings and sums of at most 2 elements.') },
  'ht-le22>ht-eq22': { justification: restriction('Same instances; sums of exactly 2 elements are sums of at most 2 elements.') },
  'rspo>rspo3': { justification: restriction('Partial orders of width at most 3 have finite width.') },
  'srt23>srt22': { justification: restriction('A stable 2-coloring is a stable 3-coloring with the same homogeneous sets.') },
  'srt22>srt23': { justification: reduction('Merge two colors, apply SRT²₂, then apply SRT²₂ again inside the resulting homogeneous set if needed; the colorings stay stable.') },
  'rt32>brt32': { justification: restriction('BRT³₂ is RT³₂ restricted to colorings whose 1-homogeneous sets are bounded; such colorings only have infinite 0-homogeneous sets.') },
  'coh>fincoh': { justification: restriction('A finite sequence of sets is a sequence of sets (pad with copies).') },
  'rt22>cac': { refs: [{ ref: 'cholakjockuschslaman2001', loc: 'Question 13.8' }, { ref: 'hirschfeldtshore2007', loc: 'comment following the definition of CAC' }], justification: reduction('Color the pair {x < y} by whether x and y are comparable; homogeneous sets are chains or antichains.') },
  'cac>scac': { justification: restriction('SCAC is CAC restricted to stable partial orders.') },
  'ads>sads': { justification: restriction('SADS is ADS restricted to linear orders of type ω + ω*.') },
  'ads>cads': { justification: reduction('An infinite ascending or descending sequence is a suborder of type ω or ω*, hence stable.') },
  'rca0>rt12': { justification: reduction('Non-uniformly, one of the two color classes is infinite and computable from the instance.') },
  'rca0>rt13': { justification: reduction('Non-uniformly, one of the color classes is infinite and computable from the instance.') },
  'rca0>rt1inf': { justification: reduction('Non-uniformly, one of the color classes is infinite and computable from the instance.') },
  'rt12>rt13': { justification: reduction('Merge two colors and apply RT¹₂, then apply RT¹₂ again inside the resulting set if needed.') },
  'rt13>rt12': { justification: restriction('A 2-coloring is a 3-coloring with the same homogeneous sets.') },
  'rt1inf>rt13': { justification: restriction('Take k = 3.') },
  'rt22>rt23': { justification: reduction('Merge two colors and apply RT²₂, then apply RT²₂ again inside the homogeneous set if needed.') },
  'rt23>rt22': { justification: restriction('A 2-coloring is a 3-coloring with the same homogeneous sets.') },
  'rt32>rt22': { justification: reduction('Color a triple {x < y < z} by f(x, y); an infinite homogeneous set for this coloring is homogeneous for f.') },
  'rt22>srt22': { justification: restriction(STABLE) },
  'srt22>d22': { justification: reduction('An infinite homogeneous set for a stable coloring is limit-homogeneous.') },
  'd22>rt12': { justification: reduction('Color the pair {x < y} by the color of x; this coloring is stable and its limit-homogeneous sets are homogeneous for the original coloring.') },
  'rt22>em': { justification: reduction('Color {x < y} by whether x → y in the tournament; homogeneous sets are transitive subtournaments.') },
  // ---- RM Zoo "by definition" ------------------------------------------------
  'rt>rt3': { justification: restriction(SPECIAL('Ramsey’s theorem for every exponent, at exponent 3')) },
  'rt3>rt2': { justification: reduction('RT³_{<∞} implies RT²_{<∞} by lowering the exponent (color a triple by the color of its first two elements).') },
  'rrt>rrt42': { justification: restriction(SPECIAL('the rainbow Ramsey theorem for every exponent and bound, at exponent 4 and bound 2')) },
  'rt3>rt32': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'fs3>sfs3': { justification: restriction(STABLE) },
  'fs2>sfs2': { justification: restriction(STABLE) },
  'rt2>rt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'srt2>srt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'd2>d22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'rt1inf>rt12': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'rt2>srt2': { justification: restriction(STABLE) },
  'em>sem': { justification: restriction(STABLE) },
  'kl>wkl': { justification: restriction('A binary tree is finitely branching.') },
  'isig3>isig2': { justification: restriction('Every Σ⁰₂ formula is Σ⁰₃.') },
  'bsig3>bsig2': { justification: restriction('Every Σ⁰₂ formula is Σ⁰₃.') },
  'pa>isig3': { justification: restriction('Σ⁰₃ induction is an instance of the full induction scheme.') },
  'wwkl2>wwkl': { justification: restriction('A computable tree of positive measure is a Δ⁰₂ tree of positive measure.') },
  'tt2>tt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'tt1>tt12': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'pt>pt2': { justification: restriction(SPECIAL('every exponent, at exponent 2')) },
  'pt>pt3': { justification: restriction(SPECIAL('every exponent, at exponent 3')) },
  'pt2>pt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'pt3>pt32': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'ipt>ipt2': { justification: restriction(SPECIAL('every exponent, at exponent 2')) },
  'ipt>ipt3': { justification: restriction(SPECIAL('every exponent, at exponent 3')) },
  'ipt2>ipt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'ipt3>ipt32': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'pt2>ipt2': { justification: reduction('A polarized homogeneous sequence is in particular homogeneous on increasing tuples.') },
  'pt3>ipt3': { justification: reduction('A polarized homogeneous sequence is in particular homogeneous on increasing tuples.') },
  'ptt3>ptt32': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'ptt2>ptt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'iptt3>iptt32': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'iptt2>iptt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'stt2>stt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'sptt2>sptt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'siptt2>siptt22': { justification: restriction(SPECIAL('finitely many colors, at 2 colors')) },
  'tt2>stt2': { justification: restriction(STABLE) },
  'tt22>stt22': { justification: restriction(STABLE) },
  'rwkl2>rwkl': { justification: R('classical', 'Recorded as "by definition" in the RM Zoo database (Flood 2012); not re-checked.') },
  'p22>d22': { justification: R('classical', 'Recorded as "by definition" in the RM Zoo database (Flood 2012); not re-checked.') },
  'csig>csig2': { justification: restriction(SPECIAL('the cardinality scheme for every n, at n = 2')) },
  'rrt42>rrt32': { justification: R('unreferenced', 'Recorded as "by definition" in the RM Zoo database. The usual exponent-lowering argument does not preserve 2-boundedness, so this implication is not immediate and should be checked.') },
  'fs>fs2': { justification: restriction(SPECIAL('every exponent, at exponent 2')) },
  'fs>fs3': { justification: restriction(SPECIAL('every exponent, at exponent 3')) },
  'ts3>sts3': { justification: restriction(STABLE) },
  'ts2>sts2': { justification: restriction(STABLE) },
  'wwkl>rwwkl': { justification: reduction('Given a path P through the tree, one of {n : P(n) = 0} and {n : P(n) = 1} is infinite and homogeneous for P.') },
  'rwkl>rwwkl': { justification: restriction('RWWKL is RWKL restricted to trees of positive measure.') },
  'rwkl2>rwwkl2': { justification: R('classical', 'Recorded as "by definition" in the RM Zoo database (Bienvenu, Patey and Shafer 2017); not re-checked.') },
  'rwwkl2>rwwkl': { justification: R('classical', 'Recorded as "by definition" in the RM Zoo database (Bienvenu, Patey and Shafer 2017); not re-checked.') },
  'rcolor3>rcolor2': { justification: R('classical', 'Recorded as "by definition" in the RM Zoo database (Bienvenu, Patey and Shafer 2017); not re-checked.') },
  'rrt22>wsrrt22': { justification: restriction('WSRRT²₂ is RRT²₂ restricted to weakly stable colorings.') },
  'wsrrt22>srrt22': { justification: restriction('Normal colorings are weakly stable (as recorded in the RM Zoo database).') },
  'rrt32>srrt32': { justification: restriction(STABLE) },
  'gp22>sgp22': { justification: restriction(STABLE) },
  'cac>wscac': { justification: restriction('WSCAC is CAC restricted to weakly stable partial orders.') },
  'wscac>scac': { justification: restriction('Stable partial orders are weakly stable.') },
  'tt22>tt12': { justification: reduction('Color a pair σ ⊏ τ by the color of σ; a homogeneous subtree for this coloring is homogeneous for the original one, since every node of the subtree has an extension in it.') },
  // ---- free-text citations in the RM Zoo database --------------------------
  'rca0>pa': { justification: R('classical', 'Every ω-model has the standard first-order part ℕ, in which full induction holds.') },
  'rca0>isig3': { justification: R('classical', 'Every ω-model has the standard first-order part ℕ, in which full induction holds.') },
  'rca0>bsig3': { justification: R('classical', 'Every ω-model has the standard first-order part ℕ, in which full induction holds.') },
  'rca0>isig2': { justification: R('classical', 'Every ω-model has the standard first-order part ℕ, in which full induction holds.') },
  'rca0>bsig2': { justification: R('classical', 'Every ω-model has the standard first-order part ℕ, in which full induction holds.') },
  'aca>pa': { refs: [{ ref: 'simpson2009', loc: 'Theorem IX.1.5' }], note: 'Due to Friedman and Harrington.' },
  'cons:wkl:rca0': { refs: [{ ref: 'simpson2009', loc: 'Corollary IX.2.6' }], note: 'Due to Harrington.' },
  'aca>rt22': { refs: [{ ref: 'specker1971', loc: 'Remark 6' }], note: 'RT²₂ has Δ⁰₃ solutions.' },
  'aca>fs3': { refs: [{ ref: 'friedman1999', loc: 'Theorem 2' }] },
  'wkl>fs2': { refs: [{ ref: 'friedman1999', loc: 'Theorem 4' }] },
  'rca0>rt22': { refs: [{ ref: 'specker1971' }] },
  'rt2>aca': { refs: [{ ref: 'seetapunslaman1995' }, { ref: 'hummel1994', loc: 'Theorem 2.1' }, { ref: 'cholakjockuschslaman2001', loc: 'Theorem 3.1' }] },
  'wkl>rt22': { refs: [{ ref: 'jockusch1972', loc: 'Theorem 3.1' }, { ref: 'jockuschsoare1972', loc: 'Theorem 2.1' }], note: 'A computable coloring with no Δ⁰₂ homogeneous set, together with an ω-model of WKL of low sets.' },
  'coh>crt22': { refs: [{ ref: 'cholakjockuschslaman2001', loc: 'Lemma 7.11 (implicit)' }, { ref: 'hirschfeldtshore2007', loc: 'Proposition 1.4' }] },
  'd22>dnr': { refs: [{ ref: 'hirschfeldtetal2008', loc: 'inspection of Theorem 2.4' }] },
  'amt-isig2>pi01g': { refs: [{ ref: 'conidis2008', loc: 'Corollary 3.11 (straightforward verification)' }] },
  'rt22>sram': { refs: [{ ref: 'mileti2004', loc: 'Corollary 5.4.6' }] },
  'pos1>wwkl': { refs: [{ ref: 'yusimpson1990', loc: 'Theorem 1' }] },
  'rt22>rrt32': { refs: [{ ref: 'csimamileti2009' }, { ref: 'cholakjockuschslaman2001' }] },
  'aca>rrt42': { refs: [{ ref: 'jockusch1972' }] },
  'srt22>sem': { refs: [{ ref: 'bienvenupateyshafer2017' }], justification: reduction('Color {x < y} by the direction of the edge; a stable tournament gives a stable coloring, and homogeneous sets are transitive.') },
  'ran1>dnr': { refs: [{ ref: 'kucera1985' }], note: 'Relativization and formalization of Kučera’s theorem.' },
  'hyp>gen1': { refs: [{ ref: 'millermartin1968' }, { ref: 'sacks1963' }], note: 'Every non-trivial Δ⁰₂ degree is hyperimmune (Miller–Martin), there is a Δ⁰₂ minimal degree (Sacks), and sets that join to a 1-generic are Turing incomparable.' },
  'rrt22>dnr0': { justification: R('personal-communication', 'Due to J. Miller (personal communication), as recorded by Patey; see also Patey (2015), Theorem 2.2.'), refs: [{ ref: 'patey2015', loc: 'Theorem 2.2 (citing Miller)' }] },
  'srt22>dnr': { refs: [{ ref: 'hirschfeldtetal2008', loc: 'proof of Theorem 2.3' }] },
  'rt22>gp22': { justification: reduction('An infinite homogeneous set contains an infinite sequence of large finite blocks F₀ < F₁ < ⋯, which is a solution.') },
  'srt22>sgp22': { justification: reduction('An infinite homogeneous set contains an infinite sequence of large finite blocks F₀ < F₁ < ⋯, which is a solution.') },
  'cac>prodwqo': { refs: [{ ref: 'cholakmarconesolomon2004', loc: 'follows from Corollaries 3.4 and 4.6' }] },
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') ? [path.join(d, e.name)] : []);
let done = 0, missing = [];
for (const f of walk('data/results')) {
  const doc = YAML.parseDocument(fs.readFileSync(f, 'utf8'));
  let changed = false;
  for (const n of doc.contents?.items || []) {
    const j = n.toJSON();
    if (!j.folklore) continue;
    const k = j.type === 'property' ? `prop:${j.statement}:${j.property}` : j.type === 'conservation' ? `cons:${j.statement}:${j.base}` : `${j.from}>${j.to}`;
    const rule = RULES[k];
    if (!rule) { missing.push(`${k} (${f})`); continue; }
    if (rule.refs) {
      const refs = j.refs || [];
      for (const r of rule.refs) if (!refs.some((x) => x.ref === r.ref)) refs.push(r);
      n.set('refs', doc.createNode(refs));
      n.delete('folklore');
      if (/^(by definition|follows|due to|corollary|remarked|implicit|inspection|straightforward|relativization|W\. Miller|J\. Miller|Friedman|Hirschfeldt|Cholak|Csima)/i.test(j.note || '')) n.delete('note');
    }
    if (rule.note) n.set('note', rule.note);
    if (/^By definition\.?$/.test(j.note || '')) n.delete('note');
    if (rule.justification) {
      const just = { ...rule.justification };
      if (rule.keepAiOff) delete just.by;
      n.set('justification', doc.createNode(just));
    }
    changed = true; done++;
  }
  if (changed) fs.writeFileSync(f, doc.toString({ lineWidth: 0 }));
}
console.log('processed', done, 'folklore results');
if (missing.length) console.log('no rule for:\n  ' + missing.join('\n  '));
