// Publication status of preprints: finds which papers recorded as arXiv
// preprints (or without venue) have since been published.
//
//   node scripts/pubstatus.mjs [--apply] [--only k1,k2]
//
// 1. arXiv API: the journal reference and DOI that authors add to their
//    preprint after publication.
// 2. Crossref, for preprints without such information: a journal article with
//    exactly the same title (up to notation) and a common author surname.
// Without --apply, only prints the proposed updates. With --apply, sets `doi`,
// `venue` and `year` (the publication year) and records the former
// preprint year in `preprintYear`. Keys never change.
import fs from 'node:fs';
import YAML from 'yaml';
import { acquireLock } from './lib/lock.mjs';
acquireLock('pubstatus.mjs');

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const UA = { 'User-Agent': 'rm-zoo publication status (https://github.com/LudovicPatey/rmzoo)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docs = fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml'))
  .map((f) => ['data/references/' + f, YAML.parseDocument(fs.readFileSync('data/references/' + f, 'utf8'))]);
const entries = docs.flatMap(([f, d]) => d.contents.items.map((pair) => ({ f, pair, key: pair.key.value, r: pair.value.toJSON() })))
  .filter((e) => !only || only.has(e.key));
const isPreprint = (r) => !r.doi && (!r.venue || /arxiv|preprint|submitted|to appear/i.test(r.venue));
const todo = entries.filter((e) => isPreprint(e.r));
const SYM = { '²': '2', '³': '3', '¹': '1', '⁰': '0', '₀': '0', '₁': '1', '₂': '2', '₃': '3', 'ω': 'omega', 'Σ': 'sigma', 'Π': 'pi', 'Δ': 'delta' };
const norm = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/[²³¹⁰₀₁₂₃ωΣΠΔ]/g, (c) => SYM[c])
  .replace(/\\(omega|sigma|pi|delta)\b/gi, (m, x) => x.toLowerCase()).replace(/\\[a-zA-Z]+/g, '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const surname = (a) => String(a).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).pop();
const updates = [];

// 1. arXiv
const ax = todo.filter((e) => e.r.arxiv);
for (let i = 0; i < ax.length; i += 50) {
  const batch = ax.slice(i, i + 50);
  let xml = '';
  for (let t = 0; t < 4; t++) {
    const res = await fetch('https://export.arxiv.org/api/query?max_results=50&id_list=' + batch.map((e) => e.r.arxiv).join(','), { headers: UA });
    if (res.ok) { xml = await res.text(); break; }
    await sleep(20000);
  }
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = (entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/) || [])[1];
    const e = batch.find((x) => String(x.r.arxiv) === id);
    if (!e) continue;
    const doi = (entry.match(/<arxiv:doi[^>]*>([^<]+)</) || [])[1];
    const jref = (entry.match(/<arxiv:journal_ref[^>]*>([^<]+)</) || [])[1]?.replace(/\s+/g, ' ').trim();
    if (doi || jref) updates.push({ e, doi, venue: jref, year: +(jref?.match(/\b(19|20)\d{2}\b/g) || []).pop() || undefined, how: 'arXiv metadata' });
  }
  await sleep(3500);
}
// 2. Crossref, for the others
for (const e of todo) {
  if (updates.some((u) => u.e === e) || !e.r.title) continue;
  const q = `https://api.crossref.org/works?rows=5&filter=type:journal-article&query.bibliographic=${encodeURIComponent(e.r.title.replace(/\$[^$]*\$/g, ' '))}&query.author=${encodeURIComponent(surname(e.r.authors?.[0] || ''))}`;
  try {
    const res = await fetch(q, { headers: UA });
    if (!res.ok) continue;
    const items = (await res.json()).message?.items || [];
    const names = new Set((e.r.authors || []).map(surname));
    const hit = items.find((w) => norm(w.title?.[0]) === norm(e.r.title) && (w.author || []).some((a) => names.has(String(a.family || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''))));
    if (hit) {
      const v = [hit['container-title']?.[0], hit.volume && `${hit.volume}${hit.issue ? `(${hit.issue})` : ''}`, hit.page].filter(Boolean).join(', ');
      updates.push({ e, doi: hit.DOI, venue: v, year: hit.issued?.['date-parts']?.[0]?.[0], how: 'Crossref (exact title)' });
    }
  } catch { /* skip */ }
  await sleep(250);
}

for (const u of updates) console.log(`${u.e.key}: ${u.e.r.venue || '(no venue)'} → ${u.venue || ''}${u.doi ? ` doi:${u.doi}` : ''}${u.year ? ` (${u.year})` : ''}  [${u.how}]`);
if (args.includes('--apply')) {
  for (const u of updates) {
    const v = u.e.pair.value;
    if (u.doi) v.set('doi', u.doi);
    if (u.venue) v.set('venue', u.venue);
    if (u.year && u.year !== u.e.r.year) { v.set('preprintYear', u.e.r.year); v.set('year', u.year); }
  }
  for (const [f, d] of docs) fs.writeFileSync(f, d.toString({ lineWidth: 0 }));
}
console.error(`${todo.length} preprints checked, ${updates.length} published${args.includes('--apply') ? ' (applied)' : ' (dry run; use --apply)'}`);
export default updates;
