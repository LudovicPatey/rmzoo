// AI analysis of the full texts: Claude reads each cached paper once, in full,
// and lists every fact it proves about catalogue statements, however it is worded
// ("every computable instance has a solution not computing C" is cone avoidance),
// plus immediate deductions (special cases of a stated theorem). This complements
// the regex miners of scripts/mine/, which only see results phrased in the usual
// notation.
//
//   node scripts/ai-analyze.mjs [--only key1,key2] [--part 1,2] [--since YYYY-MM-DD] [--limit N] [--budget DOLLARS]
//                               [--redo] [--replay] [--dry-run] [--concurrency N] [--effort level]
//
// Papers are read in decreasing order of importance (scripts/lib/paper-rank.mjs:
// open leads, theorems about catalogue statements, papers defining them, minus
// what the database already cites), so that a limited budget goes to the papers
// most likely to bring new facts. Texts too short to be usable (failed
// extraction, scanned PDF) are skipped. Texts longer than 400,000 characters
// (books, theses) are read in parts of at most 250,000 characters, whole chapters
// when the text has chapter headings (scripts/lib/split-text.mjs): a whole book
// does not fit in one call, or leaves too little room for the answer.
//
//   --only      analyze these references only
//   --part      only these parts of long texts (with --only: e.g. one chapter of a book)
//   --since     only texts cached since this date (cache/fulltext/index.json)
//   --limit     at most N papers (or parts of long texts) in this run
//   --budget    stop before the estimated cost of the run exceeds this many dollars
//   --redo      analyze again papers already in data/ai-analyzed.yaml
//   --replay    no new reading: process again the saved answers (cache/ai/<key>.json),
//               e.g. after the catalogue or these rules changed; only facts never
//               verified cost a (small) verification call
//   --dry-run   no API call, no data change: list the papers in order with their
//               score and estimated cost, write the full ranking to
//               reports/ai-priority.md and the prompt of the first paper to
//               cache/ai/<key>.prompt.txt
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
//  * otherwise written to the review queue, data/review.yaml, with the reasons:
//    shown on the review page of the viewer, treated with scripts/review.mjs.
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
import { rankPapers } from './lib/paper-rank.mjs';
import { splitText } from './lib/split-text.mjs';
import { addToQueue, QUEUE } from './lib/review-queue.mjs';
import { buildZoo } from '../site/js/engine.js';

const USAGE = 'node scripts/ai-analyze.mjs [--only key1,key2] [--part 1,2] [--since YYYY-MM-DD] [--limit N] [--budget DOLLARS] [--redo] [--replay] [--dry-run] [--concurrency N] [--effort low|medium|high|xhigh|max]';
const args = cli(USAGE, { '--only': 1, '--part': 1, '--since': 1, '--limit': 1, '--budget': 1, '--redo': 0, '--replay': 0, '--dry-run': 0, '--concurrency': 1, '--effort': 1 });
const DRY = args.has('--dry-run');
const REPLAY = args.has('--replay');
const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 }; // $ per million tokens (cache write: 1-hour TTL)
const EFFORT = args.get('--effort', 'high');
const CONCURRENCY = Number(args.get('--concurrency', 2));
const LEDGER = 'data/ai-analyzed.yaml';
const REVIEW = QUEUE;
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
  ...plain.map((s) => `- ${s.id} | ${s.label} | ${s.name || ''} | ${s.kind}${s.aliases?.length ? ' | ' + s.aliases.join(', ') : ''}\n  ${squash(s.definition, 500)}${s.instance ? `\n  Instance: ${squash(s.instance, 200)} Solution: ${squash(s.solution, 200)}` : ''}${s.caution ? `\n  Caution: ${squash(s.caution.replace(/\[\[([^\]]+)\]\]/g, '$1'), 300)}` : ''}`),
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
// Long texts (books, theses) are read in parts (scripts/lib/split-text.mjs): each
// part is a unit of work with its own ledger entry "<key>#<n>" and saved answer
// cache/ai/<key>.part<n>.json. A paper analyzed whole earlier is not read again in parts.
const partsOf = new Map();
const partsOfPaper = (k) => partsOf.get(k) || partsOf.set(k, splitText(fs.readFileSync(`cache/fulltext/${k}.txt`, 'utf8'))).get(k);
const unitId = (k, p) => (p.of > 1 ? `${k}#${p.n}` : k);
const unitFile = (k, p) => `${RAW_DIR}/${p.of > 1 ? `${k}.part${p.n}` : k}.json`;
const onlyParts = args.has('--part') ? new Set(args.get('--part').split(',').map(Number)) : null;
const todo = (k) => (!REPLAY && !args.has('--redo') && ledger[k] ? [] : partsOfPaper(k).filter((p) => (!onlyParts || onlyParts.has(p.n))
  && (REPLAY ? fs.existsSync(unitFile(k, p)) : args.has('--redo') || !ledger[unitId(k, p)])));
