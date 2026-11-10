// Reads data/*.yaml, validates it, runs the inference engine to detect
// contradictions, and writes site/data/zoo.json.
//
//   node scripts/build.mjs           build
//   node scripts/build.mjs --check   validate only (exit code 1 on error)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { execFileSync } from 'node:child_process';
import { buildZoo, questionStatus } from '../site/js/engine.js';
import { KINDS, screenKey, reviewStatus } from '../site/js/review.js';
import { cli } from './lib/cli.mjs';
import { dataHash } from './lib/data-hash.mjs';
import { unknownFields, OPERATIONS, resultKey, orcidValid } from './lib/schema.mjs';
// a question's comparisons: its own, or those of its sub-questions (parts)
const qFormal = (q) => (q.parts?.length ? q.parts.flatMap((p) => p.formal || []) : q.formal || []);
cli('node scripts/build.mjs [--check] [--verbose]', { '--check': 0, '--verbose': 0 });

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
  zoos: readYaml(path.join(dataDir, 'zoos.yaml')),
  modes: fs.existsSync(path.join(dataDir, 'modes.yaml')) ? readYaml(path.join(dataDir, 'modes.yaml')) || [] : [],
  classes: readYaml(path.join(dataDir, 'classes.yaml')),
  questions: readYaml(path.join(dataDir, 'questions.yaml')),
  concepts: fs.existsSync(path.join(dataDir, 'concepts.yaml')) ? readYaml(path.join(dataDir, 'concepts.yaml')) || [] : [],
  errata: fs.existsSync(path.join(dataDir, 'errata.yaml')) ? readYaml(path.join(dataDir, 'errata.yaml')) || [] : [],
};
const contexts = readYaml(path.join(dataDir, 'context.yaml')) || {};
const abstracts = fs.existsSync(path.join(dataDir, 'abstracts.yaml')) ? readYaml(path.join(dataDir, 'abstracts.yaml')) || {} : {};
// endorsements by researchers (live instance, docs/ENDORSEMENTS.md)
const endorsed = fs.existsSync(path.join(dataDir, 'endorsements.yaml')) ? readYaml(path.join(dataDir, 'endorsements.yaml')) || {} : {};
raw.endorsements = { people: endorsed.people || {}, endorsements: endorsed.endorsements || [] };
// zbMATH author profiles of the authors of the references (scripts/zbmath.mjs): code → {name, orcid}
const zbAuthors = fs.existsSync(path.join(dataDir, 'authors.yaml')) ? readYaml(path.join(dataDir, 'authors.yaml')) || {} : {};
// the review queue (docs/REVIEW.md): not part of the database; the open items go to
// site/data/review.json for the review page and the server
const queue = fs.existsSync(path.join(dataDir, 'review.yaml')) ? readYaml(path.join(dataDir, 'review.yaml')) || [] : [];
const screened = fs.existsSync(path.join(dataDir, 'screened.yaml')) ? readYaml(path.join(dataDir, 'screened.yaml')) || {} : {};

// ---- fields: only those of the data model (scripts/lib/schema.mjs) -----------
{
  const errs = [];
  for (const x of raw.statements) errs.push(...unknownFields(x, 'statement', `Statement ${x.id} (${x._file})`));
  raw.results.forEach((x, i) => errs.push(...unknownFields(x, 'result', `Result #${i} (${x._file}: ${x.from ?? x.statement} ${x.type} ${x.to ?? x.property ?? x.base ?? ''})`)));
  for (const [k, x] of Object.entries(raw.references)) errs.push(...unknownFields(x, 'reference', `Reference ${k}`));
  for (const [list, entity] of [['reductions', 'reduction'], ['tags', 'tag'], ['properties', 'property'], ['zoos', 'zoo'], ['modes', 'mode'], ['classes', 'class'], ['questions', 'question'], ['concepts', 'concept']])
    for (const x of raw[list] || []) errs.push(...unknownFields(x, entity, `${entity} ${x.id} (data/${list}.yaml)`));
  for (const [k, x] of Object.entries(abstracts)) errs.push(...unknownFields(x, 'abstract', `abstracts.yaml ${k}`));
  raw.errata.forEach((x, i) => errs.push(...unknownFields(x, 'erratum', `errata.yaml #${i} (${x.ref} ${x.loc})`)));
  const rej = path.join(dataDir, 'sweep-rejected.yaml');
  if (fs.existsSync(rej)) (readYaml(rej) || []).forEach((x, i) => errs.push(...unknownFields(x, 'sweepRejected', `sweep-rejected.yaml #${i}`)));
  queue.forEach((x, i) => errs.push(...unknownFields(x, 'review', `review.yaml #${i} (${x.id})`)));
  const analyzed = path.join(dataDir, 'ai-analyzed.yaml');
  if (fs.existsSync(analyzed)) for (const [k, x] of Object.entries(readYaml(analyzed) || {})) errs.push(...unknownFields(x, 'aiAnalyzed', `ai-analyzed.yaml ${k}`));
  for (const [k, x] of Object.entries(raw.endorsements.people)) errs.push(...unknownFields(x, 'person', `endorsements.yaml person ${k}`));
  raw.endorsements.endorsements.forEach((x, i) => errs.push(...unknownFields(x, 'endorsement', `endorsements.yaml #${i}`)));
  if (errs.length) { errs.forEach((e) => console.error('✗ ' + e)); process.exit(1); }
}

