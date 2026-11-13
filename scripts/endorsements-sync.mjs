// Download the endorsements, review votes and comments written on the live
// instance (the PHP server in site/api/, docs/ENDORSEMENTS.md, docs/REVIEW.md)
// into the repository:
//   - data/endorsements.yaml is replaced by the server's state (the server is
//     authoritative for endorsements and for the people who took part);
//   - the votes and public comments on the review page are copied into the open
//     items of data/review.yaml (`votes`, `comments`); then
//     `node scripts/review.mjs apply` carries them out; review `git diff` and commit;
//   - the public comments on the open questions become `discussions` in
//     data/endorsements.yaml (shown on the question pages of every copy);
//   - each fact of a new suggestion (the "Contribute facts" box) becomes a pending
//     `result` item of data/review.yaml (origin: contributed), shown on the review page;
//   - each new comment, error report or suggestion becomes feedback/inbox/<id>.json
//     (feedback/ is git-ignored: messages are private). Move a file to
//     feedback/done/ once treated; it is never downloaded again.
//
//   RMZOO_ADMIN_TOKEN=… node scripts/endorsements-sync.mjs [--url URL] [--dry-run]
//
// The token is the admin_token of the server's api/config.php; it can also be
// kept in cache/admin-token (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { cli } from './lib/cli.mjs';
import { acquireLock } from './lib/lock.mjs';
import { orcidValid } from './lib/schema.mjs';
import { readQueue, writeQueue, addToQueue } from './lib/review-queue.mjs';

const args = cli('RMZOO_ADMIN_TOKEN=… node scripts/endorsements-sync.mjs [--url https://rmzoo.ludovicpatey.com] [--dry-run]',
  { '--url': 1, '--dry-run': 0 });
const url = args.get('--url', process.env.RMZOO_URL || 'https://rmzoo.ludovicpatey.com').replace(/\/$/, '');
const token = process.env.RMZOO_ADMIN_TOKEN || (fs.existsSync('cache/admin-token') ? fs.readFileSync('cache/admin-token', 'utf8').trim() : '');
if (!token) { console.error('No admin token: set RMZOO_ADMIN_TOKEN or write it to cache/admin-token.'); process.exit(1); }
const dry = args.has('--dry-run');
if (!dry) acquireLock('endorsements-sync.mjs');