let papers = Object.keys(raw.references).sort()
  .filter((k) => fs.existsSync(`cache/fulltext/${k}.txt`))
  .filter((k) => !only || only.has(k))
  .filter((k) => !since || (index[k]?.date || '') >= since)
  .filter((k) => todo(k).length);
if (only) for (const k of only) if (!raw.references[k]) console.error(`unknown reference ${k}`);
// usable texts only, most important first
const MIN_CHARS = 3000;
const unusable = papers.filter((k) => fs.statSync(`cache/fulltext/${k}.txt`).size < MIN_CHARS);
if (unusable.length) console.warn(`! skipped, text too short to be usable (failed extraction or scanned PDF): ${unusable.join(', ')}`);
// units of work: the papers most important first, each in its parts
const ranking = rankPapers(papers.filter((k) => !unusable.includes(k)))
  .flatMap((x) => todo(x.key).map((part) => ({ ...x, part, uid: unitId(x.key, part), file: unitFile(x.key, part), chars: part.text.length })));
papers = ranking.map((x) => x.uid);

// Texts read by OCR from a scan (scripts/fulltext.mjs) lose most sub- and
// superscripts: the model is told so for those papers.
const OCR_NOTE = `\n\nThis text was obtained by OCR of a scanned paper: formulas are approximate. Sub- and superscripts are merged or misread
("RT3", "RTS", "RTZ" or "RT?" may all be RT²₂; "SRT3" may be SRT²₂; "RCAg", "RCAp" or "RCAo" is RCA₀; "IX2", "I%2" or "IE2" is IΣ₂;
"w-model" is ω-model; "AS" or "A9" may be Δ⁰₂; "II}" may be Π¹₁). Identify each principle from its definition in the text, never
from the OCR'd name alone, and give confidence "high" only when the definition settles it. Quotes must still be copied from the
text as given (with its OCR errors).`;
// a part of a long text: the model is told what it reads, and that notation may
// have been introduced in other parts
const partNote = (p) => (p.of > 1 ? `\n\nThis long text is read in ${p.of} parts, separately; this is part ${p.n} (${p.title}). Extract the facts
proved or stated in this part only. Notation and principles may have been defined in other parts: identify them from the
catalogue and from what this part says, and lower your confidence when the definition is not in this part. Give theorem
numbers as printed. List as missing statements only principles defined in this part.` : '');
const userPrompt = (key, text, part = { of: 1 }) => {
  const r = raw.references[key];
  return `Paper [${key}]: ${(r.authors || []).join(', ')}, "${r.title}", ${r.year}.${index[key]?.ocr ? OCR_NOTE : ''}${partNote(part)}\n\n<paper>\n${text}\n</paper>\n\nExtract the facts of this ${part.of > 1 ? 'part' : 'paper'} as instructed.`;
};
const estTokens = (s) => Math.round(s.length / 3.3);
// estimated cost of one paper: its text, the cached catalogue, ~15k output and
// thinking tokens (the verification call is small)
const catTokens = estTokens(INSTRUCTIONS + catalogue);
const estCost = (x) => (estTokens({ length: x.chars }) * PRICE.input + catTokens * PRICE.cacheRead + 15000 * PRICE.output) / 1e6;
{
  let sum = 0;
  for (const x of ranking) { x.cost = estCost(x); sum += x.cost; x.cumulative = sum; }
}
if (!REPLAY && args.has('--budget')) {
  const budget = Number(args.get('--budget'));
  papers = ranking.filter((x) => x.cumulative <= budget).map((x) => x.uid);
}
if (args.has('--limit')) papers = papers.slice(0, Number(args.get('--limit')));