// ---- entry dates (for "recently added" on the front page) -------------------
// From git blame: a reference dates from its key line, a statement from its
// first line, a result from its most recently changed line (so a result counts
// as updated when a citation or theorem number is added). Uncommitted lines
// count as today. Without git, entries simply have no date.
{
  const blame = (rel) => {
    try {
      const out = execFileSync('git', ['blame', '--line-porcelain', '--', rel], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
      const t = [];
      let cur = 0;
      for (const l of out.split('\n')) {
        if (l.startsWith('author-time ')) cur = +l.slice(12);
        else if (l.startsWith('\t')) t.push(cur);
      }
      return t;
    } catch { return null; }
  };
  const lineOf = (src) => { const starts = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
    return (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo; }; };
  const iso = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : undefined);
  const dated = (rel, items, mode) => {
    const times = blame('data/' + rel);
    if (!times) return;
    const src = fs.readFileSync(path.join(dataDir, rel), 'utf8');
    const line = lineOf(src);
    const doc = YAML.parseDocument(src);
    const nodes = doc.contents?.items || [];
    nodes.forEach((n, k) => {
      const node = mode === 'key' ? n.key : n;
      if (!node?.range) return;
      const a = line(node.range[0]), b = mode === 'max' ? line(Math.max(node.range[0], node.range[1] - 1)) : a;
      const t = Math.max(...times.slice(a, b + 1));
      const target = mode === 'key' ? items[n.key.value] : items[k];
      if (target && t) { target._date = iso(t); target._t = t; target._pos = k; }
    });
  };
  for (const f of fs.readdirSync(path.join(dataDir, 'references')).filter((f) => f.endsWith('.yaml')))
    dated('references/' + f, raw.references, 'key');
  for (const [dir, mode] of [['statements', 'first'], ['results', 'max']]) {
    const byFile = new Map();
    for (const x of raw[dir]) { if (!byFile.has(x._file)) byFile.set(x._file, []); byFile.get(x._file).push(x); }
    for (const [f, items] of byFile) dated(f, items, mode);
  }
}

