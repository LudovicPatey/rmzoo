// Shared helpers for mining the cached full texts (scripts/mine/*.mjs).
import fs from 'node:fs';
import YAML from 'yaml';
import { buildZoo } from '../../site/js/engine.js';
export const raw = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
export const z = buildZoo(raw);
export const index = fs.existsSync('cache/fulltext/index.json') ? JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8')) : {};
// leads already examined (data/screened.yaml): never proposed again
const scr = fs.existsSync('data/screened.yaml') ? YAML.parse(fs.readFileSync('data/screened.yaml', 'utf8')) || {} : {};
export const screened = { facts: new Set(scr.facts || []), questions: new Set(scr.questions || []), resolutions: new Set(scr.resolutions || []) };
// which papers to mine: --only k1,k2 | --since YYYY-MM-DD (date the text was cached) | all
export function selectPapers(args) {
  const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
  return Object.keys(index).filter((k) => fs.existsSync(`cache/fulltext/${k}.txt`) && (!only || only.has(k)) && (!since || (index[k].date || '') >= since));
}

// acronym dictionary: normalized token -> statement id
// label → the acronym as it appears in extracted text (TeX stripped). Overlines and
// hats are kept as marks that text never contains, so D̄₂IP never reads as D₂IP.
const plain = (l) => l.replace(/\\overline\{([^}]*)\}/g, '$1̄').replace(/\\widehat\{([^}]*)\}/g, '$1̂')
  .replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\(mathsf|mathrm|mathbf)\{([^}]*)\}/g, '$2')
  .replace(/\\(lim)\b/g, 'lim').replace(/\\Sigma/g, 'Σ').replace(/\\Pi/g, 'Π').replace(/\\Delta/g, 'Δ').replace(/\\omega/g, 'ω')
  .replace(/<\\infty/g, '<∞').replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_\s]/g, '');
export const dict = new Map();
const put = (t, id) => { if (t && t.length >= 2 && !dict.has(t)) dict.set(t, id); };
// plain statements first (a key never overwrites an existing one)
for (const s of z.S) {
  if (s.conjunction || s.op) continue;
  put(plain(s.label).replace(/Σ0|Π0|Δ0/g, (m) => m[0]), s.id);
}
// operator statements, in the notation of the papers: P′ P∗ P⋄, P ⋆ Q / P ∗ Q, P × Q
// (parallelizations are not recognized: their hat is lost in extracted text)
{
  const forms = new Map(); // id → textual forms
  for (const [t, id] of dict) { if (!forms.has(id)) forms.set(id, []); forms.get(id).push(t); }
  const extraForms = { lpo: ['LPO'], llpo: ['LLPO'], cn: ['CN'], kn: ['KN'], wkl: ['WKL'], lim: ['lim'], tcn: ['TCN'], ucn: ['UCN'], cnn: ['CNN'], ucnn: ['UCNN'] };
  for (const [id, f] of Object.entries(extraForms)) forms.set(id, [...new Set([...(forms.get(id) || []), ...f])]);
  const ops = z.S.filter((s) => s.op);
  for (let round = 0; round < 4; round++) for (const s of ops) {
    const a = (s.args || []).map((x) => forms.get(x) || []);
    if (a.some((x) => !x.length)) continue;
    const f = { jump: () => a[0].flatMap((x) => [x + '′', x + "'"]), fin: () => a[0].flatMap((x) => [x + '∗', x + '*']), diamond: () => a[0].map((x) => x + '⋄'),
      compose: () => a[0].flatMap((x) => a[1].flatMap((y) => [`${x} ∗ ${y}`, `${x} ⋆ ${y}`, `${x}∗${y}`, `${x}⋆${y}`, `${x} ∗${y}`])),
      product: () => a[0].flatMap((x) => a[1].flatMap((y) => [`${x} × ${y}`, `${x}×${y}`])), par: () => [] }[s.op]?.() || [];
    forms.set(s.id, [...new Set([...(forms.get(s.id) || []), ...f])]);
  }
  for (const s of ops) for (const t of forms.get(s.id) || []) put(t, s.id);
}
// common spellings
const extra = { WKL0: 'wkl', ACA0: 'aca', ATR0: 'atr', RCA0: 'rca0', WWKL0: 'wwkl', 'Π11-CA0': 'pi11ca', 'Π11-CA': 'pi11ca',
  'BΣ2': 'bsig2', 'IΣ2': 'isig2', 'BΣ3': 'bsig3', 'IΣ3': 'isig3', 'IΣ1': 'isig1', DNC: 'dnr', 'RT1<∞': 'rt1inf', 'RT2<∞': 'rt2',
  'SRT2<∞': 'srt2', 'D2<∞': 'd2', 'TT1<∞': 'tt1', 'RT<∞1': 'rt1inf', MLR: 'ran1', '2-MLR': 'ran2', '1-GEN': 'gen1', 'Π01G': 'pi01g',
  CN: 'cn', 'C2N': 'wkl', LLPO: 'llpo', LPO: 'lpo', 'C2': 'llpo', 'KN': 'kn', 'CR': 'cr', 'CNN': 'cnn', 'UCNN': 'ucnn', 'lim': 'lim',
  'TS2': 'ts2', 'FS2': 'fs2', 'STS2': 'sts2', 'SFS2': 'sfs2', 'TS(2)': 'ts2', 'STS(2)': 'sts2', 'FS(2)': 'fs2', 'SFS(2)': 'sfs2' };