if (DRY) {
  const total = ranking.filter((x) => papers.includes(x.uid)).reduce((s, x) => s + x.cost, 0);
  const all = ranking.at(-1)?.cumulative || 0;
  const nPapers = (list) => new Set(list.map((u) => u.split('#')[0])).size;
  console.log(`${nPapers(papers)} papers (${papers.length} units: long texts are read in parts) in this run, estimated $${total.toFixed(0)} (all ${nPapers(ranking.map((x) => x.uid))} papers to analyze: about $${all.toFixed(0)}; ~15k output and thinking tokens assumed per unit).`);
  // the full ranking, to choose a budget
  const yr = (k) => raw.references[k]?.year || '';
  const row = (x, i) => `| ${i + 1} | ${x.uid}${x.part.of > 1 ? ` (${x.part.title})` : ''} | ${yr(x.key)} | ${x.score} | ${x.leads} | ${x.property} | ${x.theorems} | ${x.defines} | ${x.covered} | $${x.cost.toFixed(2)} | $${x.cumulative.toFixed(0)} |`;
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/ai-priority.md', `# Papers for the AI reader, most important first

`
    + `Generated by \`node scripts/ai-analyze.mjs --dry-run\` on ${new Date().toISOString().slice(0, 10)}: ${ranking.length} papers or parts of long texts not yet analyzed.
`
    + `Score (scripts/lib/paper-rank.mjs) = (4·leads + 2·property + theorems + 3·defines + 2·log2(1 + breadth)) / (1 + covered/10).
`
    + `leads: theorems naming two catalogue statements whose relation is open; property: theorems naming a statement with a
`
    + `computability or reduction phrase; theorems: numbered statements naming a catalogue statement; defines: catalogue
`
    + `statements this paper introduced or analysed; covered: results already citing it. Run the first N with
`
    + `\`--limit N\`, or up to a budget with \`--budget DOLLARS\` (the last column).

`
    + (unusable.length ? `Skipped (text too short to be usable): ${unusable.join(', ')}.

` : '')
    + `| # | paper | year | score | leads | property | theorems | defines | covered | cost | cumulative |
|---|---|---|---|---|---|---|---|---|---|---|
`
    + ranking.map(row).join('\n') + '\n');
  console.log('Full ranking with costs: reports/ai-priority.md');
  console.log('   #  paper                               year  score   cost   cumulative');
  for (const [i, x] of ranking.slice(0, 30).entries())
    console.log(`${String(i + 1).padStart(4)}  ${x.uid.padEnd(36)}${String(yr(x.key)).padEnd(6)}${String(x.score).padStart(6)}  $${x.cost.toFixed(2).padStart(5)}  $${x.cumulative.toFixed(0).padStart(4)}${papers.includes(x.uid) ? '' : '  (not in this run)'}`);
  if (ranking.length > 30) console.log(`  … ${ranking.length - 30} more in reports/ai-priority.md`);
  if (papers.length) {
    const u = ranking.find((x) => x.uid === papers[0]);
    const file = u.file.replace(/\.json$/, '.prompt.txt');
    fs.writeFileSync(file, `${INSTRUCTIONS}\n\n${catalogue}\n\n---- user ----\n${userPrompt(u.key, u.part.text, u.part)}`);
    console.log(`Prompt of ${u.uid} written to ${file}.`);
  }
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
async function analyze(unit) {
  const { key, part, uid } = unit;
  const text = part.text;
  const partLabel = part.of > 1 ? `${part.n}/${part.of} (${part.title})` : null;
  const locate = locator(text);
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const saved = REPLAY ? JSON.parse(fs.readFileSync(unit.file, 'utf8')) : null;
  const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const ex = saved ? { json: saved.extraction, usage: none, model: saved.model } : await call({
    system: [
      { type: 'text', text: INSTRUCTIONS },
      { type: 'text', text: catalogue, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    user: userPrompt(key, text, part),
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
  fs.writeFileSync(unit.file, JSON.stringify({ key, ...(partLabel ? { part: partLabel } : {}), date: saved?.date ?? today, model: ex.model, hash, extraction: out, verdicts }, null, 1));

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
      id, ref: key, ...(partLabel ? { part: partLabel } : {}), date: today, status: 'pending', kind: 'result',
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
      id: factId(key, m.notation), ref: key, ...(partLabel ? { part: partLabel } : {}), date: today, status: 'pending', kind: 'statement',
      statement: m, reasons: ['principle not in the catalogue'],
    }));
    // the pending proposals of this paper (or of this part) are replaced
    addToQueue(items, { replace: (n) => n.get('ref') === key && ['result', 'statement'].includes(n.get('kind'))
      && (partLabel ? String(n.get('part') || '').startsWith(`${part.n}/`) : !n.get('part')) });
    const u = { input: ex.usage.input + (verify?.usage.input || 0), output: ex.usage.output + (verify?.usage.output || 0), cacheRead: ex.usage.cacheRead + (verify?.usage.cacheRead || 0), cacheWrite: ex.usage.cacheWrite + (verify?.usage.cacheWrite || 0) };
    const changes = [...new Set([...(ledger[uid]?.changes || []), ...added])]; // keep earlier changes (--redo, --replay)
    writeLedger(uid, {
      date: today, model: ex.model, textHash: hash, ...(partLabel ? { part: partLabel } : {}),
      facts: out.facts.length, added: changes.length, review: items.length, dropped: nDropped,
      ...(changes.length ? { changes } : {}),
      cost: REPLAY ? ledger[uid]?.cost ?? 0 : Number(cost(u).toFixed(2)),
    });
    console.log(`${uid}: ${out.facts.length} facts → ${added.length} added, ${items.length} to review, ${nDropped} already known ($${cost(u).toFixed(2)})`);
  });
}

