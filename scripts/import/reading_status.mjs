// Records in data/references/*.yaml how far each paper was read (field `read`):
// pdf-zotero / pdf-arxiv (full text parsed), abstract (abstract read),
// screened (abstract only keyword-screened). Kept for provenance; it needs the
// scratch files produced while building the database.
//   node scripts/import/reading_status.mjs <scratchDir>
import fs from 'node:fs';
import YAML from 'yaml';
const S = process.argv[2];
const sub = { '²': '2', '³': '3', '⁰': '0', '¹': '1', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', 'ω': ' omega ', 'Σ': ' sigma ', '∑': ' sigma ', 'Π': ' pi ', 'Δ': ' delta ' };
const STOP = new Set(['the', 'of', 'in', 'and', 'for', 'an', 'on']);
const words = (t) => String(t || '').replace(/[²³⁰¹₀₁₂₃₄ωΣ∑ΠΔ]/g, (c) => sub[c]).replace(/\\(mathsf|mathrm|mathbf|text|mathit)/g, ' ')
  .replace(/\\(Sigma|Pi|Delta|omega)/g, (m, x) => ' ' + x.toLowerCase() + ' ').toLowerCase().normalize('NFKD')
  .replace(/\\[a-z]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1 && !STOP.has(w));
const nt = (t) => words(t).join('');
const zot = [];
for (const line of fs.readFileSync(S + '/zot/all.tsv', 'utf8').split('\n')) {
  const p = line.split('\t');
  if (p.length < 4 || !p[3]) continue;
  const f = S + '/zot/all/' + p[1] + '.txt';
  if (fs.existsSync(f) && fs.statSync(f).size > 2000) zot.push({ n: nt(p[3]), w: new Set(words(p[3])) });
}
const axPdf = new Set(fs.readdirSync(S + '/src/pdf').filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, '').replace('_', '/')));
// full texts fetched for previously unread papers (named by reference key; source recorded in src_<key>)
const fetched = new Map();
if (fs.existsSync(S + '/full/txt')) for (const f of fs.readdirSync(S + '/full/txt')) {
  const k = f.replace(/\.txt$/, '');
  if (fs.statSync(S + '/full/txt/' + f).size > 2000 && fs.existsSync(S + '/full/src_' + k)) fetched.set(k, fs.readFileSync(S + '/full/src_' + k, 'utf8').trim());
}
const ax = JSON.parse(fs.readFileSync(S + '/src/arxiv_rel.json', 'utf8'));
const absRead = new Set(), absTitle = new Set();
fs.readFileSync(S + '/src/sel.txt', 'utf8').split(/\s+/).filter(Boolean).forEach((i) => absRead.add(ax[+i].arxiv));
const todo = JSON.parse(fs.readFileSync(S + '/src/todo.json', 'utf8'));
JSON.parse(fs.readFileSync(S + '/src/readlist.json', 'utf8')).forEach((i) => { if (todo[i].abs) absTitle.add(nt(todo[i].t)); });
const screened = new Set(todo.filter((t) => t.abs).map((t) => nt(t.t)));
const axByTitle = new Map(ax.map((p) => [nt(p.title), p.arxiv]));

const docs = fs.readdirSync('data/references').map((f) => ['data/references/' + f, YAML.parseDocument(fs.readFileSync('data/references/' + f, 'utf8'))]);
const all = docs.flatMap(([, d]) => d.contents.items.map((pair) => ({ pair, r: pair.value.toJSON() })));
// pass 1: exact (or prefix) title matches; the matched Zotero items are then reserved
const exact = (t, z) => z.n.length > 12 && (z.n === t || (t.length > 20 && z.n.length > 20 && (z.n.startsWith(t.slice(0, 35)) || t.startsWith(z.n.slice(0, 35)))));
const used = new Set();
for (const e of all) { const t = nt(e.r.title); const z = zot.find((z) => exact(t, z)); if (z) { e.zot = true; used.add(z); } }
// pass 2: word-overlap match against the remaining Zotero items only
const sim = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(a.size, b.size); };
for (const e of all) {
  if (e.zot) continue;
  const w = new Set(words(e.r.title));
  if (w.size >= 4 && zot.some((z) => !used.has(z) && sim(w, z.w) >= 0.8)) e.zot = true;
}
const counts = {};
for (const e of all) {
  const t = nt(e.r.title), id = e.r.arxiv || axByTitle.get(t);
  let st = null;
  if (e.zot) st = 'pdf-zotero';
  else if (id && axPdf.has(id)) st = 'pdf-arxiv';
  else if (fetched.has(e.pair.key.value)) st = fetched.get(e.pair.key.value) === 'arxiv' ? 'pdf-arxiv' : 'pdf-oa';
  else if ((id && absRead.has(id)) || absTitle.has(t)) st = 'abstract';
  else if (screened.has(t)) st = 'screened';
  if (st) e.pair.value.set('read', st); else e.pair.value.delete('read');
  counts[st || 'not read'] = (counts[st || 'not read'] || 0) + 1;
}
for (const [f, d] of docs) fs.writeFileSync(f, d.toString({ lineWidth: 0 }));
console.log(counts);
