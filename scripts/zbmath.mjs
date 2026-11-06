// Map the references to zbMATH Open documents, and their authors to zbMATH author
// profiles (with their ORCID iDs when the profiles list one).
//
//   node scripts/zbmath.mjs [--only k1,k2] [--retry] [--verify] [--dry-run]
//
// For each reference without a `zbmath` field:
//   1. the zbMATH document with its DOI, else
//   2. a zbMATH search by title words, an author's surname and the year (±1): a document is
//      accepted only if its title is the reference's title (letters and digits compared)
//      and one of its authors has a surname of the reference.
// The reference then gets `zbmath: <Zbl identifier>` and `zbmathAuthors: [author codes]`
// (in the order of zbMATH; an author without a code is left out). The profiles of new author
// codes are read into data/authors.yaml: code → {name, orcid?}. References not found are
// remembered in cache/zbmath-failed.json and skipped unless --retry.
// A document found by DOI must also have the reference's title (equal letters, or 60% of
// the words in common): otherwise the DOI of the reference is probably wrong, and it is
// reported (cache/zbmath-doi-mismatch.json). --verify re-reads the zbMATH document of every
// mapped reference and removes the mappings whose titles differ (then rerun without it).
// zbMATH identifiers are Zbl numbers, or arXiv:<id> for the preprints zbMATH indexes.
// The viewer uses the ORCID iDs to know the papers of a signed-in researcher (the bell of
// docs/UPLOADS.md) without matching names.
import fs from 'node:fs';
import YAML from 'yaml';
import { cli } from './lib/cli.mjs';
import { acquireLock } from './lib/lock.mjs';

const args = cli('node scripts/zbmath.mjs [--only k1,k2] [--retry] [--verify] [--dry-run]', { '--only': 1, '--retry': 0, '--verify': 0, '--dry-run': 0 });
const only = args.has('--only') ? new Set(args.get('--only').split(',')) : null;
const dry = args.has('--dry-run');
if (!dry) acquireLock('zbmath.mjs');

const API = 'https://api.zbmath.org/v1';
const UA = { headers: { 'User-Agent': 'rm-zoo (https://github.com/LudovicPatey/rmzoo)', Accept: 'application/json' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, UA).catch(() => null);
    await sleep(1100); // about one request per second
    if (r?.status === 429 || (r && r.status >= 500)) { await sleep(5000 * (i + 1)); continue; }
    if (!r || !r.ok) return null;
    return r.json().catch(() => null);
  }
  return null;
};
// letters and digits only, TeX and accents removed: "$\mathsf{WKL}_0$" = "WKL0"
const nt = (t) => String(t || '').replace(/\\(mathsf|mathrm|mathbf|text|textsf|mathit|mathcal|mathbb)\b/g, ' ').replace(/\\([a-zA-Z]+)/g, '$1').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
const surname = (a) => { const s = String(a).trim(); return nt(s.includes(',') ? s.split(',')[0] : s.split(/\s+/).pop()); };
const words = (t) => String(t || '').replace(/\$[^$]*\$/g, ' ').replace(/\\[a-zA-Z]+/g, ' ').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 3).slice(0, 6);

const refDocs = fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml'))
  .map((f) => ['data/references/' + f, YAML.parseDocument(fs.readFileSync('data/references/' + f, 'utf8'))]);
const refs = refDocs.flatMap(([, d]) => d.contents.items.map((pair) => ({ key: pair.key.value, pair, r: pair.value.toJSON() })));
const authorsFile = 'data/authors.yaml';
const authors = fs.existsSync(authorsFile) ? YAML.parse(fs.readFileSync(authorsFile, 'utf8')) || {} : {};
const failedFile = 'cache/zbmath-failed.json';
const failed = fs.existsSync(failedFile) ? JSON.parse(fs.readFileSync(failedFile, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);

// same title: equal letters and digits, or at least 60% of the words in common (TeX, case,
// punctuation and subtitles differ between sources)
// TeX commands keep their names (\Sigma: sigma), so that "I\Sigma_2" and "ISigma_2" agree
const allWords = (t) => String(t || '').replace(/\\([a-zA-Z]+)/g, ' $1').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2);
const sameTitle = (a, b) => {
  if (nt(a) === nt(b)) return true;
  const x = new Set(allWords(a)), y = new Set(allWords(b));
  if (!x.size || !y.size) return false;
  let c = 0; for (const w of x) if (y.has(w)) c++;
  return c / Math.max(x.size, y.size) >= 0.6;
};
const mismatches = [];
const matches = (doc, r) => {
  if (!doc) return false;
  const t = doc.title?.title;
  if (nt(t) !== nt(r.title)) return false;
  const sn = new Set((r.authors || []).map(surname));
  return (doc.contributors?.authors || []).some((a) => sn.has(surname(a.name)));
};
async function find(r) {
  if (r.doi) {
    const j = await get(`${API}/document/_structured_search?page=0&results_per_page=3&DOI=${encodeURIComponent(r.doi)}`);
    const d = (j?.result || []).find((x) => (x.links || []).some((l) => l.type === 'doi' && String(l.identifier).toLowerCase() === r.doi.toLowerCase()));
    if (d && sameTitle(d.title?.title, r.title)) return d;
    if (d) mismatches.push({ key: r._key, doi: r.doi, title: r.title, zbmath: d.identifier, zbmathTitle: d.title?.title });
  }
  const w = words(r.title);
  const au = (r.authors || []).map(surname).find((s) => s.length > 2);
  if (w.length < 2 || !au || !r.year) return null;
  const q = `ti:${w.join(' ')} & au:${au} & py:${r.year - 1}-${+r.year + 1}`;
  const j = await get(`${API}/document/_search?page=0&results_per_page=10&search_string=${encodeURIComponent(q)}`);
  return (j?.result || []).find((d) => matches(d, r)) || null;
}

