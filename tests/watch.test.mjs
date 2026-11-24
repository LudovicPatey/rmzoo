// Watchlists (site/js/watch.js, docs/WATCH.md): the filter language, the facts a filter
// matches on a toy zoo, and what counts as new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildZoo } from '../site/js/engine.js';
import { queryIndex } from '../site/js/query.js';
import { parseWatch, describeWatch, watchItems, newKeys, keyHash, addFilter, markSeen, removeFilter, mergeWatch, completeWatch, findPapers } from '../site/js/watch.js';

const raw = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
const Z = buildZoo(raw);
const X = queryIndex(Z);
const id = (i) => Z.S[i].id;

test('the filter language', () => {
  const f = parseWatch(X, 'RT22 vs COH over W');
  assert.deepEqual([f.kind, f.a.map(id), f.b.map(id), f.r.map((r) => Z.raw.reductions[r].id)], ['rel', ['rt22'], ['coh'], ['w']]);
  assert.equal(parseWatch(X, 'RT22 vs any').b, 'any');
  const two = parseWatch(X, 'RT22 vs COH over W, c and ω-models');
  assert.deepEqual([two.b.map(id), two.r.map((r) => Z.raw.reductions[r].id)], [['coh'], ['w', 'c', 'omega']]);
  assert.match(parseWatch(X, 'RT22 vs COH over nowhere').error, /Unknown reduction/);
  assert.equal(parseWatch(X, 'SADS').b, 'any'); // a single statement: its relations with any other
  const p = parseWatch(X, 'properties of RT22, SRT22');
  assert.deepEqual([p.kind, p.a.map(id), p.p], ['prop', ['rt22', 'srt22'], null]);
  assert.deepEqual(parseWatch(X, 'cone avoidance of RT22').p.map((k) => Z.raw.properties[k].id), ['cone-avoidance']);
  assert.equal(parseWatch(X, 'results on DS').kind, 'results');
  assert.equal(parseWatch(X, 'questions about COH').kind, 'questions');
  assert.equal(parseWatch(X, 'about KPT').kind, 'about');
  assert.match(parseWatch(X, 'foo vs bar').error, /Unknown statement/);
  assert.ok(parseWatch(X, '').error);
  assert.match(describeWatch(X, f), /Relations between rt22 and coh over/);
});

test('the facts a filter matches, and what is new', () => {
  const f = parseWatch(X, 'RT22 vs COH over W');
  const items = watchItems(Z, f);
  assert.ok(items.has('I|w|rt22|coh')); // COH ≤W RT²₂
  assert.ok([...items.keys()].every((k) => /^[IN]\|w\|(rt22\|coh|coh\|rt22)$/.test(k)));
  const props = watchItems(Z, parseWatch(X, 'cone avoidance of RT22'));
  assert.deepEqual([...props.keys()], ['P|cone-avoidance|rt22|true']);
  assert.ok([...watchItems(Z, parseWatch(X, 'results on DS')).keys()].every((k) => k.startsWith('R|')));
  // adding a filter marks the current facts as seen; a fact appearing later is new
  let list = addFilter({}, 'RT22 vs COH over W', items, '2026-11-24T12:00:00Z');
  assert.equal(list.filters.length, 1);
  assert.deepEqual(newKeys(items, list.filters[0].seen), []);
  const later = new Map([...items, ['N|c|coh|rt22', { type: 'separated' }]]);
  assert.deepEqual(newKeys(later, list.filters[0].seen), ['N|c|coh|rt22']);
  list = markSeen(list, list.filters[0].id, later);
  assert.deepEqual(newKeys(later, list.filters[0].seen), []);
  assert.equal(addFilter(list, ' rt22 VS coh over w', items).filters.length, 1); // the same filter twice
  assert.equal(mergeWatch(list, addFilter({}, 'about KPT', new Map())).filters.length, 2);
  assert.equal(removeFilter(list, list.filters[0].id).filters.length, 0);
  assert.match(keyHash('I|w|rt22|coh'), /^[0-9a-z]{1,7}$/);
});

