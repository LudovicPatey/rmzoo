// Splitting a long text (a book, a thesis) into parts that the AI reader
// (scripts/ai-analyze.mjs) reads one at a time: a whole book does not fit in one
// call, or leaves too little room for the answer. Pure function, tested in
// tests/split-text.test.mjs.
//
// Pages are separated by form feeds (pdftotext). A chapter starts on a page whose
// first lines hold a heading "Chapter 3", "CHAPTER IV" or "Chapter II. Title"
// (tables of contents do not count). Whole
// chapters are grouped into parts of at most `max` characters; a chapter longer
// than that is cut at page breaks into equal pieces. Without chapter headings, the
// pages are cut into equal pieces. The front matter goes with the first part.
//
//   splitText(text, { max }) → [{ n, of, title, pages: [first, last], text }]
//   (pages numbered from 1 in the PDF; a short text gives one part, the whole text)

const HEADING = /^\s*(?:CHAPTER|Chapter)\s+(\d{1,2}|[IVXL]{1,6})\b\.?(?:\s+\S.*)?$/;
export const SPLIT_ABOVE = 400000; // texts longer than this are read in parts
export const PART_CHARS = 250000;  // at most this many characters per part (about 80 pages)

export function splitText(text, { max = PART_CHARS, above = SPLIT_ABOVE } = {}) {
  if (text.length <= above) return [{ n: 1, of: 1, title: 'whole text', pages: null, text }];
  const pages = text.split('\f');
  // chapter starts: [page index, chapter label]
  const starts = [];
  pages.forEach((p, i) => {
    const top = p.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6);
    const lines = p.split('\n');
    // a table of contents: several chapter headings, or many lines ending in a page number
    if (lines.filter((l) => HEADING.test(l)).length > 2 || /\bContents\b/.test(p.slice(0, 300))
      || lines.filter((l) => /(\s{3,}|\.\s?\.\s?\.\s*)[\dIVXLl]+\s*$/.test(l)).length >= 5) return;
    const h = top.find((l) => HEADING.test(l));
    if (h && !starts.some(([, label]) => label === h.match(HEADING)[1])) starts.push([i, h.match(HEADING)[1]]);
  });
  if (!starts.length || starts[0][0] !== 0) starts.unshift([0, null]); // front matter
  // chapters as page ranges, then pieces of at most `max` characters
  const size = (a, b) => pages.slice(a, b + 1).reduce((s, p) => s + p.length + 1, 0);
  const pieces = [];
  starts.forEach(([a, label], j) => {
    const b = j + 1 < starts.length ? starts[j + 1][0] - 1 : pages.length - 1;
    const total = size(a, b);
    const k = Math.ceil(total / max);
    if (k <= 1) { pieces.push({ a, b, labels: label ? [label] : [] }); return; }
    // equal cuts at page breaks
    let from = a;
    for (let c = 1; c <= k; c++) {
      let to = from;
      while (to < b && size(from, to + 1) <= total / k * 1.05) to++;
      if (c === k) to = b;
      pieces.push({ a: from, b: to, labels: label ? [`${label} (${c}/${k})`] : [] });
      from = to + 1;
      if (from > b) break;
    }
  });
  // group consecutive pieces up to `max`
  const parts = [];
  for (const p of pieces) {
    const last = parts.at(-1);
    if (last && size(last.a, p.b) <= max) { last.b = p.b; last.labels.push(...p.labels); }
    else parts.push({ ...p, labels: [...p.labels] });
  }
  return parts.map((p, i) => ({
    n: i + 1,
    of: parts.length,
    title: `${p.labels.length ? `${p.labels.length > 1 ? 'chapters' : 'chapter'} ${p.labels.join(', ')}, ` : ''}pages ${p.a + 1}–${p.b + 1}`,
    pages: [p.a + 1, p.b + 1],
    text: pages.slice(p.a, p.b + 1).join('\f'),
  }));
}