// ---- derived fields ----------------------------------------------------------
{
  const byId = new Map(raw.statements.map((s) => [s.id, s]));
  // A result may mention a conjunction "a-b-c" (conjuncts sorted, joined by "-")
  // without defining it: create it.
  const mentioned = [...raw.results.flatMap((r) => [r.from, r.to, r.statement, r.base]),
    ...raw.questions.flatMap((q) => qFormal(q).flatMap((f) => [f.from, f.to]))].filter(Boolean);
  for (const id of new Set(mentioned)) {
    if (byId.has(id)) continue;
    const parts = id.split('-');
    if (parts.length > 1 && parts.every((p) => byId.has(p)) && [...parts].sort().join('-') === id) {
      const s = { id, conjunction: parts, kind: 'sentence', tags: [], _file: 'auto' };
      raw.statements.push(s);
      byId.set(id, s);
    }
  }
  // Operator statements of the Weihrauch algebra, named by dotted ids:
  //   a.jump  a.par  a.fin  a.diamond  (postfix)   a.x.b  a.star.b  (binary)
  // applied left to right; parentheses group: cn.star.(lpo.jump) = C_N ⋆ LPO'.
  // e.g. lpo.jump = LPO', llpo.par = LLPO-hat, tcn.star.tcn = TC_N ⋆ TC_N.
  // They are created on the fly when results, questions or zoos mention them.
  // dotted name → arity / operation (scripts/lib/schema.mjs)
  const OPS = Object.fromEntries(Object.values(OPERATIONS).map((o) => [o.dotted, o.arity]));
  const OPNAME = Object.fromEntries(Object.entries(OPERATIONS).map(([op, o]) => [o.dotted, op]));
  // an explicit statement with the same operation and arguments (wkl-j for wkl.jump)
  // is used instead of creating a duplicate
  const sameOp = (op, args) => raw.statements.find((s) => s.op === op && s._file !== 'auto' && (s.args || []).join('|') === args.join('|'));
  const ensure = (id, op, args) => {
    if (byId.has(id)) return id;
    const same = sameOp(op, args);
    if (same) return same.id;
    const s = { id, op, args, kind: 'problem', tags: [], _file: 'auto' };
    raw.statements.push(s);
    byId.set(id, s);
    return id;
  };
  // tokens: names (letters, digits, dashes), '.', '(' and ')'
  function parseOp(src) {
    const toks = src.match(/[A-Za-z0-9-]+|[().]/g) || [];
    let k = 0;
    const term = () => {
      if (toks[k] === '(') { k++; const e = expr(); if (toks[k++] !== ')') throw new Error('missing )'); return e; }
      const t = toks[k++];
      if (!t || !byId.has(t)) throw new Error(`unknown statement ${t}`);
      return t;
    };
    // canonical ids: a postfix operation wraps a binary expression in parentheses,
    // the right operand of a binary operation is wrapped when it is compound
    const isBinary = (id) => ['product', 'compose'].includes(byId.get(id)?.op);
    function expr() {
      let cur = term();
      while (toks[k] === '.') {
        k++;
        const op = toks[k++];
        if (OPS[op] === 1) cur = ensure(`${isBinary(cur) ? `(${cur})` : cur}.${op}`, OPNAME[op], [cur]);
        else if (OPS[op] === 2) { if (toks[k++] !== '.') throw new Error('missing operand'); const rhs = term(); cur = ensure(`${cur}.${op}.${rhs.includes('.') ? `(${rhs})` : rhs}`, OPNAME[op], [cur, rhs]); }
        else throw new Error(`unknown operation ${op}`);
      }
      return cur;
    }
    const e = expr();
    if (k !== toks.length) throw new Error('trailing tokens');
    return e;
  }
  const canon = new Map(); // id as written → canonical id
  const makeOp = (id) => {
    if (byId.has(id) || !id.includes('.')) return byId.get(id);
    try { const e = parseOp(id); if (e !== id) canon.set(id, e); return byId.get(e); } catch { return undefined; }
  };
  for (const id of new Set([...mentioned, ...(raw.zoos || []).flatMap((z) => z.statements || [])])) makeOp(id);
  // refer to operator statements by their canonical ids everywhere
  const C = (id) => canon.get(id) || id;
  for (const r of raw.results) for (const f of ['from', 'to', 'statement', 'base']) if (r[f]) r[f] = C(r[f]);
  for (const q of raw.questions) { q.statements = (q.statements || []).map(C); for (const f of qFormal(q)) { f.from = C(f.from); f.to = C(f.to); } }
  for (const z of raw.zoos || []) z.statements = (z.statements || []).map(C);
  // labels, names and definitions of operator statements (unless given)
  // binary expressions get parentheses; a base that already has sub/superscripts is
  // grouped with braces so that a postfix ', * or ⋄ does not create a double superscript
  const wrap = (s) => (s.op === 'product' || s.op === 'compose' ? `(${s.label})`
    : /[\^_]/.test(s.label) && !/'$/.test(s.label) ? `{${s.label}}` : s.label);
  const opTex = (s) => {
    const a = s.args.map((x) => byId.get(x));
    if (a.some((x) => !x)) return null;
    for (const x of a) if (x.op && !x.label) fillOp(x);
    return { jump: () => `${wrap(a[0])}'`, par: () => `\\widehat{${a[0].label}}`, fin: () => `${wrap(a[0])}^{*}`, diamond: () => `${wrap(a[0])}^{\\diamond}`,
      product: () => `${wrap(a[0])} \\times ${wrap(a[1])}`, compose: () => `${wrap(a[0])} \\star ${wrap(a[1])}` }[s.op]?.();
  };
  // "Lesser limited principle…" → "lesser limited principle…" inside a name (acronyms unchanged)
  const plainName = (x) => { const n = x.name || x.id; return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };
  function fillOp(s) {
    const a = (s.args || []).map((x) => byId.get(x));
    if (a.some((x) => !x)) return;
    a.forEach((x) => { if (x.op && !x.label) fillOp(x); });
    s.label ||= opTex(s);
    s.name ||= { jump: () => `Jump of ${plainName(a[0])}`, par: () => `Parallelization of ${plainName(a[0])}`, fin: () => `Finite parallelization of ${plainName(a[0])}`, diamond: () => `Diamond of ${plainName(a[0])}`,
      product: () => `Product of ${plainName(a[0])} and ${plainName(a[1])}`, compose: () => `Compositional product of ${plainName(a[0])} and ${plainName(a[1])}` }[s.op]();
    const L = (x) => `$${x.label}$`;
    s.definition ||= {
      jump: () => `The jump of ${L(a[0])}: an instance is a sequence converging to an instance of ${L(a[0])} (in Baire space), with the same solutions.`,
      par: () => `The parallelization of ${L(a[0])}: given a sequence of instances of ${L(a[0])}, find a solution to each of them.`,
      fin: () => `The finite parallelization of ${L(a[0])}: given finitely many instances of ${L(a[0])}, find a solution to each of them.`,
      diamond: () => `The diamond of ${L(a[0])}: the closure of ${L(a[0])} under compositional product, i.e. using ${L(a[0])} any finite number of times, adaptively, the number of uses being decided during the computation (Neumann and Pauly).`,
      product: () => `Given an instance of ${L(a[0])} and an instance of ${L(a[1])}, find a solution to each.`,
      compose: () => `The compositional product of ${L(a[0])} and ${L(a[1])}: the strongest problem obtained by first solving an instance of ${L(a[1])} and then, computably in the result, an instance of ${L(a[0])} (Brattka, Gherardi and Marcone).`,
    }[s.op]();
    s.kind ||= 'problem';
    // instances and solutions, where the operation has a direct reading
    const io = {
      jump: () => [`A sequence converging (in Baire space) to an instance of ${L(a[0])}.`, `A solution of ${L(a[0])} to the limit instance.`],
      par: () => [`A sequence $(x_n)_n$ of instances of ${L(a[0])}.`, `A sequence $(y_n)_n$ with each $y_n$ a solution to $x_n$.`],
      fin: () => [`A finite sequence of instances of ${L(a[0])}.`, `A solution to each of them.`],
      product: () => [`A pair of an instance of ${L(a[0])} and an instance of ${L(a[1])}.`, `A solution to each of them.`],
      // the representative (id × f) ∘ gᵗ of f ⋆ g (Brattka and Pauly, "On the algebraic structure of Weihrauch degrees", Section 3)
      compose: () => [`An instance $x$ of ${L(a[1])} together with a (name of a) continuous multi-valued map $h$ sending every solution of $x$ to a pair $(p, u)$ with $u$ an instance of ${L(a[0])}.`,
        `A pair $(p, v)$ such that $(p, u) \\in h(y)$ for some solution $y$ of $x$ and $v$ is a solution of ${L(a[0])} to $u$.`],
    }[s.op]?.();
    if (io) { s.instance ||= io[0]; s.solution ||= io[1]; }
  }
  for (const s of raw.statements) if (s.op) fillOp(s);
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
// operator statements of the Weihrauch algebra
{
  const byId = new Map(raw.statements.map((x) => [x.id, x]));
  const arity = Object.fromEntries(Object.entries(OPERATIONS).map(([op, o]) => [op, o.arity]));
  for (const s of raw.statements.filter((x) => x.op)) {
    if (!arity[s.op]) { errors.push(`Statement ${s.id}: unknown operation ${s.op}`); continue; }
    if ((s.args || []).length !== arity[s.op]) errors.push(`Statement ${s.id}: ${s.op} takes ${arity[s.op]} argument(s)`);
    for (const a of s.args || []) {
      if (!byId.has(a)) errors.push(`Statement ${s.id}: unknown argument ${a}`);
      else if (byId.get(a).kind !== 'problem') errors.push(`Statement ${s.id}: argument ${a} is not a problem`);
    }
  }
}
// open questions: references, statements and formal parts must exist
{
  uniq(raw.questions, 'question');
  const sids = new Set(raw.statements.map((x) => x.id));
  for (const q of raw.questions) {
    const w = `Question ${q.id}`;
    if (!q.question && !q.parts?.length) errors.push(`${w}: missing question`);
    if (q.parts?.length) {
      if (q.formal?.length || q.status) errors.push(`${w}: with parts, formal comparisons and statuses belong to the parts`);
      if (q.parts.length < 2) errors.push(`${w}: parts are for two sub-questions or more`);
      q.parts.forEach((p, i) => {
        const pw = `${w}, part ${i + 1}`;
        if (!p.question) errors.push(`${pw}: missing question`);
        if (p.status && !['open', 'partial', 'resolved'].includes(p.status)) errors.push(`${pw}: status must be open, partial or resolved`);
        if (!p.formal?.length && p.status && p.status !== 'open' && !p.resolvedBy?.length && !q.resolvedBy?.length) errors.push(`${pw}: a (partially) resolved part needs resolvedBy`);
        for (const a of p.resolvedBy || []) if (!raw.references[a.ref]) errors.push(`${pw}: unknown reference ${a.ref}`);
      });
    }
    if (!q.asked?.length) errors.push(`${w}: missing asked (where it was stated)`);
    for (const a of q.asked || []) if (!raw.references[a.ref]) errors.push(`${w}: unknown reference ${a.ref}`);
    for (const a of q.resolvedBy || []) if (!raw.references[a.ref]) errors.push(`${w}: unknown reference ${a.ref}`);
    for (const id of q.statements || []) if (!sids.has(id)) errors.push(`${w}: unknown statement ${id}`);
    for (const f of qFormal(q)) {
      if (!rids.has(f.over)) errors.push(`${w}: unknown reduction ${f.over}`);
      for (const id of [f.from, f.to]) if (!sids.has(id)) errors.push(`${w}: unknown statement ${id}`);
    }
    if (q.kind && !['question', 'conjecture'].includes(q.kind)) errors.push(`${w}: kind must be question or conjecture`);
    if (q.status && !['open', 'partial', 'resolved'].includes(q.status)) errors.push(`${w}: status must be open, partial or resolved`);
    if (!q.parts?.length && !q.formal?.length && !q.status) errors.push(`${w}: a question without formal parts needs a status`);
    if (!q.parts?.length && !q.formal?.length && q.status !== 'open' && !q.resolvedBy?.length) errors.push(`${w}: a (partially) resolved question needs resolvedBy`);
    for (const [, k] of String(q.context || '').matchAll(/\[@([^\]]+)\]/g)) if (!raw.references[k]) errors.push(`${w}: context cites unknown reference ${k}`);
  }
}
{
  const cids = uniq(raw.classes, 'formula class');
  for (const c of raw.classes) {
    if (!c.notation || !c.definition) errors.push(`Formula class ${c.id}: notation and definition are required`);
    for (const d of c.includes || []) if (!cids.has(d)) errors.push(`Formula class ${c.id}: unknown included class ${d}`);
  }
  for (const s of raw.statements) if (s.form && !cids.has(s.form)) errors.push(`Statement ${s.id}: unknown form ${s.form}`);
  for (const r of raw.results) if (r.type === 'conservation' && !cids.has(r.class)) errors.push(`Conservation result on ${r.statement}: unknown class ${r.class}`);
}
{
  const byId = new Map(raw.statements.map((x) => [x.id, x]));
  for (const [id, text] of Object.entries(contexts)) {
    if (!byId.has(id)) { errors.push(`context.yaml: unknown statement ${id}`); continue; }
    for (const [, k] of String(text).matchAll(/\[@([^\]]+)\]/g)) if (!raw.references[k]) errors.push(`context.yaml (${id}): unknown reference ${k}`);
    byId.get(id).context = String(text).trim();
  }
  for (const k of Object.keys(abstracts)) if (!raw.references[k]) warnings.push(`abstracts.yaml: unknown reference ${k}`);
  // errata (data/errata.yaml): wrong statements of papers, shown on the paper's page
  raw.errata.forEach((x, i) => {
    const at = `errata.yaml #${i} (${x.ref} ${x.loc})`;
    if (!raw.references[x.ref]) errors.push(`${at}: unknown reference ${x.ref}`);
    if (!['misprint', 'error', 'gap'].includes(x.kind)) errors.push(`${at}: kind must be misprint, error or gap`);
    if (!String(x.claim || '').trim() || !String(x.correction || '').trim()) errors.push(`${at}: needs the claim and the correction`);
    for (const r of x.refs || []) if (!raw.references[r.ref]) errors.push(`${at}: unknown reference ${r.ref}`);
    for (const [, k] of String(x.correction || '').matchAll(/\[@([^\]\s]+)\]/g)) if (!raw.references[k]) errors.push(`${at}: unknown citation [@${k}]`);
    for (const [, k] of String(x.correction || '').matchAll(/\[\[([^\]]+)\]\]/g)) if (!byId.has(k)) errors.push(`${at}: unknown statement [[${k}]]`);
  });
  // concepts (data/concepts.yaml): sourced definitions of the words used in statement
  // definitions, attached to the statements that mention them (`_concepts`)
  uniq(raw.concepts, 'concept');
  const matchers = [];
  for (const c of raw.concepts) {
    if (!c.definition || !(c.refs || []).length) errors.push(`concepts.yaml ${c.id}: needs a definition and a source (refs)`);
    for (const r of c.refs || []) if (!raw.references[r.ref]) errors.push(`concepts.yaml ${c.id}: unknown reference ${r.ref}`);
    for (const s of c.skip || []) if (!byId.has(s)) errors.push(`concepts.yaml ${c.id}: skip lists unknown statement ${s}`);
    try { matchers.push([c, new RegExp(`(?<![\\p{L}\\p{N}])(?:${(c.match || []).join('|')})(?![\\p{L}\\p{N}])`, 'iu')]); }
    catch (e) { errors.push(`concepts.yaml ${c.id}: bad match pattern (${e.message})`); }
    if (!(c.match || []).length) errors.push(`concepts.yaml ${c.id}: needs match patterns`);
  }
  for (const s of raw.statements) {
    if (s.conjunction) continue;
    const text = [s.definition, s.instance, s.solution].filter(Boolean).join(' ');
    const hit = matchers.filter(([c, rx]) => !(c.skip || []).includes(s.id) && rx.test(text)).map(([c]) => c.id);
    if (hit.length) s._concepts = hit;
  }
}
{
  uniq(raw.zoos, 'preset zoo');
  const sids = new Set(raw.statements.map((x) => x.id));
  for (const z of raw.zoos) {
    if (!rids.has(z.reduction)) errors.push(`Preset zoo ${z.id}: unknown reduction ${z.reduction}`);
    for (const id of z.statements || []) if (!sids.has(id)) errors.push(`Preset zoo ${z.id}: unknown statement ${id}`);
  }
}
const pids = uniq(raw.properties, 'property');
const sids = uniq(raw.statements, 'statement');
const refIds = new Set(Object.keys(raw.references));