for (const [k, v] of Object.entries(extra)) if (z.sidx.has(v)) dict.set(k, v);
const keys = [...dict.keys()].sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const tokRe = new RegExp('(?<![A-Za-z0-9])(' + keys.map(esc).join('|') + ')(?![A-Za-z0-9])', 'g');

// principles often stated in words rather than by name: ∀X ∃Y (Y has property P relative to X)
const PHRASES = [
  [/∀X ?∃Y ?\(?Y ?(6≤T|≰T|≱T|T|is not (computable|recursive) in) ?X\)?|for (every|each|all) (sets? )?X,? there (is|exists) a (set )?Y (which|that) is not (computable|recursive) (in|from) X|existence of relatively non-?(computable|recursive) sets/gi, ' NON '],
  [/∀X ?∃Y ?\(?Y is (hyperimmune) (over|relative to) X\)?|for (every|each) X,? there (is|exists) a set (which|that) is hyperimmune relative to X/gi, ' HYP '],
  [/∀X ?∃Y ?\(?Y is (1-random|Martin-Löf random|ML-random) (over|relative to) X\)?/gi, ' 1-RAN '],
  [/∀X ?∃Y ?\(?Y is (1-generic|weakly 1-generic) (over|relative to) X\)?/gi, ' 1-GEN '],
  [/∀X ?∃Y ?\(?Y is (DNC|DNR|diagonally non-?(computable|recursive)) (over|relative to) X ?′\)?/gi, ' 2-DNR '],
  [/∀X ?∃Y ?\(?Y is (DNC|DNR|diagonally non-?(computable|recursive)) (over|relative to) X\)?/gi, ' DNR '],
];
export function normalize(t) {
  for (const [re, tok] of PHRASES) t = t.replace(re, tok);
  return t.replace(/\s+/g, ' ')
    .replace(/([A-Z]{1,6}) ?(\d) (\d)\b/g, '$1$2$3')          // RT2 2 -> RT22
    .replace(/([A-Z]{1,6}) (\d{1,2})\b/g, '$1$2')             // RT 22 -> RT22
    .replace(/Σ ?0 ?(\d)/g, 'Σ$1').replace(/Π ?0 ?(\d)/g, 'Π$1').replace(/Σ(\d) ?0/g, 'Σ$1').replace(/Δ ?0 ?(\d)/g, 'Δ$1')
    .replace(/([BI]) Σ/g, '$1Σ').replace(/Π ?1 ?1 ?-? ?CA ?0?/g, 'Π11-CA').replace(/Π ?0 ?1 ?G/g, 'Π01G')
    .replace(/C ?\{0,1\}N/g, 'C2N').replace(/C ?N ?N/g, 'CNN');
}
export function relation(t) {
  const neg = /(does not imply|not imply|doesn't imply|not provable|do not imply|0 |6⊢|⊬|6≤|≰|not .{0,15}reducib|does not prove|strictly weaker|is not a model|not a model of|incomparable|\|W|\|c)/i.test(t);
  let over = 'rca0';
  if (/ω-model|omega-model|Turing ideal|ω-models/i.test(t)) over = 'omega';
  // one branch per reduction of data/reductions.yaml (finest notation first)
  if (/≤ ?gW|<gW|≡gW|generali[sz]ed Weihrauch/.test(t)) over = 'gw';
  else if (/≤ ?sW|<sW|≡sW|strongly Weihrauch/.test(t)) over = 'sw';
  else if (/≤ ?W|<W|≡W|Weihrauch/.test(t)) over = 'w';
  else if (/≤ ?sc|strongly computabl/.test(t)) over = 'sc';
  else if (/≤ ?c\b|<c\b|≡c|computably reducib/.test(t)) over = 'c';
  else if (/RCA∗0|RCA\*0|RCA∗/.test(t)) over = 'rca0star';
  return { neg, over };
}
