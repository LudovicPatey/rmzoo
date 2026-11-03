// AI analysis of the full texts: Claude reads each cached paper once, in full,
// and lists every fact it proves about catalogue statements, however it is worded
// ("every computable instance has a solution not computing C" is cone avoidance),
// plus immediate deductions (special cases of a stated theorem). This complements
// the regex miners of scripts/mine/, which only see results phrased in the usual
// notation.
//
//   node scripts/ai-analyze.mjs [--only key1,key2] [--since YYYY-MM-DD] [--limit N]
//                               [--redo] [--replay] [--dry-run] [--concurrency N] [--effort level]
//
//   --only      analyze these references only
//   --since     only texts cached since this date (cache/fulltext/index.json)
//   --limit     at most N papers in this run
//   --redo      analyze again papers already in data/ai-analyzed.yaml
//   --replay    no new reading: process again the saved answers (cache/ai/<key>.json),
//               e.g. after the catalogue or these rules changed; only facts never
//               verified cost a (small) verification call
//   --dry-run   no API call, no data change: list the papers, estimate the cost,
//               and write the prompt of the first one to cache/ai/<key>.prompt.txt
//   --concurrency  papers analyzed in parallel (default 2)
//   --effort    effort of the extraction call (default high)
//
// Credentials: ANTHROPIC_API_KEY (or an `ant auth login` profile), read by the
// Anthropic SDK. Each paper costs one long call (the whole text) and one short
// verification call; the catalogue part of the prompt is cached between papers.
//
// What happens to each proposed fact (decided by code, not by the model):
//  * added to data/results/ when all of these hold: the statement, property and
//    reduction ids exist; the quoted passage is found verbatim in the text; a
//    theorem number is given; the extractor rated it `high` and says the paper
//    states it (origin `stated`) or that it is a special case of one stated result
//    (origin `special-case`); it does not contradict the database; a second,
//    independent call shown the passages confirms it; and `npm run check` still
//    passes afterwards. Stated facts cite the paper (merged into an existing entry
//    if there is one); special cases go to data/results/ai-derived.yaml with
//    provenance: ai and the argument as justification.
//  * dropped when the database already has it or derives it (a stated fact
//    identical to an existing entry is not dropped: its citation is merged);
//  * otherwise written to data/ai-review.yaml for a human decision, with the
//    reasons (scripts/ai-review.mjs lists, accepts and rejects them).
// Every analyzed paper is recorded in data/ai-analyzed.yaml (date, model, what
// was added), so it is not analyzed again; the raw answers are kept in cache/ai/.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import Anthropic from '@anthropic-ai/sdk';
import { cli } from './lib/cli.mjs';
import { acquireLock } from './lib/lock.mjs';
import { addResults } from './lib/results.mjs';
import { OPERATIONS } from './lib/schema.mjs';
import { factChecker, locator } from './lib/ai-facts.mjs';
import { buildZoo } from '../site/js/engine.js';

const USAGE = 'node scripts/ai-analyze.mjs [--only key1,key2] [--since YYYY-MM-DD] [--limit N] [--redo] [--replay] [--dry-run] [--concurrency N] [--effort low|medium|high|xhigh|max]';
const args = cli(USAGE, { '--only': 1, '--since': 1, '--limit': 1, '--redo': 0, '--replay': 0, '--dry-run': 0, '--concurrency': 1, '--effort': 1 });
const DRY = args.has('--dry-run');
const REPLAY = args.has('--replay');
const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 }; // $ per million tokens (cache write: 1-hour TTL)
const EFFORT = args.get('--effort', 'high');
const CONCURRENCY = Number(args.get('--concurrency', 2));
const LEDGER = 'data/ai-analyzed.yaml';
const REVIEW = 'data/ai-review.yaml';
const RAW_DIR = 'cache/ai';

if (!DRY) acquireLock('ai-analyze.mjs');
execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' }); // zoo.json up to date
const raw = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
const zoo = buildZoo(raw);
const readYaml = (f, d) => (fs.existsSync(f) ? YAML.parse(fs.readFileSync(f, 'utf8')) ?? d : d);
const ledger = readYaml(LEDGER, {});
fs.mkdirSync(RAW_DIR, { recursive: true });