for (const r of raw.reductions)
  for (const c of r.finerThan || []) if (!rids.has(c)) errors.push(`Reduction ${r.id}: unknown finerThan ${c}`);
for (const p of raw.properties) {
  if (p.closedUnder !== undefined && !rids.has(p.closedUnder)) errors.push(`Property ${p.id}: unknown reduction ${p.closedUnder}`);
  if ((p.closedUnder === undefined) !== (p.direction === undefined)) errors.push(`Property ${p.id}: closedUnder and direction go together`);
  if (p.bottomOf && !rids.has(p.bottomOf)) errors.push(`Property ${p.id}: unknown bottomOf ${p.bottomOf}`);
  if (p.baseImplication && !rids.has(p.baseImplication)) errors.push(`Property ${p.id}: unknown baseImplication ${p.baseImplication}`);
  if (p.domain !== undefined && p.domain !== 'problems') errors.push(`Property ${p.id}: domain must be problems`);
  for (const q of p.implies || []) if (!pids.has(q) || q === p.id) errors.push(`Property ${p.id}: implies unknown property ${q}`);
  if (!['computability', 'proof', 'weihrauch'].includes(p.group)) errors.push(`Property ${p.id}: group must be computability, proof or weihrauch`);
  if (p.direction !== undefined && !['down', 'up', 'equiv'].includes(p.direction)) errors.push(`Property ${p.id}: direction must be down, up or equiv`);
  for (const o of [p.selfOp, ...(p.opHas || []), ...(p.opKeeps || [])].filter(Boolean))
    if (!OPERATIONS[o]) errors.push(`Property ${p.id}: unknown operation ${o}`);
  if ((p.selfOp || p.opHas || p.opKeeps || p.lift) && p.direction !== 'equiv') errors.push(`Property ${p.id}: operation laws and lifts are for equiv (Weihrauch) properties`);
  if (p.lift && (!rids.has(p.lift.from) || !rids.has(p.lift.to))) errors.push(`Property ${p.id}: lift needs known reductions from and to`);
  for (const q of p.implies || []) { const qq = raw.properties.find((x) => x.id === q); if (qq && (qq.group === 'weihrauch') !== (p.group === 'weihrauch')) errors.push(`Property ${p.id}: implies ${q} of another group`); }
}
{ // implications between properties form no cycle (the viewer lists the extremal ones)
  const imp = new Map(raw.properties.map((p) => [p.id, p.implies || []]));
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') { errors.push(`Properties: cycle of implications ${[...path, id].join(' ⇒ ')}`); return; }
    state.set(id, 'open');
    for (const q of imp.get(id) || []) visit(q, [...path, id]);
    state.set(id, 'done');
  };
  for (const id of imp.keys()) visit(id, []);
}
for (const s of raw.statements)
  if (s.problemForm !== undefined && (s.problemForm !== false || s.kind === 'problem')) errors.push(`Statement ${s.id}: problemForm is only "false", on sentences`);

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
  // a diamond is defined as a closure (any finite number of adaptive uses): it has no direct reading
  if (s.kind === 'problem' && !s.conjunction && !s.base && s.op !== 'diamond' && (!s.instance || !s.solution))
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
  if (!res.folklore && !res.provenance && !(res.refs && res.refs.length))
    errors.push(`${where}: needs refs, folklore: true, or provenance: ai | direct`);
  if (res.provenance && !['ai', 'direct'].includes(res.provenance)) errors.push(`${where}: provenance must be ai or direct`);
  if (res.provenance && !res.justification) errors.push(`${where}: AI-derived and direct results need a justification`);
  if (res.justification) {
    const kinds = ['restriction', 'reduction', 'classical', 'personal-communication', 'unreferenced'];
    if (!kinds.includes(res.justification.kind)) errors.push(`${where}: justification.kind must be one of ${kinds.join(', ')}`);
    if (!res.justification.text) errors.push(`${where}: justification needs a text`);
    for (const [, k] of String(res.justification.text || '').matchAll(/\[@([^\]]+)\]/g)) if (!raw.references[k]) errors.push(`${where}: justification cites unknown reference ${k}`);
  }
  checkRefs(res.refs, where);
});

