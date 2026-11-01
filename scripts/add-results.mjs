// Add results to the database without creating duplicates.
//
//   node scripts/add-results.mjs spec.json
//
// spec.json: { "<refkey>": [ result, ... ], ... } where each result is as in
// data/results/*.yaml but without `refs`; an optional `loc` gives the theorem
// number. If the same fact already exists (same type, statements, reduction),
// the citation is merged into the existing entry (and a missing `loc` is
// filled in); otherwise the result is appended to
// data/results/literature/<refkey>.yaml.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { acquireLock } from './lib/lock.mjs';
acquireLock('add-results.mjs');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') ? [path.join(d, e.name)] : []);
const docs = new Map(walk('data/results').map((f) => [f, YAML.parseDocument(fs.readFileSync(f, 'utf8'))]));
const key = (j) => [j.type, j.from ?? j.statement, j.to ?? j.property ?? j.base, [].concat(j.over ?? j.class ?? '').join(','), j.value ?? ''].join('|');
const index = new Map();
for (const [f, d] of docs) for (const n of d.contents?.items || []) index.set(key(n.toJSON()), { f, n });

const touched = new Set();
let added = 0, merged = 0;
for (const [ref, results] of Object.entries(spec)) {
  for (const r of results) {
    const { loc, ...fact } = r;
    const cite = loc ? { ref, loc } : { ref };
    const hit = index.get(key(fact));
    if (hit) {
      const doc = docs.get(hit.f);
      const refs = hit.n.get('refs')?.toJSON() || [];
      const old = refs.find((x) => x.ref === ref);
      if (old) { if (loc && !old.loc) old.loc = loc; } else refs.push(cite);
      hit.n.set('refs', doc.createNode(refs));
      hit.n.delete('folklore');
      if (fact.note && !hit.n.get('note')) hit.n.set('note', fact.note);
      touched.add(hit.f);
      merged++;
      continue;
    }
    const f = `data/results/literature/${ref}.yaml`;
    if (!docs.has(f)) {
      docs.set(f, YAML.parseDocument(`# Results from [${ref}].\n\n[]\n`));
    }
    const doc = docs.get(f);
    if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
    const node = doc.createNode({ ...fact, refs: [cite] });
    node.flow = true;
    doc.contents.items.push(node);
    index.set(key(fact), { f, n: node });
    touched.add(f);
    added++;
  }
}
for (const f of touched) fs.writeFileSync(f, docs.get(f).toString({ lineWidth: 0 }));
console.log(`${added} results added, ${merged} citations merged into existing results`);
