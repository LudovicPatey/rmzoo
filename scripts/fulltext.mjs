// Local full-text cache of the papers in data/references (git-ignored).
//
//   node scripts/fulltext.mjs [--zotero] [--download] [--author-pages] [--retry] [--only k1,k2] [--status]
//
//   --zotero    extract the PDFs of your Zotero library (~/Zotero, or $ZOTERO_DIR)
//               whose title matches a reference
//   --download  fetch missing papers from open sources: arXiv (by id, or by exact
//               title and author), OpenAlex, Crossref full-text links, Unpaywall
//               (when UNPAYWALL_EMAIL is set) and Semantic Scholar
//   --author-pages  look for missing papers on the publication pages listed in
//               data/author-pages.yaml (AUTHOR_PAGES_DELAY=s waits between requests)
//   --retry     also retry papers whose download failed before
//   --only      restrict to these reference keys
//   --status    (always done) record in data/references/*.yaml how each cached
//               paper was read: read: pdf-zotero | pdf-arxiv | pdf-oa | pdf-author
//               (pdf-author: uploaded by a researcher, scripts/uploads-sync.mjs)
//
// Layout of cache/fulltext/:
//   <key>.txt     text (pdftotext -layout), what the extraction scripts read
//   <key>.pdf     the PDF (downloaded, or copied from Zotero)
//   index.json    { key: { source: zotero|arxiv|oa|upload, url?, via?, zotero?, upload?, ocr?, date } }
//   failed.json   { key: { reason, date } }   — skipped unless --retry
// Scanned PDFs (no text layer) are read by OCR: each page rendered at 300 dpi
// (pdftoppm) and read by Tesseract; the index marks them `ocr: true` (formulas
// and sub/superscripts are approximate, the AI reader is told so).
// Needs `pdftotext` and `pdftoppm` (poppler), `tesseract` for scans, and, for
// --zotero, `sqlite3`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { acquireLock } from './lib/lock.mjs';
import { cli } from './lib/cli.mjs';
import { surname } from '../site/js/names.js';
cli('node scripts/fulltext.mjs [--zotero] [--download] [--author-pages] [--retry] [--only k1,k2] [--status]', { '--zotero': 0, '--download': 0, '--author-pages': 0, '--retry': 0, '--only': 1, '--status': 0 });
acquireLock('fulltext.mjs');

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
const EXCLUDE = fs.existsSync('data/fulltext-exclude.yaml') ? YAML.parse(fs.readFileSync('data/fulltext-exclude.yaml', 'utf8')) || {} : {};
const okText = (f) => fs.existsSync(f) && fs.statSync(f).size > 2000;
// Text of a PDF: its text layer, else OCR. Returns false (and leaves no text) when
// neither gives a usable text, 'ocr' when the text comes from OCR, true otherwise.
let tesseract;
const toText = (pdf, txt) => {
  try { execFileSync('pdftotext', ['-layout', pdf, txt], { stdio: 'ignore', timeout: 120000 }); } catch { /* checked below */ }
  if (okText(txt)) return true;
  tesseract ??= (() => { try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (tesseract && ocr(pdf, txt)) return 'ocr';
  fs.rmSync(txt, { force: true }); // no empty text left behind
  if (!tesseract) console.warn(`${path.basename(pdf)}: no text layer (scanned?); install tesseract to read it by OCR`);
  return false;
};
function ocr(pdf, txt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-ocr-'));
  try {
    console.log(`${path.basename(pdf)}: no text layer, reading by OCR…`);
    execFileSync('pdftoppm', ['-r', '300', '-gray', '-png', pdf, path.join(tmp, 'p')], { stdio: 'ignore', timeout: 900000 });
    const pages = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
    const text = pages.map((p) => {
      try { return execFileSync('tesseract', [path.join(tmp, p), '-', '-l', 'eng', '--psm', '1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000 }); } catch { return ''; }
    });
    fs.writeFileSync(txt, text.join('\f'));
    return okText(txt);
  } catch { return false; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

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
// exact-comparison key: all letters and digits, keeping one-character tokens ("SRT 2 2" = "$\mathsf{SRT}^2_2$")
const nt = (t) => String(t || '').replace(/\s*\((\w+ )?edition\)\s*$/i, '').replace(/[²³⁰¹₀₁₂₃₄ωΣ∑ΠΔ]/g, (c) => sub[c]).replace(/\\(Sigma|Pi|Delta|omega)/g, (m, x) => ' ' + x.toLowerCase() + ' ')
  .replace(/\\[a-zA-Z]+/g, ' ').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

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
  // pass 1: identical titles; pass 2: one title extends the other (a subtitle);
  // pass 3: ≥80% word overlap. Each Zotero item serves one reference:
  // "On the strength of Ramsey's theorem" must not take the PDF of
  // "On the strength of Ramsey's theorem for pairs".
  // one title is the other followed by a subtitle (both long enough to be specific)
  const prefix = (t, z) => Math.min(t.length, z.n.length) >= 30 && (z.n.startsWith(t) || t.startsWith(z.n));
  const sim = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(a.size, b.size); };
  const match = new Map(), used = new Set();
  for (const e of refs) { const t = nt(e.r.title); const z = t.length > 12 && items.find((z) => !used.has(z) && z.n === t); if (z) { match.set(e.key, z); used.add(z); } }
  for (const e of refs) { if (match.has(e.key)) continue; const t = nt(e.r.title); const z = items.find((z) => !used.has(z) && prefix(t, z)); if (z) { match.set(e.key, z); used.add(z); } }
  for (const e of refs) {
    if (match.has(e.key)) continue;
    const w = new Set(words(e.r.title));
    const z = w.size >= 4 && items.find((z) => !used.has(z) && sim(w, z.w) >= 0.8);
    if (z) { match.set(e.key, z); used.add(z); }
  }
  // texts taken from Zotero items that no longer match are dropped
  let dropped = 0;
  for (const [key, c] of Object.entries(index)) {
    if (c.source !== 'zotero' || (only && !only.has(key)) || match.get(key)?.key === c.zotero) continue;
    fs.rmSync(`${DIR}/${key}.txt`, { force: true });
    delete index[key]; dropped++;
    const e = refs.find((x) => x.key === key);
    if (e && e.pair.value.get('read') === 'pdf-zotero') e.pair.value.delete('read');
    console.log(`dropped ${key} (Zotero item ${c.zotero} no longer matches)`);
  }
  // known wrong sources (data/fulltext-exclude.yaml)
  for (const [key, x] of Object.entries(EXCLUDE)) if (x.zotero && match.get(key)?.key === x.zotero) {
    match.delete(key);
    if (index[key]?.zotero === x.zotero) { fs.rmSync(`${DIR}/${key}.txt`, { force: true }); fs.rmSync(`${DIR}/${key}.pdf`, { force: true }); delete index[key]; dropped++; }
  }
  let n = 0;
  for (const [key, z] of match) {
    if (index[key]?.source === 'zotero' && index[key].zotero === z.key && okText(`${DIR}/${key}.txt`)) {
      // the PDF is copied into the cache, so that nothing depends on Zotero afterwards
      if (!fs.existsSync(`${DIR}/${key}.pdf`)) fs.copyFileSync(z.file, `${DIR}/${key}.pdf`);
      continue;
    }
    const got = toText(z.file, `${DIR}/${key}.txt`);
    if (got) {
      fs.copyFileSync(z.file, `${DIR}/${key}.pdf`); // the Zotero copy supersedes a download
      index[key] = { source: 'zotero', zotero: z.key, ...(got === 'ocr' ? { ocr: true } : {}), date: today }; delete failed[key]; n++;
    }
  }
  save();
  console.log(`Zotero: ${match.size} references matched, ${n} texts extracted, ${dropped} dropped`);
}

// ---- downloads ----
// Legitimate open sources only, tried in order until one gives a PDF:
//   1. arXiv, when the reference has an arXiv id;
//   2. OpenAlex open-access locations (by DOI);
//   3. Crossref full-text links (by DOI; paywalled links answer with HTML and are skipped);
//   4. Unpaywall (by DOI), when UNPAYWALL_EMAIL is set (its API requires an email address);
//   5. Semantic Scholar open-access PDF (by DOI, else exact title);
//   6. arXiv searched by exact title with a matching author surname (the id is then recorded
//      in the reference).
// Sites behind bot protection (e.g. Project Euclid) are not worked around: those papers are
// downloaded by hand. Shadow libraries are never used.
const UA = { 'User-Agent': 'rm-zoo full-text cache (https://github.com/LudovicPatey/rmzoo)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPdf = async (url) => {
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(90000) });
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.subarray(0, 5).toString().startsWith('%PDF') ? buf : null;
};
const surnames = (r) => (r.authors || []).map((a) => nt(surname(a).split(/\s+/).pop()));
const candidates = async (e) => {
  const out = [];
  const doi = e.r.doi;
  if (e.r.arxiv) out.push({ url: `https://arxiv.org/pdf/${e.r.arxiv}`, source: 'arxiv' });
  if (doi) {
    try {
      const w = await (await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, { headers: UA })).json();
      for (const l of [w.best_oa_location, ...(w.locations || [])]) if (l?.pdf_url) out.push({ url: l.pdf_url, source: 'oa' });
    } catch { /* next source */ }
    try {
      const m = (await (await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: UA })).json()).message || {};
      for (const l of m.link || []) if (l.URL && !/projecteuclid\.org/.test(l.URL)) out.push({ url: l.URL, source: 'oa' });
    } catch { /* next source */ }
    if (process.env.UNPAYWALL_EMAIL) {
      try {
        const u = await (await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(process.env.UNPAYWALL_EMAIL)}`, { headers: UA })).json();
        for (const l of u.oa_locations || []) if (l.url_for_pdf) out.push({ url: l.url_for_pdf, source: 'oa' });
      } catch { /* next source */ }
    }
  }
  const q = doi ? `paper/DOI:${encodeURIComponent(doi)}?fields=title,openAccessPdf`
    : `paper/search/match?query=${encodeURIComponent(String(e.r.title).replace(/\$[^$]*\$/g, ' '))}&fields=title,openAccessPdf`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://api.semanticscholar.org/graph/v1/' + q, { headers: UA });
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
    if (r.ok) {
      const j = await r.json();
      const p = j.data ? j.data[0] : j;
      if (p?.openAccessPdf?.url && (doi || nt(p.title) === nt(e.r.title))) out.push({ url: p.openAccessPdf.url, source: 'oa' });
    }
    break;
  }
  await sleep(1100);
  if (!e.r.arxiv) { // arXiv by exact title and an author surname
    try {
      const title = String(e.r.title).replace(/\$[^$]*\$/g, ' ').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
      const xml = await (await fetch(`http://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${title}"`)}&max_results=5`, { headers: UA })).text();
      for (const entry of xml.split('<entry>').slice(1)) {
        const id = (entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<v]+)(v\d+)?<\/id>/) || [])[1];
        const t = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
        const names = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => nt(m[1].split(' ').pop()));
        if (id && nt(t) === nt(e.r.title) && surnames(e.r).some((s) => names.includes(s))) {
          out.push({ url: `https://arxiv.org/pdf/${id}`, source: 'arxiv', arxiv: id });
          break;
        }
      }
      await sleep(3000); // arXiv asks for one request every 3 s
    } catch { /* none */ }
  }
  return out.filter((c, i) => out.findIndex((d) => d.url === c.url) === i && EXCLUDE[e.key]?.url !== c.url);
};
if (flag('--download')) {
  let ok = 0, ko = 0;
  for (const e of refs) {
    if (index[e.key] && okText(`${DIR}/${e.key}.txt`)) continue;
    if (failed[e.key] && !flag('--retry')) continue;
    let tried = [];
    try {
      const cands = await candidates(e);
      let got = null;
      for (const c of cands) {
        let buf = null;
        try { buf = await getPdf(c.url); } catch { /* next */ }
        tried.push(c.url);
        if (!buf) continue;
        fs.writeFileSync(`${DIR}/${e.key}.pdf`, buf);
        const t = toText(`${DIR}/${e.key}.pdf`, `${DIR}/${e.key}.txt`);
        if (!t) continue;
        got = { ...c, ocr: t === 'ocr' };
        break;
      }
      if (!got) { failed[e.key] = { reason: cands.length ? 'no PDF at the open-access links' : (e.r.doi ? 'no open-access PDF' : 'no arXiv id or DOI'), date: today }; ko++; }
      else {
        if (got.arxiv) e.pair.value.set('arxiv', got.arxiv);
        index[e.key] = { source: got.source, url: got.url, ...(got.ocr ? { ocr: true } : {}), date: today }; delete failed[e.key]; ok++;
      }
    } catch (err) {
      failed[e.key] = { reason: String(err.message || err).slice(0, 120), tried, date: today }; ko++;
    }
    if ((ok + ko) % 10 === 0) save();
    await sleep(500);
  }
  save();
  console.log(`downloads: ${ok} new texts, ${ko} failed`);
}

