// Download the endorsements and the comments written on the live instance
// (the PHP server in site/api/, docs/ENDORSEMENTS.md) into the repository:
//   - data/endorsements.yaml is replaced by the server's state (the server is
//     authoritative for endorsements); review `git diff` and commit;
//   - each new comment or error report becomes feedback/inbox/<id>.json
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
const bad = [...Object.keys(people), ...endorsements.map((e) => e.orcid)].filter((id) => !orcidValid(id));
if (bad.length) { console.error(`Invalid ORCID iDs from the server: ${[...new Set(bad)].join(', ')}`); process.exit(1); }

const file = 'data/endorsements.yaml';
const before = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) || {} : {};
const header = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('#')).join('\n') + '\n' : '';
const doc = new YAML.Document({ people, endorsements });
for (const p of doc.contents.get('people').items) p.value.flow = true;
for (const e of doc.contents.get('endorsements').items) e.flow = true;
const n0 = (before.endorsements || []).length;
console.log(`endorsements: ${n0} → ${endorsements.length} (${Object.keys(people).length} people)`);
if (!dry) fs.writeFileSync(file, header + doc.toString({ lineWidth: 0 }));

// ---- comments and error reports --------------------------------------------------
const known = new Set(['inbox', 'done'].flatMap((d) => (fs.existsSync(`feedback/${d}`) ? fs.readdirSync(`feedback/${d}`) : [])));
const fresh = (data.feedback || []).filter((f) => f?.id && /^[\w.:-]+$/.test(f.id) && !known.has(`${f.id}.json`));
for (const f of fresh) {
  console.log(`  new ${f.kind} on ${f.target?.type} ${f.target?.id || ''} by ${f.author?.name} (${f.author?.orcid})`);
  if (!dry) {
    fs.mkdirSync('feedback/inbox', { recursive: true });
    fs.writeFileSync(path.join('feedback/inbox', `${f.id}.json`), JSON.stringify(f, null, 2) + '\n');
  }
}
console.log(`feedback: ${fresh.length} new item${fresh.length === 1 ? '' : 's'}${fresh.length ? ' in feedback/inbox/' : ''}${dry ? ' (dry run: nothing written)' : ''}`);
if (!dry) console.log('Next: npm run check (endorsements of edited results are reported), npm run build, then commit data/endorsements.yaml.');