test('more forms: one direction, cones, a property of every statement, papers, statements, questions, errata', () => {
  const up = parseWatch(X, 'RT22 ≤W SRT22');
  assert.deepEqual([up.kind, up.dir, up.r.map((r) => Z.raw.reductions[r].id)], ['rel', 'up', ['w']]);
  assert.deepEqual([...watchItems(Z, up).keys()], ['N|w|srt22|rt22']); // RT²₂ ≰W SRT²₂: one direction only
  assert.ok([...watchItems(Z, parseWatch(X, 'RT22 → COH')).keys()].every((k) => /\|rt22\|coh$/.test(k)));
  const below = watchItems(Z, parseWatch(X, 'below SADS over W'));
  assert.ok(below.size && [...below.keys()].every((k) => k.startsWith('I|w|sads|')));
  assert.ok([...watchItems(Z, parseWatch(X, 'above KPT over W')).keys()].every((k) => /^I\|w\|[^|]+\|kpt$/.test(k)));
  const ca = parseWatch(X, 'cone avoidance of any');
  assert.equal(ca.a, 'any');
  assert.ok([...watchItems(Z, ca).keys()].every((k) => k.startsWith('P|cone-avoidance|')));
  assert.deepEqual(findPapers(Z, 'Cholak Downey Igusa 2017'), ['cholakdowneyigusa2017']);
  assert.deepEqual(parseWatch(X, 'results from cholakdowneyigusa2017').refs, ['cholakdowneyigusa2017']);
  assert.match(parseWatch(X, 'results from Nobody 1900').error, /No paper/);
  assert.ok(watchItems(Z, parseWatch(X, 'papers by Valenti')).size > 3);
  assert.ok(watchItems(Z, parseWatch(X, 'papers on FIP')).has('B|cintioli2026b'));
  assert.equal(watchItems(Z, parseWatch(X, 'new papers')).size, Object.keys(raw.references).length);
  assert.ok(watchItems(Z, parseWatch(X, 'statements tagged Ramsey theory')).has('S|rt22'));
  assert.match(parseWatch(X, 'statements tagged nothing').error, /Unknown category/);
  assert.equal(watchItems(Z, parseWatch(X, 'all questions')).size, raw.questions.length);
  assert.ok(watchItems(Z, parseWatch(X, 'errata of brattkapauly2018')).has('E|brattkapauly2018|Proposition 3.11'));
  for (const t of ['RT22 ≤W SRT22', 'below SADS', 'cone avoidance of any', 'results from cintioli2026b', 'papers by Valenti', 'new papers', 'statements tagged Ramsey theory', 'all questions', 'errata'])
    assert.ok(describeWatch(X, parseWatch(X, t)).length > 5, t);
});

test('completions follow the grammar', () => {
  const search = (t, n) => Z.S.map((s, i) => [s, i]).filter(([s]) => s.id.startsWith(t.toLowerCase())).slice(0, n).map(([, i]) => i);
  const full = (t) => completeWatch(X, t, { search }).map((it) => t.slice(0, it.from) + it.insert);
  assert.ok(full('').includes('about ') && full('').includes('new papers'));
  assert.ok(full('res').includes('results from ') && full('res').includes('results on '));
  assert.deepEqual(full('RT22 ').slice(0, 2), ['RT22 vs ', 'RT22 vs any']);
  assert.ok(full('RT22 vs COH over ').includes('RT22 vs COH over W'));
  assert.ok(!full('RT22 vs COH over W, ').includes('RT22 vs COH over W, W')); // a reduction once
  assert.ok(full('cone av').includes('cone avoidance of '));
  assert.ok(full('statements tagged ra').includes('statements tagged Ramsey theory'));
  assert.ok(full('results from cintioli').includes('results from cintioli2026b'));
  assert.ok(full('papers by valen').includes('papers by Valenti'));
  assert.ok(full('properties of RT22 ').includes('properties of RT22, '));
  assert.ok(full('about kp').some((x) => /^about kpt/i.test(x)));
});
