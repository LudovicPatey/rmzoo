// Long texts read in parts by the AI reader (scripts/lib/split-text.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText } from '../scripts/lib/split-text.mjs';

const page = (head, n = 1000) => `${head}\n${'x'.repeat(n)}`;
// a book: front matter with a table of contents, then chapters of 10, 3, 3 and 30 pages
const toc = 'Contents\nChapter 1 Intro  1\nChapter 2 Two  11\nChapter 3 Three  14\nChapter 4 Four  17\n';
const pages = [page('Title'), toc,
  page('Chapter 1\nIntroduction'), ...Array(9).fill(page('text')),
  page('CHAPTER 2'), page('a'), page('b'),
  page('Chapter 3. Three'), page('a'), page('b'),
  page('Chapter 4'), ...Array(29).fill(page('text'))];
const book = pages.join('\f');

test('short texts are read whole', () => {
  const p = splitText('a\fb');
  assert.equal(p.length, 1);
  assert.equal(p[0].text, 'a\fb');
});

test('chapters are grouped into parts, a long chapter is cut at page breaks', () => {
  const parts = splitText(book, { max: 12000, above: 20000 });
  assert.equal(parts.map((p) => p.text).join('\f'), book); // nothing lost, nothing repeated
  assert.ok(parts.every((p) => p.text.length <= 12000 * 1.1));
  assert.match(parts[0].title, /^chapter 1, pages 1–12$/); // the front matter with chapter 1
  assert.match(parts[1].title, /^chapters 2, 3, pages 13–18$/);
  assert.match(parts[2].title, /^chapter 4 \(1\/3\)/);
  assert.equal(parts.at(-1).pages[1], pages.length);
  assert.deepEqual(parts.map((p) => p.n), parts.map((_, i) => i + 1));
});

test('without chapter headings, pages are cut into equal parts', () => {
  const plain = Array(40).fill(page('text')).join('\f');
  const parts = splitText(plain, { max: 15000, above: 20000 });
  assert.equal(parts.length, 3);
  assert.equal(parts.map((p) => p.text).join('\f'), plain);
});
