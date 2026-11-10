// How a paper cites another (scripts/lib/citations.mjs): consolidation step 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bibLabels, citationPattern } from '../scripts/lib/citations.mjs';

const body = Array(40).fill('Some text of the paper.').join('\n');
const text = `${body}
These results answer the second part of Question 24 of [13].
References
 6. Anton Freund, Alberto Marcone, Fedor Pakhomov, and Giovanni Soldà, Provable better-quasi-orders, Notre Dame
    Journal of Formal Logic 66 (2025), no. 2, 175–188.
 7. Anton Freund, Fedor Pakhomov, and Giovanni Soldà, The logical strength of minimal bad arrays, 2023.
12. Alberto Marcone, On the logical strength of Nash-Williams’ theorem on transfinite sequences, Clarendon
    Press, 1996, p. 327–351.
13. Antonio Montalbán, Open questions in reverse mathematics, The Bulletin of Symbolic Logic 17 (2011), 431–454.
[Gol67]   E. M. Gold, Language identification in the limit, Inform. and Control 10 (1967), 447–474.
[9] A. M. Fernandes. The Baire category theorem over a feasible base theory. In Stephen Simpson,
editor, Reverse Mathematics 2001, volume 21 of Lecture Notes in Logic, pages 164–174.
`;
const montalban = { authors: ['Antonio Montalbán'], title: 'Open questions in reverse mathematics', year: 2011 };
const marcone = { authors: ['Alberto Marcone'], title: "On the logical strength of Nash-Williams' theorem on transfinite sequences", year: 1996 };

test('the label of a work in a bibliography: first author and title words', () => {
  assert.deepEqual(bibLabels(text, montalban), ['13']);
  assert.deepEqual(bibLabels(text, marcone), ['12']); // not [6], where Marcone is a co-author
  assert.deepEqual(bibLabels(text, { authors: ['E. Mark Gold'], title: 'Language identification in the limit', year: 1967 }), ['Gol67']);
  // Simpson edited the volume of [9], he is not its author
  assert.deepEqual(bibLabels(text, { authors: ['Stephen G. Simpson'], title: 'Reverse Mathematics 2001', year: 2005 }), []);
  assert.deepEqual(bibLabels(text, { authors: ['Someone Else'], title: 'Open questions in reverse mathematics', year: 2011 }), []);
});

test('a numbered citation stands for the author in question passages', () => {
  const re = new RegExp(`(answer)[a-z]*[^.]{0,80}(question)[^.]{0,80}${citationPattern(text, montalban)}`, 'i');
  assert.match(text, re);
  assert.match('as asked in [4, 13, Question 2].', new RegExp(citationPattern(text, montalban)));
  assert.doesNotMatch('see [113].', new RegExp(citationPattern(text, montalban)));
});