// ---- the prompt -----------------------------------------------------------------
const squash = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const plain = raw.statements.filter((s) => !s.op && !s.conjunction).sort((a, b) => a.id.localeCompare(b.id));
const catalogue = [
  '# Catalogue',
  '',
  '## Reductions (id: meaning)',
  ...raw.reductions.map((r) => `- ${r.id}: ${r.name}. ${squash(r.description, 300)}${r.domain === 'problems' ? ' (between problems only)' : ''}`),
  '',
  '## Properties (id: meaning)',
  ...raw.properties.map((p) => `- ${p.id}: ${p.name}. ${squash(p.description, 400)}${p.domain === 'problems' ? ' (only for statements formulated as problems)' : ''}`),
  '',
  '## Formula classes for conservation (id: notation)',
  ...raw.classes.map((c) => `- ${c.id}: ${c.notation}`),
  '',
  '## Statements (id | TeX label | name | kind | other names), then the definition',
  ...plain.map((s) => `- ${s.id} | ${s.label} | ${s.name || ''} | ${s.kind}${s.aliases?.length ? ' | ' + s.aliases.join(', ') : ''}\n  ${squash(s.definition, 500)}${s.instance ? `\n  Instance: ${squash(s.instance, 200)} Solution: ${squash(s.solution, 200)}` : ''}`),
  '',
  `Operations for dotted ids: ${Object.values(OPERATIONS).map((o) => o.dotted).join(', ')}.`,
].join('\n');
const INSTRUCTIONS = fs.readFileSync('scripts/ai/extract.md', 'utf8');
const VERIFY = fs.readFileSync('scripts/ai/verify.md', 'utf8');

const str = { type: 'string' };
const FACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'from', 'to', 'over', 'statement', 'property', 'base', 'class', 'value', 'loc', 'quote', 'paperNotation', 'origin', 'citedFrom', 'argument', 'confidence', 'concerns'],
  properties: {
    type: { type: 'string', enum: ['implication', 'separation', 'equivalence', 'property', 'conservation'] },
    from: str, to: str, over: str, statement: str, property: str, base: str, class: str,
    value: { type: 'boolean' },
    loc: str, quote: str, paperNotation: str,
    origin: { type: 'string', enum: ['stated', 'cited', 'special-case', 'deduced'] },
    citedFrom: str, argument: str,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    concerns: str,
  },
};
const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'missingStatements', 'summary'],
  properties: {
    facts: { type: 'array', items: FACT_SCHEMA },
    missingStatements: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['notation', 'name', 'loc', 'definition', 'facts'],
        properties: { notation: str, name: str, loc: str, definition: str, facts: str },
      },
    },
    summary: { type: 'string', description: 'two sentences on what the paper is about' },
  },
};
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['index', 'verdict', 'reason'],
        properties: { index: { type: 'integer' }, verdict: { type: 'string', enum: ['confirmed', 'rejected', 'unsure'] }, reason: str },
      },
    },
  },
};

// ---- papers to analyze -----------------------------------------------------------
const index = fs.existsSync('cache/fulltext/index.json') ? JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8')) : {};
const only = args.has('--only') ? new Set(args.get('--only').split(',')) : null;
const since = args.get('--since', '');
let papers = Object.keys(raw.references).sort()
  .filter((k) => fs.existsSync(`cache/fulltext/${k}.txt`))
  .filter((k) => !only || only.has(k))
  .filter((k) => !since || (index[k]?.date || '') >= since)
  .filter((k) => (REPLAY ? fs.existsSync(`${RAW_DIR}/${k}.json`) : args.has('--redo') || !ledger[k]));
if (only) for (const k of only) if (!raw.references[k]) console.error(`unknown reference ${k}`);
if (args.has('--limit')) papers = papers.slice(0, Number(args.get('--limit')));

const userPrompt = (key, text) => {
  const r = raw.references[key];
  return `Paper [${key}]: ${(r.authors || []).join(', ')}, "${r.title}", ${r.year}.\n\n<paper>\n${text}\n</paper>\n\nExtract the facts of this paper as instructed.`;
};
const estTokens = (s) => Math.round(s.length / 3.3);

