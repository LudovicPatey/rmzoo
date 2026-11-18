// The endorsement server (site/api/, PHP) run with PHP's built-in server and a
// temporary configuration and data directory. Skipped when php is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let php = true;
try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { php = false; }
const skip = php ? false : 'php is not installed';
const zoo = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
// the server starts from the endorsements committed in data/endorsements.yaml (via
// zoo.json): the tests endorse a result that test person has not endorsed and check
// that the committed endorsements are kept
const seeded = zoo.endorsements?.endorsements || [];
const ME = '0000-0002-1825-0097';
const KEY = zoo.results.map((r) => r._key).find((k) => !seeded.some((e) => e.result === k && e.orcid === ME));
const mine = (list) => list.filter((e) => e.orcid === ME).map((e) => e.result);
const TOKEN = 'test-admin-token-0123456789abcdef';
const ITEM = 'test-item-0000';
const port = 18000 + Math.floor(Math.random() * 1000);
const B = `http://127.0.0.1:${port}/api/index.php`;
let server, dir;

// each version of the configuration gets its own modification time (whole seconds), so that
// PHP's opcache, which compares them, sees the change (after its revalidate_freq: settle below)
let version = 0;
const start = (devLogin) => {
  const f = path.join(dir, 'config.php');
  fs.writeFileSync(f, `<?php return ['orcid_client_id' => 'APP-T', 'orcid_client_secret' => 'x',
    'admin_token' => '${TOKEN}', 'data_dir' => ${JSON.stringify(path.join(dir, 'data'))}, 'dev_login' => ${devLogin},
    'review_json' => ${JSON.stringify(path.join(dir, 'review.json'))}];`);
  const at = Math.floor(Date.now() / 1000) + 10 * ++version;
  fs.utimesSync(f, at, at);
};
before(async () => {
  if (!php) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-api-'));
  // the review queue the server sees: one open item, so the test does not depend on the live queue
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ items: [{ id: ITEM, ref: 'test', kind: 'result', status: 'pending' }] }));
  start(true);
  server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'site'], { env: { ...process.env, RMZOO_CONFIG: path.join(dir, 'config.php') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}?a=state`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => { server?.kill(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// a tiny cookie jar
const session = () => {
  let cookie = '';
  const req = async (url, opt = {}) => {
    const r = await fetch(url, { redirect: 'manual', ...opt, headers: { ...(opt.headers || {}), cookie } });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return r;
  };
  return { req };
};
const post = (s, action, body, csrf) => s.req(`${B}?a=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(body) });

test('endorsing needs a signed-in user and the session token', { skip }, async () => {
  const s = session();
  const st = await (await s.req(`${B}?a=state`)).json();
  assert.equal(st.user, null);
  assert.equal((await post(s, 'endorse', { result: KEY, endorse: true }, st.csrf)).status, 401);
  assert.equal((await s.req(`${B}?a=devlogin&orcid=0000-0002-1825-0098`)).status, 400); // bad check digit
  assert.equal((await s.req(`${B}?a=devlogin&orcid=0000-0002-1825-0097&name=Josiah%20Carberry`)).status, 302);
  const st2 = await (await s.req(`${B}?a=state`)).json();
  assert.equal(st2.user.orcid, '0000-0002-1825-0097');
  assert.equal((await post(s, 'endorse', { result: KEY, endorse: true })).status, 403); // no CSRF token
  assert.equal((await post(s, 'endorse', { result: 'no|such|result', endorse: true }, st2.csrf)).status, 404);
  const r = await (await post(s, 'endorse', { result: KEY, endorse: true }, st2.csrf)).json();
  assert.deepEqual(mine(r.endorsements), [KEY]);
  assert.equal(r.endorsements.length, seeded.length + 1); // the committed ones are kept
  assert.equal(r.people[ME].name, 'Josiah Carberry');
  // endorsing twice keeps one endorsement; withdrawing forgets the person
  await post(s, 'endorse', { result: KEY, endorse: true }, st2.csrf);
  assert.equal((await (await s.req(`${B}?a=state`)).json()).endorsements.length, seeded.length + 1);
  const w = await (await post(s, 'endorse', { result: KEY, endorse: false }, st2.csrf)).json();
  assert.deepEqual(mine(w.endorsements), []);
  assert.equal(w.endorsements.length, seeded.length);
  assert.ok(!w.people[ME]);
});

