// Download the full texts that signed-in researchers uploaded on the live instance
// (docs/UPLOADS.md) into the local, git-ignored cache:
//   - a file attached to a paper of the database becomes cache/fulltext/<key>.pdf and
//     .txt (source `upload` in cache/fulltext/index.json, reading status `read:
//     pdf-author` written by `node scripts/fulltext.mjs --status`), unless the cache
//     already has a text of that paper from another source (Zotero, arXiv, open access):
//     the upload is then only kept in cache/uploads/;
//   - a replaced file (new checksum) is downloaded again; a removed one is taken out of
//     the cache;
//   - a file about a paper that is not in the database is saved as
//     cache/uploads/<id>.pdf and listed, with its description, for the maintainer to add
//     the reference (README, "Adding a paper") and then rerun this script.
// The files are never committed nor published.
//
//   RMZOO_ADMIN_TOKEN=… node scripts/uploads-sync.mjs [--url URL] [--dry-run]
//
// The token is the admin_token of the server's api/config.php; it can also be kept in
// cache/admin-token (git-ignored).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { cli } from './lib/cli.mjs';
import { acquireLock } from './lib/lock.mjs';

const args = cli('RMZOO_ADMIN_TOKEN=… node scripts/uploads-sync.mjs [--url https://rmzoo.ludovicpatey.com] [--dry-run]',
  { '--url': 1, '--dry-run': 0 });
const url = args.get('--url', process.env.RMZOO_URL || 'https://rmzoo.ludovicpatey.com').replace(/\/$/, '');
const token = process.env.RMZOO_ADMIN_TOKEN || (fs.existsSync('cache/admin-token') ? fs.readFileSync('cache/admin-token', 'utf8').trim() : '');
if (!token) { console.error('No admin token: set RMZOO_ADMIN_TOKEN or write it to cache/admin-token.'); process.exit(1); }
const dry = args.has('--dry-run');
if (!dry) acquireLock('uploads-sync.mjs');

const auth = { headers: { Authorization: `Bearer ${token}` } };
const res = await fetch(`${url}/api/index.php?a=uploads-export`, auth);
if (!res.ok) { console.error(`${url}: ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const uploads = (await res.json()).uploads || [];

const DIR = 'cache/fulltext', UP = 'cache/uploads';
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(UP, { recursive: true });
const index = fs.existsSync(`${DIR}/index.json`) ? JSON.parse(fs.readFileSync(`${DIR}/index.json`, 'utf8')) : {};
const refs = {};
for (const f of fs.readdirSync('data/references').filter((x) => x.endsWith('.yaml'))) Object.assign(refs, YAML.parse(fs.readFileSync(`data/references/${f}`, 'utf8')));
const today = new Date().toISOString().slice(0, 10);
const okText = (f) => fs.existsSync(f) && fs.statSync(f).size > 2000;
const get = async (id) => {
  const r = await fetch(`${url}/api/index.php?a=upload-file&id=${encodeURIComponent(id)}`, auth);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || !buf.subarray(0, 5).toString().startsWith('%PDF')) throw new Error(`upload ${id}: not a PDF (HTTP ${r.status})`);
  return buf;
};

const live = new Map(uploads.map((u) => [u.id, u]));
const changed = [], kept = [], unknown = [], dropped = [], failed = [];
// removed uploads: their texts leave the cache
for (const [key, c] of Object.entries(index)) {
  if (c.source !== 'upload' || live.has(c.upload)) continue;
  dropped.push(key);
  if (!dry) { for (const x of ['pdf', 'txt']) fs.rmSync(`${DIR}/${key}.${x}`, { force: true }); delete index[key]; }
}
for (const u of uploads) {
  const mine = u.ref && index[u.ref]?.source === 'upload' && index[u.ref].upload === u.id;
  if (u.ref && refs[u.ref] && mine && index[u.ref].sha256 === u.sha256 && okText(`${DIR}/${u.ref}.txt`)) continue; // up to date
  try {
    if (u.ref && refs[u.ref]) {
      const other = index[u.ref] && !mine && okText(`${DIR}/${u.ref}.txt`);
      if (other) { // the cache already has this paper: keep the upload aside
        if (!fs.existsSync(`${UP}/${u.id}.pdf`) && !dry) fs.writeFileSync(`${UP}/${u.id}.pdf`, await get(u.id));
        kept.push(`${u.ref} (${index[u.ref].source})`);
        continue;
      }
      if (dry) { changed.push(u.ref); continue; }
      fs.writeFileSync(`${DIR}/${u.ref}.pdf`, await get(u.id));
      try { execFileSync('pdftotext', ['-layout', `${DIR}/${u.ref}.pdf`, `${DIR}/${u.ref}.txt`], { stdio: 'ignore', timeout: 120000 }); } catch { /* checked below */ }
      if (!okText(`${DIR}/${u.ref}.txt`)) {
        failed.push(`${u.ref}: no text layer (a scan?); the PDF is in ${DIR}/${u.ref}.pdf, to read by OCR (README, "Full texts of the papers")`);
        fs.rmSync(`${DIR}/${u.ref}.txt`, { force: true });
        continue;
      }
      index[u.ref] = { source: 'upload', upload: u.id, sha256: u.sha256, orcid: u.orcid, date: today };
      changed.push(u.ref);
    } else {
      if (!fs.existsSync(`${UP}/${u.id}.pdf`) && !dry) fs.writeFileSync(`${UP}/${u.id}.pdf`, await get(u.id));
      unknown.push(`${UP}/${u.id}.pdf — ${u.ref ? `unknown key ${u.ref}` : u.citation} (uploaded by ${u.name}, ${u.orcid}, ${u.date})`);
    }
  } catch (err) { failed.push(String(err.message || err)); }
}
if (!dry) {
  fs.writeFileSync(`${DIR}/index.json`, JSON.stringify(index, null, 1));
  // reading status (read: pdf-author) in data/references/ (the child inherits the lock)
  const keys = [...changed, ...dropped];
  if (keys.length) execFileSync('node', ['scripts/fulltext.mjs', '--status', '--only', keys.join(',')], { stdio: 'inherit' });
}
console.log(`${uploads.length} uploads on the server: ${changed.length} texts ${dry ? 'to import' : 'imported'}, ${dropped.length} removed, ${kept.length} kept aside (the cache already had the paper)`);
for (const k of changed) console.log(`  + ${k}`);
for (const k of dropped) console.log(`  - ${k} (upload removed)`);
for (const k of kept) console.log(`  = ${k}`);
if (unknown.length) { console.log('Papers not in the database (add the reference, then rerun):'); for (const x of unknown) console.log(`  ? ${x}`); }
for (const x of failed) console.log(`  ! ${x}`);
if (changed.length && !dry) console.log('Next: node scripts/mine/facts.mjs --only <keys>, or node scripts/ai-analyze.mjs --only <keys> (the AI reader).');
