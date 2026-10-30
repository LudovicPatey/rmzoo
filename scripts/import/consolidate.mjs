// One-off consolidation of the data files (kept for provenance).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') ? [path.join(d, e.name)] : []);
const docs = new Map(walk('data').map((f) => [f, YAML.parseDocument(fs.readFileSync(f, 'utf8'))]));
const save = () => { for (const [f, d] of docs) { const s = d.toString({ lineWidth: 0, flowCollectionPadding: false }); if (s !== fs.readFileSync(f, 'utf8')) fs.writeFileSync(f, s); } };
const stmtFiles = [...docs.keys()].filter((f) => f.includes('/statements/'));
const resultFiles = [...docs.keys()].filter((f) => f.includes('/results/'));
const findStmt = (id) => { for (const f of stmtFiles) { const items = docs.get(f).contents.items; const n = items.find((it) => it.get('id') === id); if (n) return n; } };
const setS = (id, kv) => { const n = findStmt(id); if (!n) throw new Error('no ' + id); for (const [k, v] of Object.entries(kv)) v === undefined ? n.delete(k) : n.set(k, v); };

// 1. naming: k-RAN, 1-GEN, 2-DNR
setS('ran1', { label: '1\\text{-}\\mathsf{RAN}', name: 'Existence of Martin-Löf randoms (1-RAN)', aliases: ['RAN1', 'MLR', 'Martin-Löf randomness', '1-RAN'], formulationOf: 'wwkl' });
setS('ran2', { label: '2\\text{-}\\mathsf{RAN}', name: 'Existence of 2-randoms (2-RAN)', aliases: ['RAN2', '2-random', '2-RAN'], formulationOf: 'wwkl2' });
setS('w2ran', { label: '\\mathsf{W}2\\text{-}\\mathsf{RAN}', name: 'Existence of weakly 2-randoms', aliases: ['W2R', 'weakly 2-random'] });
setS('cran', { label: '\\mathsf{CR}\\text{-}\\mathsf{RAN}', aliases: ['CR', 'computably random'] });
setS('sran', { label: '\\mathsf{SR}\\text{-}\\mathsf{RAN}', aliases: ['SR', 'Schnorr random'] });
setS('gen1', { label: '1\\text{-}\\mathsf{GEN}', name: 'Existence of 1-generics (1-GEN)', aliases: ['GEN1', '1-generic'] });
setS('dnr0', { label: '2\\text{-}\\mathsf{DNR}', name: 'Existence of DNC functions relative to the jump (2-DNR)', aliases: ['DNR0', '2-DNC', "DNR[0']"] });
setS('wwkl2', { aliases: ['WWKL2', '2-WWKL'] });
setS('pos1', { formulationOf: 'wwkl' });
setS('d2', { formulationOf: 'srt2' });
setS('rwkl2', { name: 'Ramsey-type WKL (variant RWKL₂)' });
setS('rwklw', { name: 'Ramsey-type WKL (variant RWKL_ω)' });
setS('prodwqo', { kind: 'sentence' });

// 2. remove the unused conjunction
for (const f of stmtFiles) { const items = docs.get(f).contents.items; const i = items.findIndex((it) => it.get('id') === 'srt22-wkl'); if (i >= 0) items.splice(i, 1); }

// 3. references: merge duplicate keys, fix missing year, attach uncited references
const renameRef = { bovykinweiermann2005: 'bovykinweiermann2017', chongslamanyangxxxx: 'chongslamanyang2017' };
for (const f of [...docs.keys()]) {
  let s = docs.get(f).toString({ lineWidth: 0 });
  let t = s;
  for (const [a, b] of Object.entries(renameRef)) t = t.replace(new RegExp(`(ref: "?)${a}\\b`, 'g'), `$1${b}`);
  if (t !== s) docs.set(f, YAML.parseDocument(t));
}
const rz = docs.get('data/references/rmzoo.yaml');
rz.contents.items = rz.contents.items.filter((p) => p.key.value !== 'bovykinweiermann2005');
const csy = rz.contents.items.find((p) => p.key.value === 'chongslamanyangxxxx');
csy.key.value = 'chongslamanyang2017';
csy.value.set('year', 2017); csy.value.set('venue', 'Advances in Mathematics 308, 121–141');
const addRef = (id, ref, role, loc) => { const n = findStmt(id); let r = n.get('refs'); if (!r) { n.set('refs', docs.get(stmtFiles[0]).createNode([])); r = n.get('refs'); } r.items.push(docs.get(stmtFiles[0]).createNode(loc ? { ref, role, loc } : { ref, role })); };
addRef('rca0', 'simpson1985', 'survey');
addRef('rca0', 'dzhafarovmummert2022', 'survey');
addRef('rt22', 'dzhafarovmummert2022', 'survey');
for (const id of ['fs', 'ts2', 'fs2']) addRef(id, 'friedman1999', 'origin');
addRef('fip', 'diamondstoneetal2016', 'rm');
for (const id of ['llpo', 'lpo', 'cn']) addRef(id, 'pauly2020', 'survey');
const red = docs.get('data/reductions.yaml');
for (const it of red.contents.items) {
  if (['gw', 'c', 'sc', 'w', 'sw', 'omega'].includes(it.get('id'))) it.set('refs', red.createNode([{ ref: 'hirschfeldtjockusch2016' }]));
}

// 4. merge duplicate results: keep the copy in a per-paper file, union the references
const all = [];
for (const f of resultFiles) docs.get(f).contents.items.forEach((n) => all.push({ f, n }));
const key = (n) => { const j = n.toJSON(); return [j.type, j.from ?? j.statement, j.to ?? j.property ?? j.base, [].concat(j.over ?? j.class ?? '').join(','), j.value ?? ''].join('|'); };
const groups = new Map();
for (const e of all) { const k = key(e.n); groups.set(k, [...(groups.get(k) || []), e]); }
let merged = 0;
for (const [, g] of groups) {
  if (g.length < 2) continue;
  const rank = (e) => (e.f.includes('/rmzoo/') || e.f.includes('/literature/') ? 0 : 1);
  g.sort((a, b) => rank(a) - rank(b));
  const keep = g[0].n;
  const refs = keep.get('refs') ? keep.get('refs').toJSON() : [];
  const notes = keep.get('note') ? [keep.get('note')] : [];
  for (const e of g.slice(1)) {
    const j = e.n.toJSON();
    for (const r of j.refs || []) if (!refs.some((x) => x.ref === r.ref)) refs.push(r);
    if (j.note && !notes.includes(j.note)) notes.push(j.note);
    const items = docs.get(e.f).contents.items;
    items.splice(items.indexOf(e.n), 1);
    merged++;
  }
  if (refs.length) { keep.set('refs', docs.get(g[0].f).createNode(refs)); keep.delete('folklore'); }
  if (notes.length) keep.set('note', notes.join(' '));
}
save();
console.log('merged', merged, 'duplicate results');
