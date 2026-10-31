import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bibtex, latex, venueFields } from '../site/js/bibtex.js';

test('latex escapes accents and unicode math, keeps $…$', () => {
  assert.equal(latex('Gödel–Kreisel'), 'G{\\"o}del--Kreisel');
  assert.equal(latex('Bjørn Kjos-Hanssen'), 'Bj{\\o}rn Kjos-Hanssen');
  assert.equal(latex('Π⁰₁ classes'), '$\\Pi^0_1$ classes');
  assert.equal(latex('$\\Sigma^0_2$ & more'), '$\\Sigma^0_2$ \\& more');
});

test('venues are parsed into BibTeX fields', () => {
  assert.deepEqual(venueFields({ venue: 'Theory of Computing Systems 61(4), 1376–1426' }),
    { type: 'article', fields: { journal: 'Theory of Computing Systems', volume: '61', number: '4', pages: '1376--1426' } });
  assert.deepEqual(venueFields({ venue: 'Journal of Symbolic Logic 71 (2006), no. 1, 119--136' }).fields,
    { journal: 'Journal of Symbolic Logic', volume: '71', number: '1', pages: '119--136' });
  assert.equal(venueFields({ venue: 'Proceedings of the American Mathematical Society 132(8), 2449–2456' }).type, 'article');
  assert.equal(venueFields({ venue: 'PhD thesis, University of Leeds' }).type, 'phdthesis');
  assert.equal(venueFields({ venue: 'arXiv preprint', arxiv: '1501.00433' }).type, 'misc');
  assert.equal(venueFields({ venue: 'Pursuit of the Universal, 9709, 58–67' }).type, 'inproceedings');
});

test('every reference of the zoo exports to a well-formed entry', () => {
  const z = JSON.parse(fs.readFileSync(new URL('../site/data/zoo.json', import.meta.url)));
  const keys = Object.keys(z.references);
  const out = bibtex(z.references, keys);
  assert.equal((out.match(/^@\w+\{/gm) || []).length, keys.length);
  for (const e of out.split('\n\n')) {
    let d = 0;
    for (const c of e.replace(/\\[{}]/g, '')) { d += c === '{' ? 1 : c === '}' ? -1 : 0; assert.ok(d >= 0, e); }
    assert.equal(d, 0, e);
  }
});
