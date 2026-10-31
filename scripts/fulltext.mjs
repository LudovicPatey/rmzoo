// Local full-text cache of the papers in data/references (git-ignored).
//
//   node scripts/fulltext.mjs [--zotero] [--download] [--retry] [--only k1,k2] [--status]
//
//   --zotero    extract the PDFs of your Zotero library (~/Zotero, or $ZOTERO_DIR)
//               whose title matches a reference
//   --download  fetch missing papers: the arXiv PDF when the reference has an
//               arXiv id, otherwise an open-access PDF found via OpenAlex (DOI)
//   --retry     also retry papers whose download failed before
//   --only      restrict to these reference keys
//   --status    (always done) record in data/references/*.yaml how each cached
//               paper was read: read: pdf-zotero | pdf-arxiv | pdf-oa
//
// Layout of cache/fulltext/:
//   <key>.txt     text (pdftotext -layout), what the extraction scripts read
//   <key>.pdf     downloaded PDF (Zotero PDFs stay in Zotero)
//   index.json    { key: { source: zotero|arxiv|oa, url?, zotero?, date } }
//   failed.json   { key: { reason, date } }   — skipped unless --retry
// Needs `pdftotext` (poppler) and, for --zotero, `sqlite3`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const DIR = 'cache/fulltext';
fs.mkdirSync(DIR, { recursive: true });
const readJSON = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
const index = readJSON(DIR + '/index.json');
const failed = readJSON(DIR + '/failed.json');
const save = () => {
  fs.writeFileSync(DIR + '/index.json', JSON.stringify(index, null, 1));
  fs.writeFileSync(DIR + '/failed.json', JSON.stringify(failed, null, 1));
};
const today = new Date().toISOString().slice(0, 10);
const okText = (f) => fs.existsSync(f) && fs.statSync(f).size > 2000;
const toText = (pdf, txt) => {
  try { execFileSync('pdftotext', ['-layout', pdf, txt], { stdio: 'ignore', timeout: 120000 }); } catch { /* checked below */ }
  return okText(txt);
};

const refDocs = fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml'))
  .map((f) => ['data/references/' + f, YAML.parseDocument(fs.readFileSync('data/references/' + f, 'utf8'))]);
const refs = refDocs.flatMap(([, d]) => d.contents.items.map((pair) => ({ key: pair.key.value, pair, r: pair.value.toJSON() })))
  .filter((e) => !only || only.has(e.key));