const res = await fetch(`${url}/api/index.php?a=export`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`${url}: ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const data = await res.json();

// ---- endorsements ----------------------------------------------------------------
const people = Object.fromEntries(Object.entries(data.people || {}).sort(([a], [b]) => a.localeCompare(b))
  .map(([k, p]) => [k, { name: p.name }]));
const endorsements = (data.endorsements || []).map((e) => ({ result: e.result, orcid: e.orcid, date: e.date }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.result.localeCompare(b.result) || a.orcid.localeCompare(b.orcid));
const reviews = data.reviews || [], comments = data.comments || [];
const discussions = (data.qcomments || []).map((c) => ({ question: c.question, orcid: c.orcid, date: c.date, text: c.text }))
  .sort((a, b) => a.question.localeCompare(b.question) || a.date.localeCompare(b.date));
const bad = [...Object.keys(people), ...endorsements.map((e) => e.orcid), ...reviews.map((v) => v.orcid), ...comments.map((c) => c.orcid), ...discussions.map((c) => c.orcid)].filter((id) => !orcidValid(id));
if (bad.length) { console.error(`Invalid ORCID iDs from the server: ${[...new Set(bad)].join(', ')}`); process.exit(1); }

const file = 'data/endorsements.yaml';
const before = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) || {} : {};
const header = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('#')).join('\n') + '\n' : '';
const doc = new YAML.Document(discussions.length ? { people, endorsements, discussions } : { people, endorsements });
for (const p of doc.contents.get('people').items) p.value.flow = true;
for (const e of doc.contents.get('endorsements').items) e.flow = true;
const n0 = (before.endorsements || []).length;
console.log(`endorsements: ${n0} → ${endorsements.length} (${Object.keys(people).length} people); ${discussions.length} comments on questions`);
if (!dry) fs.writeFileSync(file, header + doc.toString({ lineWidth: 0 }));

// ---- review votes and comments ---------------------------------------------------
// the open items take the server's votes and comments (the server is authoritative
// while an item is open); decided items keep theirs
{
  const q = readQueue();
  let changed = 0;
  for (const node of q.contents.items) {
    if (node.get('status') !== 'pending') continue;
    const id = node.get('id');
    const before = JSON.stringify([node.get('votes')?.toJSON?.() || [], node.get('comments')?.toJSON?.() || []]);
    const votes = reviews.filter((v) => v.item === id).map((v) => ({ orcid: v.orcid, verdict: v.verdict, date: v.date }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.orcid.localeCompare(b.orcid));
    const cs = comments.filter((c) => c.item === id).map((c) => ({ orcid: c.orcid, date: c.date, text: c.text }));
    if (JSON.stringify([votes, cs]) === before) continue;
    changed++;
    for (const [k, v] of [['votes', votes], ['comments', cs]]) {
      if (v.length) node.set(k, q.createNode(v)); else node.delete(k);
      if (k === 'votes' && v.length) for (const x of node.get(k).items) x.flow = true;
    }
  }
  console.log(`review: ${reviews.length} votes and ${comments.length} comments on the server; ${changed} item${changed === 1 ? '' : 's'} of data/review.yaml updated`);
  if (!dry && changed) writeQueue(q);
}

// ---- comments, error reports and suggestions ---------------------------------------
const known = new Set(['inbox', 'done'].flatMap((d) => (fs.existsSync(`feedback/${d}`) ? fs.readdirSync(`feedback/${d}`) : [])));
const fresh = (data.feedback || []).filter((f) => f?.id && /^[\w.:-]+$/.test(f.id) && !known.has(`${f.id}.json`));
for (const f of fresh) {
  console.log(`  new ${f.kind} on ${f.target?.type} ${f.target?.id || ''} by ${f.author?.name} (${f.author?.orcid})`);
  if (!dry) {
    fs.mkdirSync('feedback/inbox', { recursive: true });
    fs.writeFileSync(path.join('feedback/inbox', `${f.id}.json`), JSON.stringify(f, null, 2) + '\n');
  }
}
// the facts of new suggestions go to the review queue (pending result items): researchers
// vote on them on the review page, and `scripts/review.mjs apply` or `accept` enters them
const contributed = fresh.filter((f) => f.kind === 'suggestion').flatMap((f) => (f.facts || []).map((x, n) => {
  const result = x.type === 'property' ? { type: 'property', statement: x.statement, property: x.property, value: !!x.value }
    : { type: x.type, from: x.from, to: x.to, over: x.over };
  return Object.fromEntries(Object.entries({
    id: `contrib-${f.id.replace(/[^\w-]/g, '').slice(-24)}-${n + 1}`, kind: 'result', status: 'pending', date: String(f.date).slice(0, 10),
    origin: 'contributed', result, ref: x.source?.ref, loc: x.source?.loc, citation: x.source?.citation, argument: x.justification,
    contributor: { orcid: f.author?.orcid, name: f.author?.name }, contribution: f.id,
    reasons: ['contributed by a researcher: check the source before accepting'],
  }).filter(([, v]) => v !== undefined && v !== ''));
}));
if (contributed.length) console.log(`  ${contributed.length} contributed fact${contributed.length === 1 ? '' : 's'} for the review queue`);
if (!dry && contributed.length) console.log(`review: ${addToQueue(contributed)} contributed facts added to data/review.yaml`);
console.log(`feedback: ${fresh.length} new item${fresh.length === 1 ? '' : 's'}${fresh.length ? ' in feedback/inbox/' : ''}${dry ? ' (dry run: nothing written)' : ''}`);
if (!dry) console.log('Next: node scripts/review.mjs apply [--dry-run] (carries out the votes), npm run check (endorsements of edited results are reported), npm run build, then commit data/endorsements.yaml and data/review.yaml.');
