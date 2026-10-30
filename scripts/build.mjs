// Reads data/*.yaml, validates it, runs the inference engine to detect
// contradictions, and writes site/data/zoo.json.
//
//   node scripts/build.mjs           build
//   node scripts/build.mjs --check   validate only (exit code 1 on error)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildZoo } from '../site/js/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const checkOnly = process.argv.includes('--check');

const readYaml = (file) => {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) ?? [];
  } catch (e) {
    console.error(`✗ ${path.relative(root, file)}: ${e.message}`);
    process.exit(1);
  }
};
// recursive: data/results/rmzoo/*.yaml etc.
const listYaml = (dir) => fs.readdirSync(path.join(dataDir, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => e.isDirectory() ? listYaml(`${dir}/${e.name}`) : (/\.ya?ml$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const readDir = (dir) =>
  listYaml(dir).flatMap((f) => (readYaml(path.join(dataDir, f)) || []).map((x) => ({ ...x, _file: f })));

const raw = {
  reductions: readYaml(path.join(dataDir, 'reductions.yaml')),
  tags: readYaml(path.join(dataDir, 'tags.yaml')),
  properties: readYaml(path.join(dataDir, 'properties.yaml')),
  references: Object.assign({}, ...fs.readdirSync(path.join(dataDir, 'references')).filter((f) => f.endsWith('.yaml')).sort()
    .map((f) => readYaml(path.join(dataDir, 'references', f)) || {})),
  statements: readDir('statements'),
  results: readDir('results'),
};

// ---- derived fields ----------------------------------------------------------
{
  const byId = new Map(raw.statements.map((s) => [s.id, s]));
  // A result may mention a conjunction "a-b-c" (conjuncts sorted, joined by "-")
  // without defining it: create it.
  const mentioned = raw.results.flatMap((r) => [r.from, r.to, r.statement, r.base]).filter(Boolean);
  for (const id of new Set(mentioned)) {
    if (byId.has(id)) continue;
    const parts = id.split('-');
    if (parts.length > 1 && parts.every((p) => byId.has(p)) && [...parts].sort().join('-') === id) {
      const s = { id, conjunction: parts, kind: 'sentence', tags: [], _file: 'auto' };
      raw.statements.push(s);
      byId.set(id, s);
    }
  }
  for (const s of raw.statements) {
    if (!s.conjunction) continue;
    const parts = s.conjunction.map((id) => byId.get(id));
    if (parts.some((p) => !p)) continue; // reported below
    // order the conjuncts as the main principle first, then by label
    if (!s.label) s.label = parts.map((p) => p.label).join(' + ');
    if (!s.name) s.name = parts.map((p) => p.name).join(' + ');
    if (parts.every((p) => p.firstOrder)) s.firstOrder = true;
  }
}

// ---- validation ------------------------------------------------------------
const errors = [];
const warnings = [];
const uniq = (list, what) => {
  const seen = new Set();
  for (const x of list) {
    if (!x.id) errors.push(`${what} without id: ${JSON.stringify(x).slice(0, 80)}`);
    else if (seen.has(x.id)) errors.push(`Duplicate ${what} id: ${x.id}`);
    seen.add(x.id);
  }
  return seen;
};
const rids = uniq(raw.reductions, 'reduction');
const tids = uniq(raw.tags, 'tag');
const pids = uniq(raw.properties, 'property');
const sids = uniq(raw.statements, 'statement');
const refIds = new Set(Object.keys(raw.references));

for (const r of raw.reductions)
  for (const c of r.finerThan || []) if (!rids.has(c)) errors.push(`Reduction ${r.id}: unknown finerThan ${c}`);
for (const p of raw.properties)
  if (!rids.has(p.closedUnder)) errors.push(`Property ${p.id}: unknown reduction ${p.closedUnder}`);

const checkRefs = (refs, where) => {
  for (const r of refs || []) {
    if (!r || !r.ref) errors.push(`${where}: malformed reference ${JSON.stringify(r)}`);
    else if (!refIds.has(r.ref)) errors.push(`${where}: unknown reference ${r.ref}`);
  }
};

for (const s of raw.statements) {
  const where = `Statement ${s.id} (${s._file})`;
  if (!s.label) errors.push(`${where}: missing label`);
  if (!['problem', 'sentence'].includes(s.kind)) errors.push(`${where}: kind must be problem or sentence`);
  for (const t of s.tags || []) if (!tids.has(t)) errors.push(`${where}: unknown tag ${t}`);
  if (s.formulationOf && !sids.has(s.formulationOf)) errors.push(`${where}: unknown formulationOf ${s.formulationOf}`);
  for (const c of s.conjunction || []) if (!sids.has(c)) errors.push(`${where}: unknown conjunct ${c}`);
  if (s.conjunction && s.kind !== 'sentence') errors.push(`${where}: conjunctions must have kind sentence`);
  if (s.kind === 'problem' && !s.conjunction && !s.base && (!s.instance || !s.solution))
    warnings.push(`${where}: problem without instance/solution`);
  if (!s.conjunction && !s.definition) warnings.push(`${where}: missing definition`);
  checkRefs(s.refs, where);
}

raw.results.forEach((res, i) => {
  const where = `Result #${i} (${res._file})`;
  if (['implication', 'separation', 'equivalence'].includes(res.type)) {
    for (const f of ['from', 'to']) if (!sids.has(res[f])) errors.push(`${where}: unknown statement ${res[f]}`);
    for (const o of [].concat(res.over)) if (!rids.has(o)) errors.push(`${where}: unknown reduction ${o}`);
  } else if (res.type === 'conservation') {
    for (const f of ['statement', 'base']) if (!sids.has(res[f])) errors.push(`${where}: unknown statement ${res[f]}`);
    if (!res.class) errors.push(`${where}: conservation needs a class`);
  } else if (res.type === 'property') {
    if (!sids.has(res.statement)) errors.push(`${where}: unknown statement ${res.statement}`);
    if (!pids.has(res.property)) errors.push(`${where}: unknown property ${res.property}`);
    if (typeof res.value !== 'boolean') errors.push(`${where}: value must be true or false`);
  } else errors.push(`${where}: unknown type ${res.type}`);
  if (!res.folklore && res.provenance !== 'ai' && !(res.refs && res.refs.length))
    errors.push(`${where}: needs refs, folklore: true, or provenance: ai`);
  if (res.provenance && res.provenance !== 'ai') errors.push(`${where}: provenance must be ai`);
  if (res.provenance === 'ai' && !res.justification) errors.push(`${where}: AI-derived results need a justification`);
  if (res.justification) {
    const kinds = ['restriction', 'reduction', 'classical', 'personal-communication', 'unreferenced'];
    if (!kinds.includes(res.justification.kind)) errors.push(`${where}: justification.kind must be one of ${kinds.join(', ')}`);
    if (!res.justification.text) errors.push(`${where}: justification needs a text`);
  }
  checkRefs(res.refs, where);
});

// ---- consolidation checks ------------------------------------------------------
{
  // the same fact must be recorded once, with all its references
  const seen = new Map();
  raw.results.forEach((r, i) => {
    const k = [r.type, r.from ?? r.statement, r.to ?? r.property ?? r.base, [].concat(r.over ?? r.class ?? '').join(','), r.value ?? ''].join('|');
    if (seen.has(k)) errors.push(`Result #${i} (${r._file}) duplicates result #${seen.get(k)}: merge their references instead`);
    else seen.set(k, i);
  });
  // a paper must have a single key
  const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/\$[^$]*\$/g, '').replace(/[^a-z0-9]/g, '');
  const byDoi = new Map(), byTitle = new Map();
  for (const [k, r] of Object.entries(raw.references)) {
    if (!r.year) errors.push(`Reference ${k} has no year`);
    if (r.read && !['pdf-zotero', 'pdf-arxiv', 'pdf-oa', 'abstract', 'screened'].includes(r.read)) errors.push(`Reference ${k}: unknown read status ${r.read}`);
    if (!r.authors || !r.authors.join('').trim()) errors.push(`Reference ${k} has no authors`);
    if (r.doi) { const d = r.doi.toLowerCase(); if (byDoi.has(d)) errors.push(`References ${byDoi.get(d)} and ${k} have the same DOI`); byDoi.set(d, k); }
    const t = norm(r.title) + '|' + r.year;
    if (byTitle.has(t)) warnings.push(`References ${byTitle.get(t)} and ${k} look like the same paper`);
    byTitle.set(t, k);
  }
  // formulations point to a main formulation, never to another formulation
  const byId = new Map(raw.statements.map((s) => [s.id, s]));
  for (const s of raw.statements) {
    if (s.formulationOf && byId.get(s.formulationOf)?.formulationOf)
      errors.push(`Statement ${s.id}: formulationOf ${s.formulationOf}, which is itself a formulation of ${byId.get(s.formulationOf).formulationOf}`);
  }
  const names = new Map();
  for (const s of raw.statements) if (s.name) { if (names.has(s.name)) warnings.push(`Statements ${names.get(s.name)} and ${s.id} have the same name`); names.set(s.name, s.id); }
  // every statement takes part in at least one result
  const used = new Set(raw.results.flatMap((r) => [r.from, r.to, r.statement, r.base]));
  for (const s of raw.statements) if (!used.has(s.id) && !raw.statements.some((t) => (t.conjunction || []).includes(s.id)))
    warnings.push(`Statement ${s.id} appears in no result`);
}

if (errors.length) {
  errors.forEach((e) => console.error('✗ ' + e));
  process.exit(1);
}

// ---- inference ---------------------------------------------------------------
const t0 = Date.now();
const zoo = buildZoo(raw);
const ms = Date.now() - t0;
zoo.errors.forEach((e) => errors.push(e));
const name = (i) => raw.statements[i].id;
for (const c of zoo.contradictions) {
  if (c.kind === 'implication')
    errors.push(`Contradiction over ${raw.reductions[c.r].id}: ${name(c.a)} both implies and does not imply ${name(c.b)}`);
  else errors.push(`Contradiction: ${name(c.s)} both has and fails property ${raw.properties[c.p].id}`);
}

if (process.argv.includes('--verbose')) warnings.forEach((w) => console.warn('! ' + w));
else if (warnings.length) console.warn(`! ${warnings.length} warnings (missing instance/solution or definition); run with --verbose`);
if (errors.length) {
  errors.forEach((e) => console.error('✗ ' + e));
  process.exit(1);
}

let nI = 0, nN = 0, nOpen = 0;
for (let r = 0; r < zoo.R.length; r++)
  for (let a = 0; a < zoo.n; a++) for (let b = 0; b < zoo.n; b++) {
    if (a === b) continue;
    const s = zoo.status(r, a, b);
    if (s === 'implies') nI++;
    else if (s === 'separated') nN++;
    else if (s === 'open') nOpen++;
  }
console.log(
  `✓ ${raw.statements.length} statements, ${raw.results.length} results, ` +
  `${Object.keys(raw.references).length} references — derived ${nI} implications, ` +
  `${nN} separations, ${nOpen} open (statement, statement, reduction) triples in ${ms} ms`,
);

if (!checkOnly) {
  const outDir = path.join(root, 'site', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const clean = { ...raw, statements: raw.statements, results: raw.results, builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'zoo.json'), JSON.stringify(clean));
  console.log(`✓ wrote site/data/zoo.json`);
}