// ---- title matching (TeX- and unicode-tolerant) ----
const sub = { '²': '2', '³': '3', '⁰': '0', '¹': '1', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', 'ω': ' omega ', 'Σ': ' sigma ', '∑': ' sigma ', 'Π': ' pi ', 'Δ': ' delta ' };
const STOP = new Set(['the', 'of', 'in', 'and', 'for', 'an', 'on']);
const words = (t) => String(t || '').replace(/[²³⁰¹₀₁₂₃₄ωΣ∑ΠΔ]/g, (c) => sub[c]).replace(/\\(mathsf|mathrm|mathbf|text|mathit)/g, ' ')
  .replace(/\\(Sigma|Pi|Delta|omega)/g, (m, x) => ' ' + x.toLowerCase() + ' ').toLowerCase().normalize('NFKD')
  .replace(/\\[a-z]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1 && !STOP.has(w));
const nt = (t) => words(t).join('');

// ---- Zotero ----
if (flag('--zotero')) {
  const Z = process.env.ZOTERO_DIR || path.join(os.homedir(), 'Zotero');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-'));
  fs.copyFileSync(Z + '/zotero.sqlite', tmp + '/z.sqlite'); // Zotero locks its database while running
  const q = `SELECT ai.key, att.path,
    (SELECT v.value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID AND f.fieldName='title' JOIN itemDataValues v ON v.valueID=d.valueID WHERE d.itemID=att.parentItemID)
    FROM itemAttachments att JOIN items ai ON ai.itemID=att.itemID WHERE att.contentType='application/pdf' AND att.path LIKE 'storage:%';`;
  const items = execFileSync('sqlite3', ['-separator', '\t', tmp + '/z.sqlite', q], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n').map((l) => l.split('\t')).filter((p) => p.length >= 3 && p[2])
    .map(([key, p, title]) => ({ key, file: path.join(Z, 'storage', key, p.slice(8)), n: nt(title), w: new Set(words(title)) }))
    .filter((z) => fs.existsSync(z.file));
  fs.rmSync(tmp, { recursive: true });
  // pass 1: exact (or long common prefix) titles, which reserve the Zotero item;
  // pass 2: ≥80% word overlap with a not yet reserved item
  const exact = (t, z) => z.n.length > 12 && (z.n === t || (t.length > 20 && z.n.length > 20 && (z.n.startsWith(t.slice(0, 35)) || t.startsWith(z.n.slice(0, 35)))));
  const sim = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(a.size, b.size); };
  const match = new Map(), used = new Set();
  for (const e of refs) { const t = nt(e.r.title); const z = items.find((z) => exact(t, z)); if (z) { match.set(e.key, z); used.add(z); } }
  for (const e of refs) {
    if (match.has(e.key)) continue;
    const w = new Set(words(e.r.title));
    const z = w.size >= 4 && items.find((z) => !used.has(z) && sim(w, z.w) >= 0.8);
    if (z) { match.set(e.key, z); used.add(z); }
  }
  let n = 0;
  for (const [key, z] of match) {
    if (index[key]?.source === 'zotero' && index[key].zotero === z.key && okText(`${DIR}/${key}.txt`)) continue;
    if (toText(z.file, `${DIR}/${key}.txt`)) {
      if (fs.existsSync(`${DIR}/${key}.pdf`)) fs.rmSync(`${DIR}/${key}.pdf`); // the Zotero copy supersedes a download
      index[key] = { source: 'zotero', zotero: z.key, date: today }; delete failed[key]; n++;
    }
  }
  save();
  console.log(`Zotero: ${match.size} references matched, ${n} texts extracted`);
}

// ---- downloads ----
if (flag('--download')) {
  const UA = { 'User-Agent': 'rm-zoo full-text cache (https://github.com/LudovicPatey/rmzoo)' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ok = 0, ko = 0;
  for (const e of refs) {
    if (index[e.key] && okText(`${DIR}/${e.key}.txt`)) continue;
    if (failed[e.key] && !flag('--retry')) continue;
    let url = null, source = null;
    try {
      if (e.r.arxiv) { url = `https://arxiv.org/pdf/${e.r.arxiv}`; source = 'arxiv'; }
      else if (e.r.doi) {
        const w = await (await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(e.r.doi)}`, { headers: UA })).json();
        const loc = [w.best_oa_location, ...(w.locations || [])].find((l) => l?.pdf_url);
        if (loc) { url = loc.pdf_url; source = 'oa'; }
      }
      if (!url) { failed[e.key] = { reason: e.r.doi ? 'no open-access PDF' : 'no arXiv id or DOI', date: today }; ko++; continue; }
      const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(90000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.subarray(0, 5).toString().startsWith('%PDF')) throw new Error(`not a PDF (HTTP ${res.status})`);
      fs.writeFileSync(`${DIR}/${e.key}.pdf`, buf);
      if (!toText(`${DIR}/${e.key}.pdf`, `${DIR}/${e.key}.txt`)) throw new Error('no text layer');
      index[e.key] = { source, url, date: today }; delete failed[e.key]; ok++;
    } catch (err) {
      failed[e.key] = { reason: String(err.message || err).slice(0, 120), url, date: today }; ko++;
    }
    if ((ok + ko) % 10 === 0) save();
    await sleep(source === 'arxiv' ? 3000 : 500); // arXiv asks for one request every 3 s
  }
  save();
  console.log(`downloads: ${ok} new texts, ${ko} failed`);
}

// ---- reading status ----
const STATUS = { zotero: 'pdf-zotero', arxiv: 'pdf-arxiv', oa: 'pdf-oa' };
const counts = {};
for (const e of refs) {
  const c = index[e.key];
  if (c && okText(`${DIR}/${e.key}.txt`)) e.pair.value.set('read', STATUS[c.source]);
  const st = e.pair.value.get('read') || 'not read';
  counts[st] = (counts[st] || 0) + 1;
}
for (const [f, d] of refDocs) fs.writeFileSync(f, d.toString({ lineWidth: 0 }));
console.log('reading status:', counts, `| cache: ${Object.keys(index).length} texts, ${Object.keys(failed).length} failed`);
