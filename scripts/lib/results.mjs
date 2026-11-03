// Writing results into data/results/ without creating duplicates. Used by
// add-results.mjs (by hand), ai-analyze.mjs (automatic extraction) and
// ai-review.mjs (accepting a reviewed fact).
//
// spec: { "<refkey>": [ result, ... ], ... } where each result is as in
// data/results/*.yaml but without `refs`; an optional `loc` gives the theorem
// number. If the same fact already exists (same resultKey), the citation is merged
// into the existing entry (and a missing `loc` is filled in); otherwise the result
// is appended to data/results/literature/<refkey>.yaml.
// The special key "_ai" holds facts derived by an AI (provenance: ai, with a
// justification, no refs): they go to data/results/ai-derived.yaml, and are
// skipped when the same fact is already in the database.
//
// Returns { added, merged, skipped, changes, restore }: `changes` lists
// {action: 'added'|'merged'|'unchanged'|'skipped', file, key, ref} ('unchanged':
// the paper was already cited for this fact); restore() puts every
// touched file back as it was (used when a later check fails).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { resultKey } from './schema.mjs';

const AI_FILE = 'data/results/ai-derived.yaml';

export function addResults(spec) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') ? [path.join(d, e.name)] : []);
  const original = new Map();
  const docs = new Map(walk('data/results').map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    original.set(f, text);
    return [f, YAML.parseDocument(text)];
  }));
  const index = new Map();
  for (const [f, d] of docs) for (const n of d.contents?.items || []) index.set(resultKey(n.toJSON()), { f, n });

  // New entries are appended to the file as text (one flow map per line), so that
  // the rest of the file keeps its formatting; a file is re-serialized only when a
  // citation is merged into one of its entries.
  const touched = new Set(), reserialize = new Set();
  const appended = new Map(); // file -> lines to append
  const changes = [];
  const append = (f, header, fact, cite) => {
    if (!docs.has(f)) docs.set(f, YAML.parseDocument(`${header}\n\n[]\n`));
    const doc = docs.get(f);
    if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
    const node = doc.createNode(cite ? { ...fact, refs: [cite] } : fact);
    node.flow = true;
    doc.contents.items.push(node);
    index.set(resultKey(fact), { f, n: node });
    touched.add(f);
    if (!appended.has(f)) appended.set(f, []);
    appended.get(f).push(`- ${new YAML.Document(node).toString({ lineWidth: 0 }).trim()}`);
  };

  for (const [ref, results] of Object.entries(spec)) {
    for (const r of results) {
      const { loc, ...fact } = r;
      const key = resultKey(fact);
      const hit = index.get(key);
      if (ref === '_ai') {
        if (hit) { changes.push({ action: 'skipped', file: hit.f, key }); continue; }
        const { justification, ...rest } = fact;
        append(AI_FILE, '', { ...rest, provenance: 'ai', justification }, null);
        changes.push({ action: 'added', file: AI_FILE, key });
        continue;
      }
      const cite = loc ? { ref, loc } : { ref };
      if (hit) {
        const doc = docs.get(hit.f);
        const refs = hit.n.get('refs')?.toJSON() || [];
        const old = refs.find((x) => x.ref === ref);
        if (old && (old.loc || !loc) && (!fact.note || hit.n.get('note')) && !hit.n.get('folklore')) {
          changes.push({ action: 'unchanged', file: hit.f, key, ref }); // already cited
          continue;
        }
        if (old) { if (loc && !old.loc) old.loc = loc; } else refs.push(cite);
        hit.n.set('refs', doc.createNode(refs));
        hit.n.delete('folklore');
        if (fact.note && !hit.n.get('note')) hit.n.set('note', fact.note);
        touched.add(hit.f);
        reserialize.add(hit.f);
        changes.push({ action: 'merged', file: hit.f, key, ref });
        continue;
      }
      const f = `data/results/literature/${ref}.yaml`;
      append(f, `# Results from [${ref}].`, fact, cite);
      changes.push({ action: 'added', file: f, key, ref });
    }
  }
  for (const f of touched) {
    const old = original.get(f);
    const appendable = old !== undefined && !reserialize.has(f) && YAML.isSeq(YAML.parseDocument(old).contents)
      && (YAML.parseDocument(old).contents.flow !== true);
    if (appendable) fs.writeFileSync(f, old.replace(/\n*$/, '\n') + appended.get(f).join('\n') + '\n');
    else fs.writeFileSync(f, docs.get(f).toString({ lineWidth: 0 }));
  }
  const restore = () => {
    for (const f of touched) {
      if (original.has(f)) fs.writeFileSync(f, original.get(f));
      else fs.rmSync(f, { force: true });
    }
  };
  const count = (a) => changes.filter((c) => c.action === a).length;
  return { added: count('added'), merged: count('merged'), skipped: count('skipped'), changes, restore };
}