// ---- run -------------------------------------------------------------------------
console.log(`${papers.length} papers or parts to analyze with ${MODEL} (effort ${EFFORT}, ${CONCURRENCY} at a time).`);
const failures = [];
let next = 0, stop = false;
async function worker() {
  while (!stop && next < papers.length) {
    const uid = papers[next++];
    try {
      await analyze(ranking.find((x) => x.uid === uid));
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        console.error(`Authentication failed: set ANTHROPIC_API_KEY (or run \`ant auth login\`). ${err.message}`);
        stop = true;
      } else if (err instanceof Anthropic.RateLimitError) {
        console.error(`Rate limited after retries; stopping. Run again later: analyzed papers are skipped.`);
        stop = true;
      } else {
        const why = err instanceof Anthropic.APIError ? `API error ${err.status}: ${err.message}` : err.message;
        console.error(`${uid}: failed (${why})`);
      }
      failures.push(uid);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
await writing;
console.log(`Done. Tokens: ${usage.input} input, ${usage.cacheRead} cache read, ${usage.cacheWrite} cache write, ${usage.output} output (≈ $${cost(usage).toFixed(2)}).`);
if (failures.length) console.log(`Not analyzed (run again to retry): ${failures.join(', ')}`);
console.log(`Pending human review: ${REVIEW} (review page of the viewer, node scripts/review.mjs).`);
