// Search zbMATH Open and arXiv for papers on reverse mathematics and
// Weihrauch reducibility that are not yet in data/references.
//
//   node scripts/sweep.mjs [--since YYYY-MM-DD] [--add] [--out candidates.json]
//
// zbMATH Open (reviewed literature; MSC 03B30 "foundations of classical
// theories, including reverse mathematics", 03F35 "second- and higher-order
// arithmetic", and keyword searches) and arXiv (preprints) are queried for
// documents published or submitted since --since (default: one year ago).
// A document is relevant when its title, abstract, review or keywords mention
// reverse mathematics, Weihrauch reducibility, a Big Five system, computable
// reducibility (not of equivalence relations) or subsystems of second-order
// arithmetic. Duplicates of existing references (same DOI, arXiv id, title up to
// notation, or same authors/year with ≥80% of the title words) are dropped.
// With --add, papers whose *title* is clearly on topic (and whose authors are
// known) are added to data/references/sweep-<year>.yaml; the others are only
// listed for review. Papers judged out of scope are recorded in
// data/sweep-rejected.yaml and never proposed again.
import fs from 'node:fs';
import YAML from 'yaml';
import { acquireLock } from './lib/lock.mjs';
import { cli } from './lib/cli.mjs';
import { surname } from '../site/js/names.js';
cli('node scripts/sweep.mjs [--since YYYY-MM-DD] [--add] [--out candidates.json]', { '--since': 1, '--add': 0, '--out': 1 });
acquireLock('sweep.mjs');

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const since = arg('--since', new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10));
const UA = { 'User-Agent': 'rm-zoo literature sweep (https://github.com/LudovicPatey/rmzoo)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const found = [];

// ---- zbMATH Open ----
const y0 = +since.slice(0, 4), y1 = new Date().getFullYear() + 1;
const ZB = ['cc:03B30', 'cc:03F35', '"Weihrauch"', '"reverse mathematics"', '"second order arithmetic"', '"computable reducibility"'];
for (const q of ZB) {
  for (let page = 0; page < 30; page++) {
    let d;
    try { const r = await fetch(`https://api.zbmath.org/v1/document/_search?search_string=${encodeURIComponent(`${q} py:${y0}-${y1}`)}&page=${page}&results_per_page=100`, { headers: UA }); if (r.ok) d = await r.json(); } catch { /* retry next run */ }
    const rs = d?.result || [];
    for (const r of rs) {
      const links = r.links || [], src = r.source || {}, s0 = src.series?.[0];
      found.push({ src: 'zbmath', zbl: r.identifier, title: r.title?.title, year: +r.year,
        doi: links.find((l) => l.type === 'doi')?.identifier, arxiv: links.find((l) => l.type === 'arxiv')?.identifier?.replace(/^arXiv:/i, ''),
        authors: (r.contributors?.authors || []).map((a) => a.name.split(', ').reverse().join(' ')),
        venue: (s0?.title ? `${s0.title}${s0.volume ? ' ' + s0.volume : ''}${s0.issue ? `(${s0.issue})` : ''}${src.pages ? ', ' + src.pages : ''}` : src.source || '').replace(/~/g, ' '),
        text: [(r.editorial_contributions || []).map((e) => e.text).join(' '), (r.keywords || []).join(' ')].join(' '), msc: (r.msc || []).map((m) => m.code) });
    }
    if (rs.length < 100) break;
    await sleep(400);
  }
}
// ---- arXiv (newest first, until `since`) ----
const AX = ['abs:"reverse mathematics"', 'abs:"Weihrauch"', 'abs:"second-order arithmetic"', 'abs:"second order arithmetic"', 'abs:"computable reducibility"', 'abs:"RCA_0"', 'abs:"WKL_0"', 'abs:"ACA_0"', 'abs:"ATR_0"'];
for (const q of AX) {
  for (let start = 0; start < 1000; start += 100) {
    let xml = '';
    for (let t = 0; t < 4; t++) {
      const r = await fetch(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=100`, { headers: UA });
      if (r.ok) { xml = await r.text(); break; }
      await sleep(20000);
    }
    const entries = xml.split('<entry>').slice(1);
    let old = false;
    for (const e of entries) {
      const g = (re) => (e.match(re) || [])[1];
      const pub = g(/<published>([^<]+)</) || '';
      if (pub.slice(0, 10) < since) { old = true; continue; }
      found.push({ src: 'arxiv', arxiv: g(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/), title: g(/<title>([\s\S]*?)<\/title>/)?.replace(/\s+/g, ' ').trim(),
        year: +pub.slice(0, 4), authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]), doi: g(/<arxiv:doi[^>]*>([^<]+)</),
        venue: g(/<arxiv:journal_ref[^>]*>([^<]+)</)?.trim() || 'arXiv preprint', text: g(/<summary>([\s\S]*?)<\/summary>/)?.replace(/\s+/g, ' ') });
    }
    await sleep(3500);
    if (old || entries.length < 100) break;
  }
}

// ---- screening ----
const refs = Object.entries(Object.assign({}, ...fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml'))
  .map((f) => YAML.parse(fs.readFileSync('data/references/' + f, 'utf8')))));
const SYM = { '²': '2', '³': '3', '¹': '1', '⁰': '0', '₀': '0', '₁': '1', '₂': '2', '₃': '3', 'ω': 'omega', 'Σ': 'sigma', 'Π': 'pi', 'Δ': 'delta' };
const norm = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/[²³¹⁰₀₁₂₃ωΣΠΔ]/g, (c) => SYM[c]).replace(/\\(omega|sigma|pi|delta)\b/gi, (m, x) => x.toLowerCase())
  .replace(/\\[a-zA-Z]+/g, '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').replace(/0$/, '');
const last = (a) => surname(a).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).pop().replace(/[^a-z]/g, '');
const words = (t) => new Set(String(t || '').toLowerCase().normalize('NFKD').replace(/\\[a-z]+/g, ' ').match(/[a-z]{4,}/g) || []);
const have = refs.map(([k, r]) => ({ k, doi: r.doi?.toLowerCase(), ax: r.arxiv && String(r.arxiv), t: norm(r.title), y: r.year, a: new Set((r.authors || []).map(last)), w: words(r.title) }));
const dup = (x) => have.some((h) => (x.doi && h.doi === x.doi.toLowerCase()) || (x.arxiv && h.ax === String(x.arxiv)) || h.t === norm(x.title) ||
  (Math.abs((h.y || 0) - (x.year || 0)) <= 2 && (x.authors || []).some((a) => h.a.has(last(a))) && (() => { const W = words(x.title); let i = 0; for (const w of W) if (h.w.has(w)) i++; return i / Math.max(1, W.size, h.w.size) >= 0.8; })()));
const RM = [/reverse mathematic/i, /weihrauch/i, /\bRCA[_\\({$ ]*0|\bRCA0/, /\bWKL[_\\({$ ]*0|WKL0|weak k(ö|o|\\"o)nig/i, /\bACA[_\\({$ ]*0|ACA0|arithmetical comprehension/i,
  /\bATR[_\\({$ ]*0|ATR0|arithmetical transfinite recursion/i, /Pi\^?.?1.?_?.?1.?-?CA|Π.?1.?1.?-?CA/, /computabl[ey] reduc/i, /subsystems? of (second|2nd)[- ]order arithmetic/i];
// not the zoo's subject: other notions of computable reducibility, collections and reviews
const OFF = /equivalence relation|ceers?\b|preorder|computable (linear orders|metrics|structures)|degrees of metrics|book review|abstracts from the|proceedings|special issue|selected papers|in hono(u)?r of|festschrift/i;
// earlier decisions (data/sweep-rejected.yaml): never proposed again
const rejected = fs.existsSync('data/sweep-rejected.yaml') ? YAML.parse(fs.readFileSync('data/sweep-rejected.yaml', 'utf8')) || [] : [];
const rejDoi = new Set(rejected.map((x) => x.doi?.toLowerCase()).filter(Boolean)), rejTitle = new Set(rejected.map((x) => norm(x.title)));
const isRejected = (x) => (x.doi && rejDoi.has(x.doi.toLowerCase())) || rejTitle.has(norm(x.title));
const byKey = new Map();
for (const x of found) { if (!x.title) continue; const k = norm(x.title); byKey.set(k, { ...byKey.get(k), ...Object.fromEntries(Object.entries(x).filter(([, v]) => v)) }); }
const relevant = [...byKey.values()].filter((x) => RM.some((re) => re.test(`${x.title} ${x.text || ''}`)) && !OFF.test(`${x.title} ${x.text || ''}`) && !dup(x) && !isRejected(x));
// added automatically only when the title is unambiguous and the authors are known;
// "computable reducibility" alone is ambiguous (also used for equivalence relations)
const strong = (x) => (x.authors || []).length > 0 && /reverse mathematic|weihrauch|second[- ]order arithmetic|\bRCA|\bWKL|\bACA|\bATR|Π.?1.?1.?-?CA/i.test(x.title);
const sure = relevant.filter(strong), review = relevant.filter((x) => !strong(x));

if (args.includes('--add') && sure.length) {
  const file = `data/references/sweep-${new Date().getFullYear()}.yaml`;
  const doc = fs.existsSync(file) ? YAML.parseDocument(fs.readFileSync(file, 'utf8')) : YAML.parseDocument('# Papers found by scripts/sweep.mjs (zbMATH Open and arXiv), not yet mined for results.\n{}\n');
  const taken = new Set([...refs.map(([k]) => k), ...(doc.contents.items || []).map((p) => p.key.value)]);
  for (const x of sure) {
    const au = (x.authors || []).filter(Boolean);
    const base = (au.length > 3 ? last(au[0]) + 'etal' : au.map(last).join('') || 'anon') + (x.year || '');
    let k = base, i = 0; while (taken.has(k)) k = base + 'bcdefghij'[i++];
    taken.add(k);
    const e = { authors: au, title: x.title.replace(/\\\(|\\\)/g, '$').replace(/\s+/g, ' ').trim(), venue: x.venue || '', year: x.year, source: x.src };
    if (x.doi) e.doi = x.doi; if (x.arxiv) e.arxiv = String(x.arxiv); if (!x.doi && x.zbl) e.url = `https://zbmath.org/?q=an:${x.zbl}`;
    doc.set(k, doc.createNode(e)); x.key = k;
  }
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));
}
const summary = { since, found: byKey.size, added: args.includes('--add') ? sure.map((x) => x.key) : [], proposed: args.includes('--add') ? [] : sure, review };
if (args.includes('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(summary, null, 1));
console.error(`sweep since ${since}: ${byKey.size} documents, ${relevant.length} relevant and new (${sure.length} on topic by title${args.includes('--add') ? ', added' : ''}, ${review.length} to review)`);