// ---- consolidation checks ------------------------------------------------------
{
  // the same fact must be recorded once, with all its references
  const seen = new Map();
  raw.results.forEach((r, i) => {
    const k = resultKey(r);
    if (seen.has(k)) errors.push(`Result #${i} (${r._file}) duplicates result #${seen.get(k)}: merge their references instead`);
    else seen.set(k, i);
  });
  // a paper must have a single key
  // titles compared up to notation: "SRT²₂ … ω-models" = "$\mathsf{SRT}^2_2$ … $\omega$-models" = "SRT22 … omega-models"
  const SYM = { '²': '2', '³': '3', '¹': '1', '⁰': '0', '⁴': '4', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', 'ω': 'omega', 'Σ': 'sigma', 'Π': 'pi', 'Δ': 'delta', 'α': 'alpha' };
  const norm = (t) => String(t || '').replace(/[²³¹⁰⁴₀₁₂₃₄ωΣΠΔα]/g, (c) => SYM[c])
    .replace(/\\(omega|alpha|sigma|pi|delta)\b/gi, (m, x) => x.toLowerCase()).replace(/\\[a-zA-Z]+/g, '')
    .toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  // `version: key` marks another version of the same work (e.g. conference and journal papers)
  const related = (a, b) => raw.references[a]?.version === b || raw.references[b]?.version === a;
  for (const [k, r] of Object.entries(raw.references)) if (r.version && !raw.references[r.version]) errors.push(`Reference ${k}: unknown version ${r.version}`);
  for (const [c, a] of Object.entries(zbAuthors)) if (a?.orcid && !orcidValid(a.orcid)) errors.push(`authors.yaml: invalid ORCID iD ${a.orcid} for ${c}`);
  // two references with the same zbMATH document are versions of one work (`version`), or one is wrong
  {
    const byZb = new Map();
    for (const [k, r] of Object.entries(raw.references)) if (r.zbmath) { if (!byZb.has(r.zbmath)) byZb.set(r.zbmath, []); byZb.get(r.zbmath).push(k); }
    const linked = (a, b) => raw.references[a].version === b || raw.references[b].version === a;
    for (const [z, ks] of byZb) if (ks.length > 1 && !ks.every((a) => ks.some((b) => a !== b && linked(a, b))))
      warnings.push(`References ${ks.join(', ')} have the same zbMATH document ${z}: link the versions (version) or correct the mapping`);
  }
  const byDoi = new Map(), byTitle = new Map(), byArxiv = new Map();
  for (const [k, r] of Object.entries(raw.references)) {
    if (!r.year) errors.push(`Reference ${k} has no year`);
    if (r.read && !['pdf-zotero', 'pdf-arxiv', 'pdf-oa', 'pdf-author', 'abstract', 'screened'].includes(r.read)) errors.push(`Reference ${k}: unknown read status ${r.read}`);
    if (!r.authors || !r.authors.join('').trim()) errors.push(`Reference ${k} has no authors`);
    if (r.doi) { const d = r.doi.toLowerCase(); if (byDoi.has(d)) errors.push(`References ${byDoi.get(d)} and ${k} have the same DOI`); byDoi.set(d, k); }
    // a DOI is 10.<registrant>/<suffix>; TeX escapes or an arXiv id in its place break the links and the full-text lookup
    if (r.doi && !/^10\.\d{4,9}\/[^\s\\$]+$/.test(String(r.doi))) errors.push(`Reference ${k}: malformed DOI ${JSON.stringify(r.doi)} (an arXiv id goes in arxiv)`);
    if (r.zbmath && !/^(\d{4}\.\d{5}|\d{2}\.\d{4}\.\d{2}|arXiv:\S+)$/.test(String(r.zbmath))) errors.push(`Reference ${k}: malformed zbMATH identifier ${JSON.stringify(r.zbmath)} (Zbl number such as 1214.03047, JFM number such as 55.0032.04, or arXiv:<id>)`);
    for (const c of r.zbmathAuthors || []) if (!zbAuthors[c]) errors.push(`Reference ${k}: zbMATH author ${c} is not in data/authors.yaml (run node scripts/zbmath.mjs)`);
    const t = norm(r.title).replace(/0$/, ''); // "…ATR" = "…ATR₀"
    if (t.length > 15 && byTitle.has(t) && !related(byTitle.get(t), k)) errors.push(`References ${byTitle.get(t)} and ${k} have the same title (merge them, or mark one as \`version\` of the other)`);
    byTitle.set(t, k);
    if (r.arxiv) {
      if (byArxiv.has(r.arxiv) && !related(byArxiv.get(r.arxiv), k)) errors.push(`References ${byArxiv.get(r.arxiv)} and ${k} have the same arXiv id`);
      byArxiv.set(r.arxiv, k);
    }
  }
  // cautions about misleading names: text whose citations and statement links resolve
  for (const s of raw.statements) {
    if (s.caution === undefined) continue;
    if (typeof s.caution !== 'string' || !s.caution.trim()) { errors.push(`Statement ${s.id}: caution must be a non-empty text`); continue; }
    for (const [, k] of s.caution.matchAll(/\[@([^\]]+)\]/g)) if (!raw.references[k]) errors.push(`Statement ${s.id}: caution cites unknown reference ${k}`);
    for (const [, k] of s.caution.matchAll(/\[\[([^\]]+)\]\]/g)) if (!raw.statements.some((t) => t.id === k)) errors.push(`Statement ${s.id}: caution links unknown statement ${k}`);
  }
  // the same name for two statements (an alias equal to another's alias or plain label) needs a caution on one of them
  {
    const flat = (l) => String(l || '').replace(/\\(?:mathsf|mathrm|mathbf|textsf|text)\{([^}]*)\}/g, '$1').replace(/[{}\s]/g, '').toLowerCase();
    const names = new Map();
    for (const s of raw.statements) {
      if (s.conjunction || s.op) continue;
      for (const n of new Set([flat(s.label), ...(s.aliases || []).map((a) => a.toLowerCase().replace(/\s+/g, ''))])) {
        if (!n || n.length < 2 || /\\/.test(n)) continue;
        if (!names.has(n)) names.set(n, []);
        names.get(n).push(s);
      }
    }
    for (const [n, ss] of names) if (ss.length > 1 && !ss.some((s) => s.caution)) warnings.push(`Statements ${ss.map((s) => s.id).join(', ')} share the name "${n}": add a caution to one of them or remove the alias`);
  }
  // phrases (names in words, read by the miners): lists of names of two words or more,
  // each naming one statement
  {
    const seen = new Map();
    for (const s of raw.statements) {
      if (s.phrases === undefined) continue;
      if (!Array.isArray(s.phrases) || s.phrases.some((p) => typeof p !== 'string')) { errors.push(`Statement ${s.id}: phrases must be a list of names`); continue; }
      for (const p of s.phrases) {
        const k = p.toLowerCase().replace(/['’`]/g, '').replace(/[\s-]+/g, ' ').trim();
        if (k.split(' ').length < 2) errors.push(`Statement ${s.id}: phrase "${p}" is a single word (it would match everywhere)`);
        if (seen.has(k) && seen.get(k) !== s.id) errors.push(`Statements ${seen.get(k)} and ${s.id} share the phrase "${p}"`);
        seen.set(k, s.id);
      }
    }
  }
  // minor statements: a boolean, never a base system or a conjunction
  for (const s of raw.statements) if (s.minor !== undefined && (s.minor !== true || s.conjunction || s.op)) errors.push(`Statement ${s.id}: minor must be true, on a plain statement`);
  // formulations point to a main formulation, never to another formulation
  const byId = new Map(raw.statements.map((s) => [s.id, s]));
  for (const s of raw.statements) {
    if (s.formulationOf && byId.get(s.formulationOf)?.formulationOf)
      errors.push(`Statement ${s.id}: formulationOf ${s.formulationOf}, which is itself a formulation of ${byId.get(s.formulationOf).formulationOf}`);
  }
  // endorsements: valid ORCID iDs, known people, no duplicates; an endorsement of a
  // result that no longer exists (edited since) is only a warning: decide whether
  // it carries over to the new form of the result
  {
    const keys = new Set(raw.results.map(resultKey));
    const seen = new Set();
    for (const [k, p] of Object.entries(raw.endorsements.people)) {
      if (!orcidValid(k)) errors.push(`endorsements.yaml: invalid ORCID iD ${k}`);
      if (!p?.name) errors.push(`endorsements.yaml: person ${k} has no name`);
    }
    for (const e of raw.endorsements.endorsements) {
      if (!raw.endorsements.people[e.orcid]) errors.push(`endorsements.yaml: endorsement by unknown person ${e.orcid}`);
      if (seen.has(`${e.result}#${e.orcid}`)) errors.push(`endorsements.yaml: ${e.orcid} endorses ${e.result} twice`);
      seen.add(`${e.result}#${e.orcid}`);
      if (!keys.has(e.result)) warnings.push(`endorsements.yaml: endorsed result ${e.result} is no longer in the database`);
    }
  }
  // review queue: unique ids, known kinds and statuses, votes and comments by known people
  {
    const ids = new Set();
    for (const it of queue) {
      const at = `review.yaml ${it.id}`;
      if (ids.has(it.id)) errors.push(`${at}: duplicate id`);
      ids.add(it.id);
      if (!KINDS[it.kind]) errors.push(`${at}: unknown kind ${it.kind}`);
      if (!['pending', 'accepted', 'rejected', 'done'].includes(it.status)) errors.push(`${at}: unknown status ${it.status}`);
      if (it.ref && !raw.references[it.ref]) errors.push(`${at}: unknown reference ${it.ref}`);
      const voted = new Set();
      for (const v of it.votes || []) {
        if (!raw.endorsements.people[v.orcid]) errors.push(`${at}: vote by unknown person ${v.orcid} (people are in endorsements.yaml)`);
        if (!['valid', 'invalid'].includes(v.verdict)) errors.push(`${at}: vote ${v.verdict} (valid or invalid)`);
        if (voted.has(v.orcid)) errors.push(`${at}: two votes by ${v.orcid}`);
        voted.add(v.orcid);
      }
      for (const c of it.comments || []) if (!raw.endorsements.people[c.orcid]) errors.push(`${at}: comment by unknown person ${c.orcid}`);
    }
  }
  const names = new Map();
  for (const s of raw.statements) if (s.name) { if (names.has(s.name)) warnings.push(`Statements ${names.get(s.name)} and ${s.id} have the same name`); names.set(s.name, s.id); }
  // every statement takes part in at least one result, as an argument of an operation
  // statement that does, or in the formal part of a question
  const used = new Set(raw.results.flatMap((r) => [r.from, r.to, r.statement, r.base]));
  for (const q of raw.questions || []) for (const f of qFormal(q)) { used.add(f.from); used.add(f.to); }
  for (const s of raw.statements) if (used.has(s.id)) for (const x of s.args || []) used.add(x);
  for (const s of raw.statements) if (!used.has(s.id) && !raw.statements.some((t) => (t.conjunction || []).includes(s.id)))
    warnings.push(`Statement ${s.id} appears in no result`);
}

if (errors.length) {
  errors.forEach((e) => console.error('✗ ' + e));
  process.exit(1);
}

// ---- inference ---------------------------------------------------------------
const t0 = Date.now();
// ---- "studied over" labels --------------------------------------------------
// A statement is labelled with a framework (RCA₀, RCA₀*, Weihrauch) when at
// least one paper states a result about it — or about a combination containing
// it — in that framework. Folklore and AI-derived results do not count.
// studied: { rca0: [refs], rca0star: [refs], weihrauch: [refs] }
{
  const FRAME = { rca0: 'rca0', rca0star: 'rca0star', w: 'weihrauch', sw: 'weihrauch' };
  const byId = new Map(raw.statements.map((s) => [s.id, s]));
  const acc = new Map();
  for (const r of raw.results) {
    const refs = (r.refs || []).map((x) => x.ref);
    if (!refs.length || r.provenance) continue;
    const frames = [...new Set([].concat(r.over || (r.type === 'conservation' ? 'rca0' : [])).map((o) => FRAME[o]).filter(Boolean))];
    if (!frames.length) continue;
    for (const id of [r.from, r.to, r.statement, r.base].filter(Boolean)) {
      for (const sid of [id, ...(byId.get(id)?.conjunction || [])]) {
        if (!acc.has(sid)) acc.set(sid, {});
        const o = acc.get(sid);
        for (const f of frames) { o[f] ||= new Set(); refs.forEach((x) => o[f].add(x)); }
      }
    }
  }
  for (const [sid, o] of acc) {
    const s = byId.get(sid);
    if (!s) continue;
    // the bottom of a framework is not "studied" in it (RCA₀ over RCA₀)
    const st = Object.entries(o).filter(([f]) => !(s.base || []).includes(f));
    if (st.length) s.studied = Object.fromEntries(st.map(([f, set]) => [f, [...set].sort()]));
  }
}

// ---- modes (data/modes.yaml): which statements each lens shows ------------------
// a statement belongs to a mode when a cited result about it lives there, or when
// it is the base system of one of the mode's reductions
{
  const rids = new Set(raw.reductions.map((r) => r.id));
  for (const m of raw.modes) {
    for (const r of m.reductions || []) if (!rids.has(r)) errors.push(`modes.yaml ${m.id}: unknown reduction ${r}`);
    if (!(m.reductions || []).includes(m.default)) errors.push(`modes.yaml ${m.id}: the default reduction ${m.default} is not one of its reductions`);
  }
  uniq(raw.modes, 'mode');
  const byId = new Map(raw.statements.map((s) => [s.id, s]));
  const groupOf = new Map(raw.properties.map((p) => [p.id, p.group]));
  for (const m of raw.modes) if (Array.isArray(m.properties)) for (const g of m.properties) if (!['computability', 'proof', 'weihrauch'].includes(g)) errors.push(`modes.yaml ${m.id}: unknown property group ${g}`);
  const inMode = (m, r) => r.type === 'property' ? (m.properties === true || (m.properties || []).includes(groupOf.get(r.property))) : r.type === 'conservation' ? !!m.conservation
    : [].concat(r.over || []).some((o) => m.reductions.includes(o));
  const add = (s, m) => { if (s && !(s._modes ||= []).includes(m.id)) s._modes.push(m.id); };
  for (const r of raw.results) {
    if (!(r.refs || []).length) continue;
    for (const m of raw.modes) if (inMode(m, r))
      for (const id of [r.from, r.to, r.statement, r.base].filter(Boolean)) {
        add(byId.get(id), m);
        for (const c of byId.get(id)?.conjunction || []) add(byId.get(c), m);
      }
  }
  for (const s of raw.statements) for (const m of raw.modes)
    if (Array.isArray(s.base) && s.base.some((b) => m.reductions.includes(b))) add(s, m);
}

const zoo = buildZoo(raw);
const ms = Date.now() - t0;
zoo.errors.forEach((e) => errors.push(e));
const name = (i) => raw.statements[i].id;
// formal questions: a manual status must agree with the database
for (const q of raw.questions) {
  if (!qFormal(q).length) continue;
  const st = questionStatus(zoo, q);
  // a part's manual status must agree too
  (q.parts || []).forEach((p, i) => { if (p.formal?.length && p.status && p.status !== st.subs[i].status) errors.push(`Question ${q.id}, part ${i + 1} is marked ${p.status} but the database makes it ${st.subs[i].status}`); });
  if (q.status && q.status !== st.status)
    errors.push(`Question ${q.id} is marked ${q.status} but the database makes it ${st.status} (${st.parts.map((p) => `${p.from}→${p.to}/${p.over}: ${p.status}`).join(', ')})`);
  for (const p of st.parts) if (p.status === 'na') errors.push(`Question ${q.id}: ${p.from}→${p.to} is not comparable over ${p.over}`);
}
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
  // _key: identity of each result (endorsements refer to it)
  // dataHash: the contents of data/ this build was made from (deploy checks it)
  // the authors of the references with their ORCID iDs (the viewer's bell, docs/UPLOADS.md)
  const used = new Set(Object.values(raw.references).flatMap((r) => r.zbmathAuthors || []));
  const authorsOut = Object.fromEntries(Object.entries(zbAuthors).filter(([c]) => used.has(c)).map(([c, a]) => [c, { name: a.name, ...(a.orcid ? { orcid: a.orcid } : {}) }]));
  const clean = { ...raw, authors: authorsOut, statements: raw.statements, results: raw.results.map((r) => ({ ...r, _key: resultKey(r) })), builtAt: new Date().toISOString(), dataHash: dataHash(dataDir) };
  fs.writeFileSync(path.join(outDir, 'zoo.json'), JSON.stringify(clean));
  // abstracts are loaded on demand by the paper pages; light TeX clean-up for display
  const detex = (t) => String(t).replace(/<\/?(jats:)?[a-z]+[^>]*>/g, '')
    .replace(/\{\\(em|it|bf|sl|sc|rm|tt)\s+([^{}]*)\}/g, '$2').replace(/\\(emph|textit|textbf|textsc|textrm|texttt|mathrm)\{([^{}]*)\}/g, '$2')
    .replace(/\\cite[pt]?\{[^}]*\}/g, '').replace(/``|''/g, '"').replace(/\\(?=[%&#_])/g, '').replace(/~/g, ' ').replace(/\s+/g, ' ').trim();
  const abs = Object.fromEntries(Object.entries(abstracts).filter(([k]) => raw.references[k])
    .map(([k, a]) => [k, { source: a.source, ...(a.arxiv ? { arxiv: a.arxiv } : {}), text: detex(a.text) }]));
  fs.writeFileSync(path.join(outDir, 'abstracts.json'), JSON.stringify(abs));
  for (const [k] of Object.entries(abs)) clean.references[k].hasAbstract = true;
  fs.writeFileSync(path.join(outDir, 'zoo.json'), JSON.stringify(clean));
  // the open items of the review queue (not those already examined through the report)
  const done = new Set(Object.entries(screened).flatMap(([list, keys]) => (keys || []).map((k) => `${list}#${k}`)));
  const open = queue.filter((it) => it.status === 'pending' && !(screenKey(it) && done.has(screenKey(it).join('#'))))
    .map(({ decision, ...it }) => it);
  fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify({ builtAt: clean.builtAt, items: open }));
  clean.review = { open: open.length, validated: open.filter((it) => reviewStatus(it.votes) === 'validated').length };
  fs.writeFileSync(path.join(outDir, 'zoo.json'), JSON.stringify(clean));
  console.log(`✓ wrote site/data/zoo.json, site/data/review.json (${open.length} items to review)`);
}
