// Consolidation procedure for the database: run it regularly.
//
//   npm run consolidate [-- --since YYYY-MM-DD] [--skip sweep,pubstatus,texts,mine,statements,questions]
//
// Steps (each reports to reports/consolidation-<date>.md):
//  1. sweep       new papers from zbMATH Open and arXiv since the last run;
//                 papers clearly on topic are added, borderline ones listed.
//  2. pubstatus   preprints that have since been published (arXiv journal
//                 references, Crossref exact-title matches): venue/DOI/year updated.
//  3. texts       abstracts, full texts (arXiv, open access, Zotero) and
//                 abstracts with formulas from PDFs for papers that lack them;
//                 cached texts checked against their titles.
//  4. mine        candidate results and open questions in the texts cached since
//                 the last run, for reading.
//  4b. ai         only with --ai (costs API tokens): scripts/ai-analyze.mjs reads the
//                 cached texts not yet analyzed, most important first (all of them, or
//                 up to --ai-budget dollars, with the model --ai-model, default opus);
//                 reliable facts are added, the others queued for review (data/review.yaml).
//  5. statements  definitions still flagged "to check" (with the cached texts that
//                 should settle them) and acronyms frequent in the literature but
//                 absent from the catalogue (candidate missing statements).
//  6. questions   questions whose status changed since the last run (formal
//                 questions are re-derived from the database) and leads for the
//                 others: recent papers that cite the asking paper next to
//                 "question", "answer", "solve", "conjecture".
//  7. check       build validation and tests.
// Automatic changes are limited to bibliographic data (new references,
// publication status, abstracts, texts), and, with --ai, to the results that pass
// every check of scripts/ai-analyze.mjs. Other results, questions and definitions
// are only proposed: the report lists them with the passages to read, they are
// queued on the review page of the viewer (data/review.yaml, docs/REVIEW.md), and
// they are entered by hand (or by an AI assistant, marked as such) after reading.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { acquireLock } from './lib/lock.mjs';
import { cli } from './lib/cli.mjs';
import { addToQueue } from './lib/review-queue.mjs';
import crypto from 'node:crypto';
const opts = cli('npm run consolidate [-- --since YYYY-MM-DD] [--skip sweep,pubstatus,texts,mine,statements,questions] [--ai [--ai-budget DOLLARS] [--ai-model haiku|sonnet|opus]]', { '--since': 1, '--skip': 1, '--ai': 0, '--ai-budget': 1, '--ai-model': 1 });
acquireLock('consolidate.mjs');

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const skip = new Set(arg('--skip', '').split(',').filter(Boolean));
const STEPS = ['sweep', 'pubstatus', 'texts', 'mine', 'statements', 'questions'];
for (const k of skip) if (!STEPS.includes(k)) { console.error(`unknown step "${k}" in --skip (steps: ${STEPS.join(', ')})`); process.exit(1); }
const STATE = 'cache/consolidation-state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const since = arg('--since', state.lastRun || new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10));
fs.mkdirSync('cache', { recursive: true });
fs.mkdirSync('reports', { recursive: true });
const report = [`# Consolidation report, ${today}`, '', `Changes since ${since}. Automatic changes are bibliographic; everything under "To read" needs a reader.`, ''];
const say = (...lines) => { for (const s of lines.length ? lines : ['']) { report.push(s); console.log(s); } };
const run = (cmd, a, opts = {}) => {
  try { return execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
  catch (e) { return (e.stdout || '') + (e.stderr || '') + `\n(exit ${e.status})`; }
};
const node = (script, a = []) => run('node', [script, ...a]);
const loadRefs = () => Object.assign({}, ...fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml')).map((f) => YAML.parse(fs.readFileSync('data/references/' + f, 'utf8'))));
const short = (k, refs) => { const r = refs[k]; if (!r) return k; const a = (r.authors || []).map((x) => String(x).split(' ').pop()); return `${a.length > 3 ? a[0] + ' et al.' : a.join(', ')} ${r.year} (\`${k}\`)`; };
const keysBefore = new Set(Object.keys(loadRefs()));
// candidates for a reader also go to the review queue (data/review.yaml, the review
// page of the viewer; docs/REVIEW.md); an item already queued or decided is not added again
const queued = [];
const qid = (kind, ...parts) => `${kind}-${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8)}`;

// 1. sweep
if (!skip.has('sweep')) {
  say('## 1. New papers');
  node('scripts/sweep.mjs', ['--since', since, '--add', '--out', 'cache/sweep-last.json']);
  const s = JSON.parse(fs.readFileSync('cache/sweep-last.json', 'utf8'));
  const refs = loadRefs();
  say(`${s.found} documents found on zbMATH Open and arXiv since ${since}; ${s.added.length} new papers added (data/references/sweep-*.yaml).`);
  for (const k of s.added) say(`- added: ${short(k, refs)} — ${refs[k].title}`);
  if (s.review.length) {
    say('', `**To read** — ${s.review.length} relevant but borderline papers (add them to a references file if they belong to the zoo):`);
    for (const x of s.review.slice(0, 80)) say(`- ${x.year} ${x.title} — ${(x.authors || []).join(', ')}${x.doi ? ` doi:${x.doi}` : ''}${x.arxiv ? ` arXiv:${x.arxiv}` : ''}`);
    for (const x of s.review) queued.push({ id: qid('paper', x.doi || x.arxiv || x.title), kind: 'paper', status: 'pending', date: today,
      paper: { title: x.title, authors: x.authors || [], year: x.year, ...(x.venue ? { venue: x.venue } : {}), ...(x.doi ? { doi: x.doi } : {}), ...(x.arxiv ? { arxiv: String(x.arxiv) } : {}) },
      reasons: ['sweep: on topic by its abstract, not clearly by its title'] });
  }
  say();
}
// 2. publication status
if (!skip.has('pubstatus')) {
  say('## 2. Publication status');
  const out = run('node', ['scripts/pubstatus.mjs', '--apply']).trim();
  const lines = out.split('\n').filter((l) => l.includes('→'));
  say(lines.length ? `${lines.length} preprints are now published (updated):` : 'No preprint newly published.');
  lines.forEach((l) => say(`- ${l}`));
  say();
}
// 3. texts
const refsNow = loadRefs();
const newKeys = Object.keys(refsNow).filter((k) => !keysBefore.has(k));
if (!skip.has('texts')) {
  say('## 3. Abstracts and full texts');
  const idx0 = fs.existsSync('cache/fulltext/index.json') ? Object.keys(JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8'))).length : 0;
  run('node', ['scripts/abstracts.mjs']);
  run('node', ['scripts/fulltext.mjs', '--zotero', '--download']);
  run('node', ['scripts/pdf-abstracts.mjs']);
  const idx = JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8'));
  say(`${Object.keys(idx).length - idx0} new full texts cached (${Object.keys(idx).length} in total).`);
  // texts that do not look like their paper
  const W = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\\[a-z]+/g, ' ').match(/[a-z]{4,}/g) || [];
  const bad = Object.keys(idx).filter((k) => refsNow[k] && fs.existsSync(`cache/fulltext/${k}.txt`)).filter((k) => {
    const head = new Set(W(fs.readFileSync(`cache/fulltext/${k}.txt`, 'utf8').slice(0, 4000))); const t = [...new Set(W(refsNow[k].title))];
    return t.length >= 2 && t.filter((w) => head.has(w)).length / t.length < 0.6;
  });
  if (bad.length) { say('', `**To check** — ${bad.length} cached texts whose first page does not match the title (wrong file?):`); bad.forEach((k) => say(`- ${short(k, refsNow)}: ${refsNow[k].title}`)); }
  say();
}
// 4. mining
if (!skip.has('mine')) {
  say('## 4. Candidate results and questions');
  say('_Leads already examined are listed in data/screened.yaml and not shown; add the key (`refkey|Theorem 2.6`, `refkey|Question 9.1`) of each lead you examine._', '');
  run('node', ['scripts/build.mjs']);
  run('node', ['scripts/mine/facts.mjs', '--since', since, '--out', 'cache/mine-facts.json']);
  run('node', ['scripts/mine/questions.mjs', '--since', since, '--out', 'cache/mine-questions.json']);
  const facts = JSON.parse(fs.readFileSync('cache/mine-facts.json', 'utf8'));
  const qs = JSON.parse(fs.readFileSync('cache/mine-questions.json', 'utf8'));
  say(`**To read** — ${facts.length} theorems in recently cached texts mention statements whose relation is open in the database:`);
  for (const c of facts.slice(0, 150)) say(`- ${short(c.ref, refsNow)}, ${c.where} [${c.over}; open: ${c.open.join(' ')}]: ${c.body.slice(0, 220).replace(/\n/g, ' ')}`);
  for (const c of facts) queued.push({ id: qid('lead', c.ref, c.where), kind: 'lead', status: 'pending', date: today, ref: c.ref, loc: c.where,
    over: c.over, open: c.open, text: c.body.slice(0, 1500), reasons: ['regex miner: the theorem names statements whose relation is open'] });
  for (const c of qs) queued.push({ id: qid('question', c.ref, c.where), kind: 'question', status: 'pending', date: today, ref: c.ref, loc: c.where,
    ...(c.statements.length ? { statements: c.statements } : {}), text: c.body.slice(0, 1500), reasons: ['regex miner: a numbered question not in data/questions.yaml'] });
  say('', `**To read** — ${qs.length} numbered questions or conjectures not yet in data/questions.yaml:`);
  for (const c of qs.slice(0, 150)) say(`- ${short(c.ref, refsNow)}, ${c.where}${c.statements.length ? ` [${c.statements.join(', ')}]` : ''}: ${c.body.slice(0, 220).replace(/\n/g, ' ')}`);
  say();
}
// 4b. AI reading of the texts not yet analyzed (opt-in: it costs API tokens)
if (args.includes('--ai')) {
  say('## 4b. AI reading of the full texts');
  const out = run('node', ['scripts/ai-analyze.mjs', ...(opts.has('--ai-budget') ? ['--budget', opts.get('--ai-budget')] : []),
    ...(opts.has('--ai-model') ? ['--model', opts.get('--ai-model')] : [])]);
  const lines = out.split('\n').filter((l) => /facts →|failed|Authentication|Rate limited|Done\./.test(l));
  lines.forEach((l) => say(`- ${l}`));
  const review = fs.existsSync('data/review.yaml') ? YAML.parse(fs.readFileSync('data/review.yaml', 'utf8')) || [] : [];
  const pending = review.filter((x) => x.status === 'pending' && ['result', 'statement'].includes(x.kind)).length;
  say('', `**To decide** — ${pending} AI proposals pending on the review page (data/review.yaml, \`node scripts/review.mjs list\`).`, '');
}
// 5. statements
if (!skip.has('statements')) {
  say('## 5. Statements');
  const zoo = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  const idx = JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8'));
  const flagged = zoo.statements.filter((s) => s.todo);
  if (flagged.length) {
    say(`**To check** — ${flagged.length} definitions flagged "to check"; the cached texts listed should settle them:`);
    for (const s of flagged) {
      const papers = [...new Set([...(s.refs || []).map((r) => r.ref), ...zoo.results.filter((r) => [r.from, r.to, r.statement].includes(s.id)).flatMap((r) => (r.refs || []).map((x) => x.ref))])];
      const cached = papers.filter((k) => idx[k]);
      say(`- \`${s.id}\` (${s.name}): ${cached.length ? 'read ' + cached.map((k) => short(k, refsNow)).join(', ') : 'no cached source text' + (papers.length ? ` (sources: ${papers.join(', ')})` : '')}`);
    }
  } else say('No definition is flagged "to check".');
  // acronyms common in the literature but unknown to the catalogue
  const known = new Set(zoo.statements.flatMap((s) => [s.label, ...(s.aliases || []), s.id].map((l) => String(l)
    .replace(/\\(mathsf|mathrm|text|mathbf)\{([^}]*)\}/g, '$2').replace(/\\mathbb\{?([A-Z])\}?/g, '$1').replace(/<\\?infty/g, '').replace(/[\\{}^_$\s-]/g, '').toUpperCase())));
  // notation and theory names that are not principles of the zoo
  const STOP = new Set(('PDF ARXIV LNCS THE AND FOR WITH THIS THAT ZFC ZF PA HA AMS MSC JSL APAL MLQ BSL CIE CCA DOI ISBN URL II III IV VI PRA HYP KP ID IΣ BΣ IFF '
    + 'RCA ACA ATR WKL WWKL CA CA0 AC AC0 NN IND QF TI TR TR0 BI DC LEM MP RFN FX CK TC EA EFA HA0 PA0 KB WO WF').split(' '));
  // acronyms already examined and deliberately left out (data/acronyms-ignored.yaml)
  const ignored = fs.existsSync('data/acronyms-ignored.yaml') ? YAML.parse(fs.readFileSync('data/acronyms-ignored.yaml', 'utf8')) || {} : {};
  for (const a of Object.keys(ignored)) STOP.add(a.toUpperCase());
  const freq = new Map();
  for (const k of Object.keys(idx)) {
    if (!fs.existsSync(`cache/fulltext/${k}.txt`)) continue;
    const t = fs.readFileSync(`cache/fulltext/${k}.txt`, 'utf8');
    for (const a of new Set((t.match(/\b[A-Z][A-Z]{1,7}(?:[0-9]{0,3})\b/g) || []))) {
      const n = a.toUpperCase();
      if (STOP.has(n) || known.has(n) || /^[A-Z]$/.test(n) || /^(?:[IVXLC]+)$/.test(n)) continue;
      // must be used as a principle: next to "implies", "proves", "≤W", "is equivalent"
      if (!new RegExp(`${a}\\s*(?:implies|proves|is equivalent|≤|<W|≡|does not imply|\\+)|(?:implies|proves|≤W?|⊢)\\s*${a}\\b`).test(t)) continue;
      freq.set(n, (freq.get(n) || new Set()).add(k));
    }
  }
  const top = [...freq.entries()].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 40);
  if (top.length) {
    say('', `**To consider** — principles used in at least three papers but not in the catalogue (by acronym; many are false positives). Add each one you decide not to add, with the reason, to data/acronyms-ignored.yaml:`);
    for (const [a, s] of top) say(`- ${a}: ${s.size} papers, e.g. ${[...s].slice(0, 3).join(', ')}`);
  }
  say();
}
// 6. questions
if (!skip.has('questions')) {
  say('## 6. Open questions');
  run('node', ['scripts/build.mjs']);
  const { buildZoo, questionStatus } = await import('../site/js/engine.js');
  const raw = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  const zz = buildZoo(raw);
  const now = Object.fromEntries((raw.questions || []).map((q) => [q.id, questionStatus(zz, q).status]));
  const changed = Object.entries(now).filter(([id, s]) => state.questions && state.questions[id] && state.questions[id] !== s);
  say(changed.length ? `${changed.length} questions changed status since the last run:` : 'No question changed status since the last run.');
  for (const [id, s] of changed) say(`- \`${id}\`: ${state.questions[id]} → ${s}`);
  // leads: recent texts citing the asking paper next to question/answer words
  const idx = JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8'));
  const recent = Object.keys(idx).filter((k) => (idx[k].date || '') >= since && fs.existsSync(`cache/fulltext/${k}.txt`));
  const screenedRes = new Set((fs.existsSync('data/screened.yaml') ? YAML.parse(fs.readFileSync('data/screened.yaml', 'utf8')) || {} : {}).resolutions || []);
  const leads = [];
  for (const q of raw.questions || []) {
    if (now[q.id] === 'resolved') continue;
    for (const a of q.asked) {
      const r = raw.references[a.ref]; if (!r) continue;
      const author = String(r.authors?.[0] || '').split(' ').pop();
      const num = String(a.loc || '').match(/\d+(?:\.\d+)*/)?.[0];
      for (const k of recent) {
        if (k === a.ref || (raw.references[k]?.year || 0) < (r.year || 0)) continue;
        if (screenedRes.has(`${q.id}|${k}`)) continue;
        const t = fs.readFileSync(`cache/fulltext/${k}.txt`, 'utf8').replace(/\s+/g, ' ');
        const re = new RegExp(`${author}[^.]{0,120}(question|problem|conjecture)${num ? `[^.]{0,40}${num.replace(/\./g, '\\.')}` : ''}|(answer|solv|settl|refut|confirm)[a-z]*[^.]{0,80}(question|problem|conjecture)[^.]{0,80}${author}`, 'i');
        const m = t.match(re);
        if (m) {
          leads.push(`- \`${q.id}\` (asked in ${short(a.ref, raw.references)}${a.loc ? ', ' + a.loc : ''}): ${short(k, raw.references)} — "…${t.slice(Math.max(0, m.index - 60), m.index + 200)}…"`);
          queued.push({ id: qid('answer', q.id, k), kind: 'answer', status: 'pending', date: today, question: q.id, ref: k,
            text: `…${t.slice(Math.max(0, m.index - 300), m.index + 500)}…`, reasons: [`the passage names ${author} next to a question word`] });
        }
      }
    }
  }
  if (leads.length) { say('', `**To read** — ${leads.length} passages of recent papers that may answer open questions (once examined, add \`question-id|refkey\` to data/screened.yaml):`); leads.slice(0, 100).forEach((l) => say(l)); }
  state.questions = now;
  say();
}
// the review queue (needs the lock, taken above)
if (queued.length) {
  const n = addToQueue(queued);
  say('## Review page', `${n} new item${n === 1 ? '' : 's'} added to the review queue (data/review.yaml; ${queued.length - n} were already there or decided).`,
    'They are shown on the review page of the viewer after `npm run build` and the deployment; `node scripts/review.mjs list`.', '');
}
// 7. checks
say('## 7. Checks');
const check = run('node', ['scripts/build.mjs', '--check']).trim().split('\n').filter((l) => !l.startsWith('!')).slice(-3);
check.forEach((l) => say(`    ${l}`));
const tests = run('npm', ['test', '--silent']).match(/# (pass|fail) \d+/g) || [];
say(`    tests: ${tests.join(', ')}`);

state.lastRun = today;
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
fs.writeFileSync(`reports/consolidation-${today}.md`, report.join('\n') + '\n');
console.log(`\nReport written to reports/consolidation-${today}.md`);