// ---- authors' web pages (data/author-pages.yaml) ----
// Each listed publication page is read; its links to PDF/PostScript files (and to one page per
// paper on the same site) are matched against the missing references of that author, in any
// position of the author list. A file is kept only if the reference's title is at the top of
// its first page, and a file serves one reference.
if (flag('--author-pages')) {
  const pages = fs.existsSync('data/author-pages.yaml') ? YAML.parse(fs.readFileSync('data/author-pages.yaml', 'utf8')) || [] : [];
  const curl = (u) => {
    if (process.env.AUTHOR_PAGES_DELAY) execFileSync('sleep', [process.env.AUTHOR_PAGES_DELAY]);
    const buf = execFileSync('curl', ['-sL', '-m', '40', '-A', UA['User-Agent'], '-w', '\n%{http_code}', u], { maxBuffer: 1 << 28 });
    const cut = buf.lastIndexOf(10);
    return { status: Number(buf.subarray(cut + 1).toString()), buf: buf.subarray(0, cut) };
  };
  const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ');
  const score = (title, text) => { const t = words(title), x = new Set(words(text)); return t.length ? t.filter((w) => x.has(w)).length / t.length : 0; };
  const anchors = (html, base) => {
    const ms = [...html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    return ms.flatMap((m, i) => {
      let href;
      try { href = new URL(m[1].trim(), base).href; } catch { return []; }
      const prevEnd = i ? ms[i - 1].index + ms[i - 1][0].length : 0;
      const nextStart = i + 1 < ms.length ? ms[i + 1].index : html.length;
      const ctx = `${strip(html.slice(Math.max(prevEnd, m.index - 400), m.index))} ${strip(m[2])} ${strip(html.slice(m.index + m[0].length, Math.min(nextStart, m.index + m[0].length + 200)))}`;
      return [{ href, isDoc: /\.(pdf|ps|ps\.gz)(\?|#|$)/i.test(href), ctx }];
    });
  };
  const used = new Set(Object.values(index).map((c) => c.url).filter(Boolean));
  const allRefs = refDocs.flatMap(([, d]) => d.contents.items.map((pair) => ({ key: pair.key.value, r: pair.value.toJSON() })));
  const cached = (k) => index[k] && okText(`${DIR}/${k}.txt`);
  // a version of the paper (conference/journal, linked by `version`) already cached: skip it,
  // so that one version's text is not filed under the other
  const otherVersion = (e) => allRefs.some((x) => x.key !== e.key && (x.r.version === e.key || e.r.version === x.key) && cached(x.key));
  // Is this first page the paper's? Its title must be one, two or three consecutive lines at
  // the top (or, for a title of six words or more, nearly all its words in the first 600
  // characters), and no longer title of another reference may appear there (the file would
  // be that paper: "Subsystems of second order arithmetic" inside "Countable valued fields
  // in weak subsystems of second order arithmetic").
  const isPaper = (e, first) => {
    const lines = first.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
    const t = nt(e.r.title);
    const exact = lines.some((l, i) => [1, 2, 3].some((w) => nt(lines.slice(i, i + w).join(' ')) === t));
    const flat = first.replace(/\s+/g, ' ').slice(0, 600);
    const loose = words(e.r.title).length >= 6 && score(e.r.title, flat) >= 0.8;
    if (!exact && !loose) return false;
    const head = nt(flat);
    return !allRefs.some((x) => x.key !== e.key && nt(x.r.title).length > t.length && nt(x.r.title).includes(t) && head.includes(nt(x.r.title)));
  };
  let n = 0;
  for (const { author, url, base } of pages) {
    let html;
    try { const r = curl(url); if (!r.status || r.status >= 400) throw new Error(`HTTP ${r.status}`); html = r.buf.toString('latin1'); }
    catch (err) { console.log(`${author}: ${url} unreachable (${String(err.message).split('\n')[0]})`); continue; }
    const all = anchors(html, base || url);
    const links = all.filter((a) => a.isDoc);
    const missing = refs.filter((e) => (e.r.authors || []).some((a) => String(a).includes(author)) && !(index[e.key] && okText(`${DIR}/${e.key}.txt`)));
    const host = new URL(url).host;
    for (const e of missing) for (const a of all.filter((a) => !a.isDoc && new URL(a.href).host === host && score(e.r.title, a.ctx) >= 0.75).slice(0, 2)) {
      try { const h = curl(a.href).buf.toString('latin1'); links.push(...anchors(h, a.href).filter((x) => x.isDoc).map((x) => ({ ...x, ctx: `${strip(h).slice(0, 600)} ${x.ctx}` }))); } catch { /* skip */ }
    }
    for (const e of missing) {
      if (words(e.r.title).length < 3 || otherVersion(e)) continue; // a short title cannot be checked on the first page
      const cands = links.map((l) => ({ l, s: score(e.r.title, l.ctx) })).filter((c) => c.s >= 0.6 && !used.has(c.l.href) && EXCLUDE[e.key]?.url !== c.l.href)
        .sort((a, b) => b.s - a.s).filter((c, i, a) => a.findIndex((d) => d.l.href === c.l.href) === i).slice(0, 3);
      for (const { l } of cands) {
        try {
          let buf = curl(l.href).buf;
          if (buf[0] === 0x1f && buf[1] === 0x8b) buf = (await import('node:zlib')).gunzipSync(buf);
          if (buf.subarray(0, 2).toString() === '%!') { // PostScript
            fs.writeFileSync(`${DIR}/${e.key}.ps`, buf);
            execFileSync('ps2pdf', [`${DIR}/${e.key}.ps`, `${DIR}/${e.key}.pdf`], { stdio: 'ignore' });
            fs.rmSync(`${DIR}/${e.key}.ps`);
            buf = fs.readFileSync(`${DIR}/${e.key}.pdf`);
          }
          if (!buf.subarray(0, 5).toString().startsWith('%PDF')) continue;
          fs.writeFileSync(`${DIR}/${e.key}.pdf`, buf);
          const first = execFileSync('pdftotext', ['-l', '1', `${DIR}/${e.key}.pdf`, '-'], { encoding: 'utf8' });
          if (!isPaper(e, first)) { fs.rmSync(`${DIR}/${e.key}.pdf`); continue; }
          const t = toText(`${DIR}/${e.key}.pdf`, `${DIR}/${e.key}.txt`);
          if (!t) continue;
          index[e.key] = { source: 'oa', url: l.href, via: 'author page', ...(t === 'ocr' ? { ocr: true } : {}), date: today };
          delete failed[e.key]; used.add(l.href); n++;
          console.log(`${e.key}: ${l.href}`);
          break;
        } catch { /* next candidate */ }
      }
    }
    save();
  }
  console.log(`authors' pages: ${n} new texts`);
}

// ---- reading status ----
const STATUS = { zotero: 'pdf-zotero', arxiv: 'pdf-arxiv', oa: 'pdf-oa', upload: 'pdf-author' };
const counts = {};
for (const e of refs) {
  const c = index[e.key];
  if (c && okText(`${DIR}/${e.key}.txt`)) e.pair.value.set('read', STATUS[c.source]);
  const st = e.pair.value.get('read') || 'not read';
  counts[st] = (counts[st] || 0) + 1;
}
for (const [f, d] of refDocs) fs.writeFileSync(f, d.toString({ lineWidth: 0 }));
console.log('reading status:', counts, `| cache: ${Object.keys(index).length} texts, ${Object.keys(failed).length} failed`);
