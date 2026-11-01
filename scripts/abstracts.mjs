// Fetch the abstracts of the papers in data/references into data/abstracts.yaml.
//
//   node scripts/abstracts.mjs [--refresh] [--only k1,k2]
//
// Sources, in order: the arXiv API (references with an arXiv id), OpenAlex by
// DOI, and OpenAlex by title (accepted only on an exact normalized title match
// with the same year ±1). Abstracts already in the file are kept unless
// --refresh. Each entry records its source, so it can be checked:
//   key: { source: arxiv | openalex, text: "…" }
import fs from 'node:fs';
import YAML from 'yaml';

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const FILE = 'data/abstracts.yaml';
const out = fs.existsSync(FILE) ? YAML.parse(fs.readFileSync(FILE, 'utf8')) || {} : {};
const refs = Object.assign({}, ...fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml'))
  .map((f) => YAML.parse(fs.readFileSync('data/references/' + f, 'utf8'))));
const todo = Object.entries(refs).filter(([k]) => (!only || only.has(k)) && (args.includes('--refresh') || !out[k]));
const UA = { 'User-Agent': 'rm-zoo abstracts (https://github.com/LudovicPatey/rmzoo)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// arXiv answers 429 when queried too fast: wait and retry
const arxivText = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.status !== 429 && r.status !== 503) return r.text();
    await sleep(20000 * (i + 1));
  }
  throw new Error('arXiv rate limit');
};
const clean = (t) => t.replace(/\s+/g, ' ').replace(/^\s*(Abstract[.:]?)\s*/i, '').trim();
// titles compared without TeX, sub/superscripts or symbols: "SRT²₂" = "$\mathsf{SRT}^2_2$" = "SRT^2_2"
const SYM = { '²': '2', '³': '3', '¹': '1', '⁰': '0', '₀': '0', '₁': '1', '₂': '2', '₃': '3', 'ω': 'omega', 'Σ': 'sigma', 'Π': 'pi', 'Δ': 'delta' };
const norm = (t) => String(t || '').replace(/[²³¹⁰₀₁₂₃ωΣΠΔ]/g, (c) => SYM[c])
  .replace(/\\(omega|sigma|pi|delta|Sigma|Pi|Delta)\b/g, (m, x) => x.toLowerCase()).replace(/\\[a-zA-Z]+/g, '')
  .toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
const save = () => fs.writeFileSync(FILE, '# Abstracts of the papers in data/references, fetched by scripts/abstracts.mjs.\n'
  + YAML.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), { lineWidth: 0 }));
const counts = { arxiv: 0, openalex: 0, missing: 0 };

// 1. arXiv, 50 ids per request
const ax = todo.filter(([, r]) => r.arxiv);
for (let i = 0; i < ax.length; i += 50) {
  const batch = ax.slice(i, i + 50);
  const url = 'https://export.arxiv.org/api/query?max_results=50&id_list=' + batch.map(([, r]) => r.arxiv).join(',');
  try {
    const xml = await arxivText(url);
    for (const e of xml.split('<entry>').slice(1)) {
      const id = (e.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/) || [])[1];
      const sum = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
      const hit = batch.find(([, r]) => r.arxiv === id);
      if (hit && sum) {
        out[hit[0]] = { source: 'arxiv', text: clean(sum.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) };
        counts.arxiv++;
      }
    }
  } catch (err) { console.error('arXiv batch failed:', err.message); }
  await sleep(3000); // arXiv asks for one request every 3 s
}

// 2. OpenAlex, by DOI then by exact title
const fromInverted = (inv) => {
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter((w) => w !== undefined).join(' ');
};
const oa = async (url) => { const r = await fetch(url, { headers: UA }); return r.ok ? r.json() : null; };
for (const [k, r] of todo) {
  if (out[k] && !args.includes('--refresh')) continue;
  if (out[k]?.source === 'arxiv') continue;
  let w = null;
  try {
    if (r.doi) w = await oa(`https://api.openalex.org/works/doi:${encodeURIComponent(r.doi)}`);
    if (!w?.abstract_inverted_index && r.title) {
      const q = String(r.title).replace(/\$[^$]*\$|\\[a-zA-Z]+|[{}^_,:;?!()]/g, ' ').replace(/\s+/g, ' ').trim();
      const res = await oa(`https://api.openalex.org/works?per-page=5&filter=title.search:${encodeURIComponent(q)}`);
      w = (res?.results || []).find((x) => x.abstract_inverted_index && norm(x.title) === norm(r.title)
        && (!r.year || !x.publication_year || Math.abs(x.publication_year - r.year) <= 1)) || null;
    }
  } catch (err) { w = null; }
  if (w?.abstract_inverted_index) {
    const text = clean(fromInverted(w.abstract_inverted_index));
    if (text.length > 80) { out[k] = { source: 'openalex', text }; counts.openalex++; }
  }
  if (!out[k]) counts.missing++;
  await sleep(150);
}
// 3. arXiv by title, for what is still missing
const words = (t) => String(t).replace(/[²³¹⁰₀₁₂₃]/g, ' ').replace(/\$[^$]*\$|\\[a-zA-Z]+|[^A-Za-z0-9ωΣΠΔ -]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 3 && /^[A-Za-z0-9]+$/.test(w));
counts.arxivTitle = 0;
for (const [k, r] of todo) {
  if (out[k] || !r.title || r.arxiv) continue;
  const q = words(r.title).slice(0, 8).map((w) => `ti:${encodeURIComponent(w)}`).join('+AND+');
  if (!q) continue;
  try {
    const xml = await arxivText(`https://export.arxiv.org/api/query?max_results=5&search_query=${q}`);
    for (const e of xml.split('<entry>').slice(1)) {
      const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const sum = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
      const id = (e.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/) || [])[1];
      if (t && sum && norm(t) === norm(r.title)) {
        out[k] = { source: 'arxiv', arxiv: id, text: clean(sum.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) };
        counts.arxivTitle++; counts.missing--;
        break;
      }
    }
  } catch { /* skip */ }
  await sleep(3000);
}
save();
console.log(counts, `| ${Object.keys(out).length} abstracts for ${Object.keys(refs).length} papers`);