if (DRY) {
  const catTokens = estTokens(INSTRUCTIONS + catalogue);
  let total = 0;
  for (const k of papers) total += estTokens(fs.readFileSync(`cache/fulltext/${k}.txt`, 'utf8'));
  const cost = (total * PRICE.input + papers.length * catTokens * PRICE.cacheRead + papers.length * 15000 * PRICE.output) / 1e6;
  console.log(`${papers.length} papers to analyze (${total.toLocaleString()} text tokens, about ${catTokens.toLocaleString()} prompt tokens each, cached).`);
  console.log(`Estimated cost: about $${cost.toFixed(0)} (assuming ~15k output and thinking tokens per paper; verification calls are small).`);
  if (papers.length) {
    const k = papers[0];
    const file = `${RAW_DIR}/${k}.prompt.txt`;
    fs.writeFileSync(file, `${INSTRUCTIONS}\n\n${catalogue}\n\n---- user ----\n${userPrompt(k, fs.readFileSync(`cache/fulltext/${k}.txt`, 'utf8'))}`);
    console.log(`Prompt of ${k} written to ${file}.`);
  }
  for (const k of papers.slice(0, 50)) console.log(`  ${k}`);
  if (papers.length > 50) console.log(`  … and ${papers.length - 50} more`);
  process.exit(0);
}

// ---- checks (scripts/lib/ai-facts.mjs) ----------------------------------------------
const { triage } = factChecker(raw, zoo);
const rmap = new Map(raw.reductions.map((r) => [r.id, r]));

// Excerpts shown to the verifier: around the quote and around the numbered statement.
function excerpts(text, locate, f) {
  const out = [];
  const at = locate(f.quote);
  if (at >= 0) out.push(text.slice(Math.max(0, at - 2500), at + 2500));
  const m = f.loc.match(/^(Theorem|Proposition|Corollary|Lemma|Fact|Remark|Claim|Definition|Statement|Example)\s+[\w.]+/i);
  if (m) {
    const re = new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    let hit;
    while ((hit = re.exec(text)) && out.length < 3) {
      if (at >= 0 && Math.abs(hit.index - at) < 2500) continue;
      out.push(text.slice(Math.max(0, hit.index - 500), hit.index + 3500));
      break;
    }
  }
  return out;
}
const describe = (id) => {
  const s = raw.statements.find((x) => x.id === id);
  if (!s) return `${id}: operator statement (components: ${id})`;
  return `${id} (${s.label}, ${s.name || ''}): ${squash(s.definition, 700)}${s.instance ? ` Instance: ${squash(s.instance, 300)} Solution: ${squash(s.solution, 300)}` : ''}`;
};

// ---- API ---------------------------------------------------------------------------
const client = new Anthropic({ maxRetries: 4 });
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const cost = (u) => (u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) / 1e6;