// --verify: the mapped references whose zbMATH document has another title lose their mapping
if (args.has('--verify')) {
  let bad = 0, n = 0;
  for (const e of refs.filter((x) => (!only || only.has(x.key)) && x.r.zbmath)) {
    const j = await get(`${API}/document/_search?page=0&results_per_page=1&search_string=${encodeURIComponent(`an:${e.r.zbmath}`)}`);
    const d = j?.result?.[0];
    n++;
    if (!d || sameTitle(d.title?.title, e.r.title)) continue;
    bad++;
    mismatches.push({ key: e.key, doi: e.r.doi, title: e.r.title, zbmath: e.r.zbmath, zbmathTitle: d.title?.title });
    console.log(`${e.key}: Zbl ${e.r.zbmath} is "${d.title?.title}" — mapping removed${e.r.doi ? ` (the DOI ${e.r.doi} is probably wrong)` : ''}`);
    if (!dry) { e.pair.value.delete('zbmath'); e.pair.value.delete('zbmathAuthors'); }
  }
  save();
  console.log(`verified ${n} mappings: ${bad} removed`);
  process.exit(0);
}

let found = 0, missed = 0, newAuthors = 0;
for (const e of refs) e.r._key = e.key;
const todo = refs.filter((e) => (!only || only.has(e.key)) && !e.r.zbmath && (args.has('--retry') || !failed[e.key]));
console.log(`${todo.length} references to map`);
for (const e of todo) {
  const d = await find(e.r);
  if (!d?.identifier) { failed[e.key] = today; missed++; continue; }
  const codes = (d.contributors?.authors || []).flatMap((a) => (a.codes || []).slice(0, 1));
  found++;
  delete failed[e.key];
  if (dry) { console.log(`${e.key}: Zbl ${d.identifier} ${codes.join(', ')}`); continue; }
  e.pair.value.set('zbmath', String(d.identifier));
  if (codes.length) e.pair.value.set('zbmathAuthors', codes);
  for (const c of codes) if (!(c in authors)) authors[c] = null; // profile read below
  if (found % 20 === 0) save();
}
// author profiles: name and ORCID iD
for (const [c, v] of Object.entries(authors)) {
  if (v) continue;
  const j = await get(`${API}/author/${encodeURIComponent(c)}`);
  const p = Array.isArray(j?.result) ? j.result[0] : j?.result;
  if (!p) { delete authors[c]; continue; }
  const orcid = (p.external_ids || []).find((x) => x.type === 'orcid')?.external_id;
  authors[c] = { name: p.name, ...(orcid ? { orcid } : {}) };
  newAuthors++;
}
save();
for (const m of mismatches) console.log(`! ${m.key}: its DOI ${m.doi} is Zbl ${m.zbmath} "${m.zbmathTitle}" (another title: the DOI is probably wrong)`);
console.log(`zbMATH: ${found} references mapped, ${missed} not found; ${newAuthors} author profiles read (${Object.values(authors).filter((a) => a?.orcid).length} of ${Object.keys(authors).length} authors with an ORCID iD)`);

function save() {
  if (dry) return;
  for (const [f, d] of refDocs) fs.writeFileSync(f, d.toString({ lineWidth: 0 }));
  const sorted = Object.fromEntries(Object.entries(authors).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(authorsFile, `# zbMATH Open author profiles of the authors of the references (scripts/zbmath.mjs):\n# code → {name, orcid}. Written by the script; references point here with zbmathAuthors.\n${YAML.stringify(sorted, { flowCollectionPadding: true })}`);
  fs.mkdirSync('cache', { recursive: true });
  fs.writeFileSync(failedFile, JSON.stringify(failed, null, 1));
  if (mismatches.length) {
    const f = 'cache/zbmath-doi-mismatch.json';
    const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
    const all = [...old.filter((x) => !mismatches.some((m) => m.key === x.key)), ...mismatches];
    fs.writeFileSync(f, JSON.stringify(all, null, 1));
  }
}
