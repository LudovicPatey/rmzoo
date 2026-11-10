// How a paper cites another one in its text: the first author's surname, and the
// label of the work in the paper's own bibliography when it has one ("[13]",
// "[Mon11]"). Used by the consolidation (step 6) to find passages that answer a
// recorded question: "These results answer Question 24 of [13]".
import { surname } from '../../site/js/names.js';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// words of titles too common in the field to tell two papers apart
const COMMON = new Set(['reverse', 'mathematics', 'mathematical', 'arithmetic', 'theorem', 'theorems', 'principle', 'principles',
  'second', 'computability', 'computable', 'strength', 'logical', 'subsystems', 'theory', 'between', 'relative', 'recursive']);

// the labels under which `text` lists the reference `r` ({authors, title, year}) in
// its bibliography: an entry (a line starting with "[13]", "13." or "[Mon11]") that
// starts with the first author's name and shares two long words with the title (in
// "Surname, F." entries the first comma follows the surname, which is then found too)
export function bibLabels(text, r) {
  const sur = fold(surname(r.authors?.[0]));
  if (sur.length < 3) return [];
  const words = fold(r.title).replace(/\$[^$]*\$/g, ' ').split(/[^a-z]+/).filter((w) => w.length >= 6 && !COMMON.has(w));
  const lines = String(text).split('\n');
  const start = Math.floor(lines.length * 0.6); // the bibliography is at the end
  const out = new Set();
  const LABEL = /^\s*(?:\[([A-Za-z]{1,8}\+?\d{2}[a-z]?|\d{1,3})\]|(\d{1,3})\.)\s+\S/;
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    // the entry: up to three lines, stopping where the next entry starts
    let raw = lines[i].slice(m[0].length - 1);
    for (let j = i + 1; j < i + 3 && j < lines.length && !LABEL.test(lines[j]); j++) raw += ' ' + lines[j];
    const entry = fold(raw);
    // its first author (up to the first comma or "and") has the surname; the title
    // shares two long words (one if it has only one)
    const first = entry.split(/,| and |\. (?=[a-z]{3,} [a-z])/)[0]; // "a. m. fernandes. the baire…": the name only
    const hits = words.filter((w) => entry.includes(w)).length;
    if (!words.length || !first.includes(sur) || hits < Math.min(2, words.length)) continue;
    out.add(m[1] || m[2]);
  }
  return [...out];
}

// a regular expression source matching a citation of `r` in `text`: its surname, or
// its bibliography label inside brackets ("[13]", "[4, 13]", "[13, Question 2]")
// (labels: false, only the bracket label; null when the paper does not list it)
export function citationPattern(text, r, { name = true } = {}) {
  const alts = name ? [esc(surname(r.authors?.[0]))] : [];
  for (const l of bibLabels(text, r)) alts.push(`\\[(?:[^\\]]{0,40}[,;] ?)?${esc(l)}(?:[,;][^\\]]{0,40})?\\]`);
  return alts.length ? `(?:${alts.join('|')})` : null;
}