async function call({ system, user, schema, effort, maxTokens }) {
  const msg = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // a policy decline is retried server-side on another model
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  }).finalMessage();
  const u = msg.usage || {};
  const mine = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
  for (const k in usage) usage[k] += mine[k];
  if (msg.stop_reason === 'refusal') throw new Error(`declined (${msg.stop_details?.category ?? 'no category'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('answer cut at max_tokens');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { json: JSON.parse(text), usage: mine, model: msg.model };
}

// Writes to data/ are serialized (papers are analyzed concurrently).
let writing = Promise.resolve();
const serial = (fn) => (writing = writing.then(fn, fn));

// The paper's pending items are replaced by the new ones; decided items stay, and a
// fact already decided (same id: hash of the entry) is not proposed again.
function appendReview(key, items) {
  const doc = fs.existsSync(REVIEW)
    ? YAML.parseDocument(fs.readFileSync(REVIEW, 'utf8'))
    : YAML.parseDocument(fs.readFileSync('scripts/ai/review-header.yaml', 'utf8'));
  if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
  doc.contents.flow = false;
  doc.contents.items = doc.contents.items.filter((n) => !(n.get('ref') === key && n.get('status') === 'pending'));
  const ids = new Set(doc.contents.items.map((n) => n.get('id')));
  for (const it of items) if (!ids.has(it.id)) doc.contents.items.push(doc.createNode(it));
  fs.writeFileSync(REVIEW, doc.toString({ lineWidth: 0 }));
}
function writeLedger(key, rec) {
  const doc = fs.existsSync(LEDGER)
    ? YAML.parseDocument(fs.readFileSync(LEDGER, 'utf8'))
    : YAML.parseDocument(fs.readFileSync('scripts/ai/ledger-header.yaml', 'utf8'));
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  doc.contents.flow = false;
  doc.set(key, doc.createNode(rec));
  doc.contents.items.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  fs.writeFileSync(LEDGER, doc.toString({ lineWidth: 0 }));
}

// ---- one paper -----------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const factId = (key, x) => `${key}-${crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 8)}`;
async function analyze(key) {
  const text = fs.readFileSync(`cache/fulltext/${key}.txt`, 'utf8');
  const locate = locator(text);
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const saved = REPLAY ? JSON.parse(fs.readFileSync(`${RAW_DIR}/${key}.json`, 'utf8')) : null;
  const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const ex = saved ? { json: saved.extraction, usage: none, model: saved.model } : await call({
    system: [
      { type: 'text', text: INSTRUCTIONS },
      { type: 'text', text: catalogue, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    user: userPrompt(key, text),
    schema: EXTRACT_SCHEMA,
    effort: EFFORT,
    maxTokens: 64000,
  });
  const out = ex.json;

  // triage (scripts/lib/ai-facts.mjs)
  const review = [], auto = [];
  let nDropped = 0;
  out.facts.forEach((f) => {
    const t = triage(f, locate);
    if (t.action === 'drop') { nDropped++; return; }
    const item = { id: factId(key, t.e ?? f), f, e: t.e, reasons: t.reasons };
    (t.action === 'auto' ? auto : review).push(item);
  });

  // independent verification of the facts that would be published; verdicts are
  // saved by fact id, so that --replay reuses them
  const verdicts = { ...(saved?.verdicts || {}) };
  const ask = auto.filter((it) => !verdicts[it.id]);
  let verify = null;
  if (ask.length) {
    const blocks = ask.map(({ f, e }, j) => {
      const ids = [e.from, e.to, e.statement, e.base].filter(Boolean);
      const meaning = e.property ? `Property ${e.property}: ${squash(raw.properties.find((p) => p.id === e.property)?.description, 500)}`
        : e.over ? `Reduction ${e.over}: ${rmap.get(e.over)?.name}` : `Formula class ${e.class}`;
      return [
        `## Candidate ${j}`,
        `Fact: ${JSON.stringify(e)}`,
        `Paper location: ${f.loc}. Origin: ${f.origin}.${f.argument ? ` Argument: ${f.argument}` : ''}${f.paperNotation ? ` Paper notation: ${f.paperNotation}.` : ''}`,
        `Quote: "${f.quote}"`,
        'Catalogue definitions:', ...ids.map((id) => `- ${describe(id)}`), meaning,
        'Excerpts of the paper:', ...excerpts(text, locate, f).map((x) => `<excerpt>\n${x}\n</excerpt>`),
      ].join('\n');
    });
    verify = await call({
      system: VERIFY,
      user: `Paper [${key}]: "${raw.references[key].title}".\n\n${blocks.join('\n\n')}\n\nGive one verdict per candidate (index = candidate number).`,
      schema: VERIFY_SCHEMA,
      effort: 'high',
      maxTokens: 32000,
    });
    const byIndex = new Map(verify.json.verdicts.map((v) => [v.index, v]));
    ask.forEach((it, j) => {
      const v = byIndex.get(j);
      if (v) verdicts[it.id] = { verdict: v.verdict, reason: v.reason };
    });
  }
  for (let j = auto.length - 1; j >= 0; j--) {
    const v = verdicts[auto[j].id] || { verdict: 'unsure', reason: 'no verdict returned' };
    auto[j].verifier = v;
    if (v.verdict !== 'confirmed') {
      auto[j].reasons.push(`verifier: ${v.verdict}`);
      review.push(...auto.splice(j, 1));
    }
  }
  fs.writeFileSync(`${RAW_DIR}/${key}.json`, JSON.stringify({ key, date: saved?.date ?? today, model: ex.model, hash, extraction: out, verdicts }, null, 1));

  return serial(() => {
    // publish the confirmed facts, then check that the database is still consistent
    const spec = {};
    for (const { f, e } of auto) {
      if (f.origin === 'stated') (spec[key] ||= []).push({ ...e, loc: f.loc });
      else {
        (spec._ai ||= []).push({
          ...e,
          justification: { kind: 'restriction', by: 'ai', text: `${f.argument} (Special case of ${f.loc} of [@${key}].)` },
        });
      }
    }
    let added = [];
    if (auto.length) {
      const res = addResults(spec);
      try {
        execFileSync('node', ['scripts/build.mjs', '--check'], { stdio: 'pipe' });
        added = res.changes.filter((c) => c.action === 'added' || c.action === 'merged').map((c) => `${c.action}: ${c.key}`);
      } catch (err) {
        res.restore();
        const msg = squash(String(err.stdout || '') + String(err.stderr || ''), 400);
        for (const it of auto) { it.reasons.push(`npm run check failed once added: ${msg}`); review.push(it); }
        auto.length = 0;
      }
    }
    const items = review.map(({ id, f, e, reasons, verifier }) => ({
      id, ref: key, date: today, status: 'pending', kind: 'result',
      result: e, loc: f.loc, origin: f.origin, quote: f.quote,
      ...(f.paperNotation ? { paperNotation: f.paperNotation } : {}),
      ...(f.argument ? { argument: f.argument } : {}),
      ...(f.citedFrom ? { citedFrom: f.citedFrom } : {}),
      confidence: f.confidence,
      ...(f.concerns ? { concerns: f.concerns } : {}),
      ...(verifier ? { verifier } : {}),
      reasons,
    }));
    out.missingStatements.forEach((m) => items.push({
      id: factId(key, m.notation), ref: key, date: today, status: 'pending', kind: 'statement',
      statement: m, reasons: ['principle not in the catalogue'],
    }));
    appendReview(key, items);
    const u = { input: ex.usage.input + (verify?.usage.input || 0), output: ex.usage.output + (verify?.usage.output || 0), cacheRead: ex.usage.cacheRead + (verify?.usage.cacheRead || 0), cacheWrite: ex.usage.cacheWrite + (verify?.usage.cacheWrite || 0) };
    const changes = [...new Set([...(ledger[key]?.changes || []), ...added])]; // keep earlier changes (--redo, --replay)
    writeLedger(key, {
      date: today, model: ex.model, textHash: hash,
      facts: out.facts.length, added: changes.length, review: items.length, dropped: nDropped,
      ...(changes.length ? { changes } : {}),
      cost: REPLAY ? ledger[key]?.cost ?? 0 : Number(cost(u).toFixed(2)),
    });
    console.log(`${key}: ${out.facts.length} facts → ${added.length} added, ${items.length} to review, ${nDropped} already known ($${cost(u).toFixed(2)})`);
  });
}

