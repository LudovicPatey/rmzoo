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

const start = (devLogin) => {
  fs.writeFileSync(path.join(dir, 'config.php'), `<?php return ['orcid_client_id' => 'APP-T', 'orcid_client_secret' => 'x',
    'admin_token' => '${TOKEN}', 'data_dir' => ${JSON.stringify(path.join(dir, 'data'))}, 'dev_login' => ${devLogin},
    'review_json' => ${JSON.stringify(path.join(dir, 'review.json'))}];`);
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

test('the development sign-in is off unless configured', { skip }, async () => {
  start(false);
  assert.equal((await fetch(`${B}?a=devlogin&orcid=0000-0002-1825-0097`, { redirect: 'manual' })).status, 404);
  start(true);
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
