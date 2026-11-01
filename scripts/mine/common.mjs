// Shared helpers for mining the cached full texts (scripts/mine/*.mjs).
import fs from 'node:fs';
import { buildZoo } from '../../site/js/engine.js';
export const raw = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
export const z = buildZoo(raw);
export const index = fs.existsSync('cache/fulltext/index.json') ? JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8')) : {};
// which papers to mine: --only k1,k2 | --since YYYY-MM-DD (date the text was cached) | all
export function selectPapers(args) {
  const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
  return Object.keys(index).filter((k) => fs.existsSync(`cache/fulltext/${k}.txt`) && (!only || only.has(k)) && (!since || (index[k].date || '') >= since));
}

// acronym dictionary: normalized token -> statement id
const plain = (l) => l.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\(mathsf|mathrm|mathbf)\{([^}]*)\}/g, '$2')
  .replace(/\\(lim)\b/g, 'lim').replace(/\\Sigma/g, 'Σ').replace(/\\Pi/g, 'Π').replace(/\\Delta/g, 'Δ')
  .replace(/<\\infty/g, '<∞').replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_\s]/g, '');
export const dict = new Map();
for (const s of z.S) {
  if (s.conjunction) continue;
  let t = plain(s.label).replace(/Σ0|Π0|Δ0/g, (m) => m[0]).replace(/'/g, "'");
  if (t.length < 2) continue;
  dict.set(t, s.id);
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

export function normalize(t) {
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
  if (/≤ ?sW|<sW|≡sW|strongly Weihrauch/.test(t)) over = 'sw';
  else if (/≤ ?W|<W|≡W|Weihrauch/.test(t)) over = 'w';
  else if (/≤ ?sc|strongly computabl/.test(t)) over = 'sc';
  else if (/≤ ?c\b|<c\b|≡c|computably reducib/.test(t)) over = 'c';
  else if (/RCA∗0|RCA\*0|RCA∗/.test(t)) over = 'rca0star';
  return { neg, over };
}