// ---- run -------------------------------------------------------------------------
console.log(`${papers.length} papers to analyze with ${MODEL} (effort ${EFFORT}, ${CONCURRENCY} at a time).`);
const failures = [];
let next = 0, stop = false;
async function worker() {
  while (!stop && next < papers.length) {
    const key = papers[next++];
    try {
      await analyze(key);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        console.error(`Authentication failed: set ANTHROPIC_API_KEY (or run \`ant auth login\`). ${err.message}`);
        stop = true;
      } else if (err instanceof Anthropic.RateLimitError) {
        console.error(`Rate limited after retries; stopping. Run again later: analyzed papers are skipped.`);
        stop = true;
      } else {
        const why = err instanceof Anthropic.APIError ? `API error ${err.status}: ${err.message}` : err.message;
        console.error(`${key}: failed (${why})`);
      }
      failures.push(key);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
await writing;
console.log(`Done. Tokens: ${usage.input} input, ${usage.cacheRead} cache read, ${usage.cacheWrite} cache write, ${usage.output} output (≈ $${cost(usage).toFixed(2)}).`);
if (failures.length) console.log(`Not analyzed (run again to retry): ${failures.join(', ')}`);
console.log(`Pending human review: ${REVIEW} (node scripts/ai-review.mjs).`);