test('comments are stored with the object they are about, and exported with the admin token', { skip }, async () => {
  const s = session();
  await s.req(`${B}?a=devlogin&orcid=0000-0001-2345-6789&name=Ada`);
  const { csrf } = await (await s.req(`${B}?a=state`)).json();
  assert.equal((await post(s, 'feedback', { kind: 'error', target: { type: 'result', id: KEY }, text: '' }, csrf)).status, 400);
  assert.equal((await post(s, 'feedback', { kind: 'spam', target: { type: 'result', id: KEY }, text: 'x' }, csrf)).status, 400);
  assert.equal((await post(s, 'feedback', { kind: 'error', target: { type: 'result', id: KEY }, text: 'Wrong direction.' }, csrf)).status, 200);
  assert.equal((await post(s, 'feedback', { kind: 'comment', target: { type: 'statement', id: 'coh' }, text: 'Nice.' }, csrf)).status, 200);
  assert.equal((await s.req(`${B}?a=export`)).status, 403);
  const ex = await (await fetch(`${B}?a=export`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  const err = ex.feedback.find((f) => f.kind === 'error');
  assert.equal(err.target.result.type, zoo.results[0].type);
  assert.equal(err.author.orcid, '0000-0001-2345-6789');
  assert.equal(ex.feedback.find((f) => f.kind === 'comment').target.statement.id, 'coh');
});

test('answers to messages: admin token only, shown to the author, kept once', { skip }, async () => {
  const s = session();
  await s.req(`${B}?a=devlogin&orcid=0000-0001-2345-6789&name=Ada`);
  const { csrf } = await (await s.req(`${B}?a=state`)).json();
  const { id } = await (await post(s, 'feedback', { kind: 'comment', target: { type: 'statement', id: 'coh' }, text: 'A question.' }, csrf)).json();
  const answer = (body, token = TOKEN) => fetch(`${B}?a=answer`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await answer({ id, text: 'x' }, 'wrong-token-wrong-token-wrong')).status, 403);
  assert.equal((await post(s, 'answer', { id, text: 'x' }, csrf)).status, 403, 'a signed-in user cannot answer');
  assert.equal((await answer({ id: '../endorsements', text: 'x' })).status, 400);
  assert.equal((await answer({ id, text: '' })).status, 400);
  assert.equal((await answer({ id, text: 'Thanks.', by: 'robot' })).status, 400);
  assert.equal((await answer({ id, text: 'Thanks: see [[coh]].', by: 'ai' })).status, 200);
  assert.equal((await answer({ id, text: 'Thanks: see [[coh]].', by: 'ai' })).status, 200);
  const { messages } = await (await s.req(`${B}?a=mine`)).json();
  const m = messages.find((x) => x.id === id);
  assert.equal(m.answers.length, 1);
  assert.equal(m.answers[0].by, 'ai');
});

// PHP's opcache may keep a rewritten config.php for up to 2 s (revalidate_freq): wait
const settle = () => new Promise((r) => setTimeout(r, 2100));
test('the development sign-in is off unless configured', { skip }, async () => {
  start(false);
  await settle();
  assert.equal((await fetch(`${B}?a=devlogin&orcid=0000-0002-1825-0097`, { redirect: 'manual' })).status, 404);
  start(true);
  await settle();
});

// the review page (docs/REVIEW.md): votes and public comments on the open items of the
// review queue (a temporary review.json with one item, written in before())
test('votes and comments on review items', { skip }, async () => {
  const s = session();
  let st = await (await s.req(`${B}?a=state`)).json();
  assert.equal((await post(s, 'review', { item: ITEM, verdict: 'valid' }, st.csrf)).status, 401);
  await s.req(`${B}?a=devlogin&orcid=${ME}&name=Josiah%20Carberry`);
  st = await (await s.req(`${B}?a=state`)).json();
  assert.equal((await post(s, 'review', { item: 'no-such-item', verdict: 'valid' }, st.csrf)).status, 404);
  assert.equal((await post(s, 'review', { item: ITEM, verdict: 'maybe' }, st.csrf)).status, 400);
  const mineOn = (r) => r.reviews.filter((v) => v.item === ITEM && v.orcid === ME).map((v) => v.verdict);
  assert.deepEqual(mineOn(await (await post(s, 'review', { item: ITEM, verdict: 'valid' }, st.csrf)).json()), ['valid']);
  let r = await (await post(s, 'review', { item: ITEM, verdict: 'invalid' }, st.csrf)).json(); // a new vote replaces the old one
  assert.deepEqual(mineOn(r), ['invalid']);
  assert.equal(r.people[ME].name, 'Josiah Carberry');
  // comments are public; only their author deletes them
  assert.equal((await post(s, 'rcomment', { item: ITEM, text: ' ' }, st.csrf)).status, 400);
  r = await (await post(s, 'rcomment', { item: ITEM, text: 'Theorem 3 says the converse.' }, st.csrf)).json();
  const c = r.comments.find((x) => x.item === ITEM && x.orcid === ME);
  assert.equal(c.text, 'Theorem 3 says the converse.');
  const other = session();
  await other.req(`${B}?a=devlogin&orcid=0000-0001-2345-6789&name=Ada`);
  const ost = await (await other.req(`${B}?a=state`)).json();
  assert.ok(ost.comments.some((x) => x.id === c.id)); // everyone sees it
  await post(other, 'rcomment', { delete: c.id }, ost.csrf);
  assert.ok((await (await s.req(`${B}?a=state`)).json()).comments.some((x) => x.id === c.id));
  const ex = await (await fetch(`${B}?a=export`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.ok(ex.reviews.some((v) => v.item === ITEM && v.orcid === ME) && ex.comments.some((x) => x.id === c.id));
  // withdrawing the vote and deleting the comment: the person is forgotten (no endorsement either)
  await post(s, 'rcomment', { delete: c.id }, st.csrf);
  r = await (await post(s, 'review', { item: ITEM, verdict: null }, st.csrf)).json();
  assert.deepEqual(mineOn(r), []);
  assert.ok(!r.people[ME]);
});

// contributed facts (the "Contribute facts" box), one's own messages, and the public
// discussion of the open questions
test('suggestions of facts, own messages and comments on questions', { skip }, async () => {
  const s = session();
  await s.req(`${B}?a=devlogin&orcid=0000-0001-2345-6789&name=Ada`);
  const { csrf } = await (await s.req(`${B}?a=state`)).json();
  const fact = { type: 'implication', from: 'rt22', to: 'coh', over: 'rca0' };
  const send = (facts) => post(s, 'feedback', { kind: 'suggestion', target: { type: 'general', id: '' }, facts, text: '' }, csrf);
  assert.equal((await send([])).status, 400);
  assert.equal((await send([fact])).status, 400, 'a fact needs a source or a justification');
  assert.equal((await send([{ ...fact, from: 'nope', source: { citation: 'x' } }])).status, 404);
  assert.equal((await send([{ ...fact, source: { ref: 'no-such-paper' } }])).status, 404);
  assert.equal((await send([{ type: 'property', statement: 'rt12', property: 'cone-avoidance', value: true, justification: 'Seetapun.' },
    { ...fact, source: { ref: zoo.results.find((r) => r.refs?.length).refs[0].ref, loc: 'Theorem 1' } }])).status, 200);
  const mine = await (await s.req(`${B}?a=mine`)).json();
  const sug = mine.messages.find((m) => m.kind === 'suggestion');
  assert.equal(sug.facts.length, 2);
  assert.equal(sug.facts[0].propertyName, zoo.properties.find((p) => p.id === 'cone-avoidance').name);
  assert.equal(sug.facts[1].statements[0].id, 'rt22');
  // another person does not see these messages
  const o = session();
  await o.req(`${B}?a=devlogin&orcid=${ME}&name=Josiah%20Carberry`);
  assert.ok(!(await (await o.req(`${B}?a=mine`)).json()).messages.some((m) => m.author.orcid !== ME));
  // public comments on questions
  const q = zoo.questions[0].id;
  assert.equal((await post(s, 'qcomment', { question: 'nope', text: 'x' }, csrf)).status, 404);
  const r = await (await post(s, 'qcomment', { question: q, text: 'A partial answer.' }, csrf)).json();
  const c = r.qcomments.find((x) => x.question === q && x.orcid === '0000-0001-2345-6789');
  assert.equal(c.text, 'A partial answer.');
  assert.ok((await (await fetch(`${B}?a=state`)).json()).qcomments.some((x) => x.id === c.id), 'public');
  const ostate = await (await o.req(`${B}?a=state`)).json();
  await post(o, 'qcomment', { delete: c.id }, ostate.csrf); // not one's own: ignored
  assert.ok((await (await fetch(`${B}?a=state`)).json()).qcomments.some((x) => x.id === c.id));
  await post(s, 'qcomment', { delete: c.id }, csrf);
  assert.ok(!(await (await fetch(`${B}?a=state`)).json()).qcomments.some((x) => x.id === c.id));
  const ex = await (await fetch(`${B}?a=export`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.ok(Array.isArray(ex.qcomments));
});

// saved diagrams: private to their owner, replaced by name, validated against zoo.json
test('saved diagrams', { skip }, async () => {
  const s = session();
  let st = await (await s.req(`${B}?a=state`)).json();
  assert.equal((await s.req(`${B}?a=diagrams`)).status, 401);
  assert.equal((await post(s, 'diagram', { name: 'x', s: ['rt22'], r: 'rca0' }, st.csrf)).status, 401);
  await s.req(`${B}?a=devlogin&orcid=${ME}&name=Josiah%20Carberry`);
  st = await (await s.req(`${B}?a=state`)).json();
  const d = { name: 'Ramsey', s: ['rt22', 'coh', 'srt22', 'coh'], r: 'rca0', sep: true, open: false };
  assert.equal((await post(s, 'diagram', d)).status, 403); // no CSRF token
  assert.equal((await post(s, 'diagram', { ...d, name: ' ' }, st.csrf)).status, 400);
  assert.equal((await post(s, 'diagram', { ...d, s: [] }, st.csrf)).status, 400);
  assert.equal((await post(s, 'diagram', { ...d, s: ['no-such-statement'] }, st.csrf)).status, 404);
  assert.equal((await post(s, 'diagram', { ...d, r: 'nope' }, st.csrf)).status, 404);
  let r = await (await post(s, 'diagram', d, st.csrf)).json();
  assert.equal(r.diagrams.length, 1);
  const [saved] = r.diagrams;
  assert.deepEqual([saved.name, saved.s, saved.r, saved.sep, saved.open], ['Ramsey', ['rt22', 'coh', 'srt22'], 'rca0', true, false]);
  // the same name (ignoring case) replaces it and keeps its id; another name adds one
  r = await (await post(s, 'diagram', { ...d, name: 'ramsey', r: 'sw' }, st.csrf)).json();
  assert.equal(r.diagrams.length, 1);
  assert.equal(r.diagrams[0].id, saved.id);
  assert.equal(r.diagrams[0].r, 'sw');
  r = await (await post(s, 'diagram', { ...d, name: 'Choice' }, st.csrf)).json();
  assert.equal(r.diagrams.length, 2);
  assert.deepEqual((await (await s.req(`${B}?a=diagrams`)).json()).diagrams.map((x) => x.name).sort(), ['Choice', 'ramsey']);
  // private: another person sees none of them and cannot delete them
  const o = session();
  await o.req(`${B}?a=devlogin&orcid=0000-0001-2345-6789&name=Ada`);
  const ost = await (await o.req(`${B}?a=state`)).json();
  assert.deepEqual((await (await o.req(`${B}?a=diagrams`)).json()).diagrams, []);
  assert.equal((await post(o, 'diagram', { delete: saved.id }, ost.csrf)).status, 404);
  assert.ok(!JSON.stringify(await (await fetch(`${B}?a=state`)).json()).includes('Ramsey'));
  // deleting
  r = await (await post(s, 'diagram', { delete: saved.id }, st.csrf)).json();
  assert.deepEqual(r.diagrams.map((x) => x.name), ['Choice']);
  r = await (await post(s, 'diagram', { delete: r.diagrams[0].id }, st.csrf)).json();
  assert.deepEqual(r.diagrams, []);
});
