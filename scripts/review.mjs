// The review queue, data/review.yaml (docs/REVIEW.md): proposals of the AI reader
// (scripts/ai-analyze.mjs) and candidates of the consolidation
// (scripts/consolidate.mjs), shown on the review page of the viewer until a
// decision. This is the maintainer's command line; votes and comments come from
// the live instance (scripts/endorsements-sync.mjs).
//
//   node scripts/review.mjs list [--all] [--ref key] [--kind k] [--voted]   pending items (or all)
//   node scripts/review.mjs show <id>                                       one item in full
//   node scripts/review.mjs apply [--dry-run]                               carry out the votes (below)
//   node scripts/review.mjs accept <id> [--ref key] [--loc "Theorem 3"] [--note text]
//   node scripts/review.mjs reject <id> --note "why"
//   node scripts/review.mjs done <id> --note "what was done by hand"
//
// accept (result items) writes the proposed `result` into data/results/ and runs
// the build check (undone if it fails):
//   origin stated        cites the analyzed paper at `loc`;
//   origin cited         needs --ref (and --loc): the work the paper attributes it to;
//   special-case/deduced goes to data/results/ai-derived.yaml with provenance: ai and
//                        the argument as justification.
// accept (paper items) adds the paper to data/references/sweep-<year>.yaml.
// Other kinds (statements, leads, questions, answers) are entered by hand
// (AGENTS.md), then marked `done`. Rejecting or closing a lead, question or answer
// also records it in data/screened.yaml, and rejecting a paper in
// data/sweep-rejected.yaml, so that the consolidation does not propose it again.
//
// apply: for every pending item, the outcome of the votes (site/js/review.js):
//   validated    result (stated, special case, deduced) and paper: accepted as above;
//                the others are listed, to be entered by hand;
//   invalidated  rejected, with the voters' names and comments as the note;
//   disputed     listed, for the maintainer to settle.
// Read the passage in the paper before accepting by hand (AGENTS.md, section 1). To
// correct a proposal (another statement id, reduction, theorem number), edit the
// item's `result`/`loc` in data/review.yaml first. Items are never deleted.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { cli } from './lib/cli.mjs';
import { acquireLock } from './lib/lock.mjs';
import { addResults } from './lib/results.mjs';
import { unknownFields } from './lib/schema.mjs';
import { readQueue, writeQueue, QUEUE } from './lib/review-queue.mjs';
import { reviewStatus, screenKey, KINDS } from '../site/js/review.js';

const USAGE = 'node scripts/review.mjs list [--all] [--ref key] [--kind k] [--voted] | show <id> | apply [--dry-run] | accept <id> [--ref key] [--loc text] [--note text] | reject <id> --note text | done <id> --note text';
const args = cli(USAGE, { '--all': 0, '--ref': 1, '--kind': 1, '--voted': 0, '--loc': 1, '--note': 1, '--dry-run': 0 });
const [cmd, id] = args.rest;
if (!fs.existsSync(QUEUE)) { console.log(`No review queue yet (${QUEUE}).`); process.exit(0); }
let doc = readQueue();
let items = doc.toJSON() || [];
const errs = items.flatMap((it, i) => unknownFields(it, 'review', `${QUEUE}[${i}]`));
if (errs.length) { errs.forEach((e) => console.error('✗ ' + e)); process.exit(1); }
const people = (fs.existsSync('data/endorsements.yaml') ? YAML.parse(fs.readFileSync('data/endorsements.yaml', 'utf8')) : {})?.people || {};
const who = (orcid) => people[orcid]?.name || orcid;

const what = (it) => ({
  result: () => `${JSON.stringify(it.result)} at ${it.loc} [${it.origin}, ${it.confidence}]`,
  statement: () => `missing statement ${it.statement.notation} (${it.statement.name})`,
  lead: () => `theorem to read: ${it.ref}, ${it.loc} [open: ${(it.open || []).join(' ')}]`,
  question: () => `question to record: ${it.ref}, ${it.loc}`,
  answer: () => `possible answer to ${it.question} in ${it.ref}`,
  paper: () => `paper to add: ${it.paper.title} (${it.paper.year})`,
}[it.kind]());
const line = (it) => {
  const votes = (it.votes || []).map((v) => `${v.verdict === 'valid' ? '✓' : '✗'} ${who(v.orcid)}`).join(', ');
  return `${it.id.padEnd(28)} ${it.status.padEnd(8)} ${what(it)}\n${' '.repeat(38)}${[...(it.reasons || []), ...(votes ? [`votes: ${votes} → ${reviewStatus(it.votes)}`] : []), ...(it.comments?.length ? [`${it.comments.length} comment(s)`] : [])].join('; ')}`;
};
const find = (x = id) => {
  const i = items.findIndex((y) => y.id === x);
  if (i < 0) { console.error(`no item ${x}`); process.exit(1); }
  return i;
};
const decide = (i, status, note, by = process.env.USER || 'unknown') => {
  const node = doc.contents.items[i];
  node.set('status', status);
  node.set('decision', doc.createNode({ date: new Date().toISOString().slice(0, 10), by, ...(note ? { note } : {}) }));
  items[i] = node.toJSON();
};
const save = () => writeQueue(doc);

// consolidation leads are recorded as examined (data/screened.yaml)
function screen(it) {
  const k = screenKey(it);
  if (!k) return;
  const file = 'data/screened.yaml';
  const sd = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  const list = sd.get(k[0]) || sd.createNode([]);
  if (!list.items.some((n) => String(n.value ?? n) === k[1])) list.items.push(sd.createNode(k[1]));
  list.items.sort((a, b) => String(a.value ?? a).localeCompare(String(b.value ?? b)));
  sd.set(k[0], list);
  fs.writeFileSync(file, sd.toString({ lineWidth: 0 }));
}
function rejectPaper(it, reason) {
  const file = 'data/sweep-rejected.yaml';
  const rd = fs.existsSync(file) ? YAML.parseDocument(fs.readFileSync(file, 'utf8')) : YAML.parseDocument('[]\n');
  rd.contents.flow = false;
  rd.contents.items.push(rd.createNode({ title: it.paper.title, ...(it.paper.doi ? { doi: it.paper.doi } : {}), reason }));
  fs.writeFileSync(file, rd.toString({ lineWidth: 0 }));
}
// a paper validated on the review page: added like scripts/sweep.mjs --add does
function addPaper(it) {
  const p = it.paper;
  const refs = Object.assign({}, ...fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml')).map((f) => YAML.parse(fs.readFileSync(`data/references/${f}`, 'utf8')) || {}));
  const last = (a) => String(a || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/,?\s+(jr\.?|sr\.?|iii|ii)$/, '').split(/\s+/).pop().replace(/[^a-z]/g, '');
  const au = (p.authors || []).filter(Boolean);
  const base = (au.length > 3 ? last(au[0]) + 'etal' : au.map(last).join('') || 'anon') + (p.year || '');
  let k = base, j = 0;
  while (refs[k]) k = base + 'bcdefghij'[j++];
  const file = `data/references/sweep-${new Date().getFullYear()}.yaml`;
  const rd = fs.existsSync(file) ? YAML.parseDocument(fs.readFileSync(file, 'utf8')) : YAML.parseDocument('# Papers found by scripts/sweep.mjs (zbMATH Open and arXiv), not yet mined for results.\n{}\n');
  rd.set(k, rd.createNode({ authors: au, title: p.title, venue: p.venue || '', year: p.year, source: 'review', ...(p.doi ? { doi: p.doi } : {}), ...(p.arxiv ? { arxiv: String(p.arxiv) } : {}) }));
  fs.writeFileSync(file, rd.toString({ lineWidth: 0 }));
  return k;
}
// accept a result or paper item; returns a message, or throws
function accept(i, { ref, loc } = {}) {
  const it = items[i];
  if (it.kind === 'paper') return `added reference ${addPaper(it)}`;
  if (it.kind !== 'result') throw new Error(`${KINDS[it.kind].one}: enter it by hand (AGENTS.md), then mark it with \`done\`.`);
  const at = loc ?? it.loc;
  let spec;
  if (it.origin === 'stated') spec = { [it.ref]: [{ ...it.result, loc: at }] };
  else if (it.origin === 'cited') {
    if (!ref) throw new Error(`the paper attributes this to ${it.citedFrom || 'another work'}: give its key with --ref (and --loc).`);
    spec = { [ref]: [{ ...it.result, ...(loc ? { loc } : {}) }] };
  } else {
    const kind = it.origin === 'special-case' ? 'restriction' : 'reduction';
    spec = { _ai: [{ ...it.result, justification: { kind, by: 'ai', text: `${it.argument || ''} (From ${at} of [@${it.ref}].)`.trim() } }] };
  }
  const res = addResults(spec);
  try {
    execFileSync('node', ['scripts/build.mjs', '--check'], { stdio: 'pipe' });
  } catch (err) {
    res.restore();
    throw new Error(`the build check fails with this fact.\n${String(err.stdout || '')}${String(err.stderr || '')}`);
  }
  return res.changes.map((c) => `${c.action}: ${c.key} (${c.file})`).join('; ');
}
const pending = (i) => {
  if (items[i].status !== 'pending') { console.error(`${items[i].id} is already ${items[i].status}`); process.exit(1); }
};

switch (cmd) {
  case 'list': {
    const shown = items.filter((x) => (args.has('--all') || x.status === 'pending') && (!args.has('--ref') || x.ref === args.get('--ref'))
      && (!args.has('--kind') || x.kind === args.get('--kind')) && (!args.has('--voted') || x.votes?.length || x.comments?.length));
    for (const it of shown) console.log(line(it));
    const byKind = Object.keys(KINDS).map((k) => [k, items.filter((x) => x.status === 'pending' && x.kind === k).length]).filter(([, n]) => n);
    console.log(`${shown.length} items (pending in all: ${byKind.map(([k, n]) => `${n} ${k}`).join(', ') || 'none'})`);
    break;
  }
  case 'show':
    console.log(YAML.stringify(items[find()], { lineWidth: 0 }));
    break;
  case 'accept': {
    acquireLock('review.mjs');
    const i = find();
    pending(i);
    try {
      const msg = accept(i, { ref: args.get('--ref'), loc: args.get('--loc') });
      decide(i, 'accepted', args.get('--note'));
      save();
      console.log(msg);
    } catch (err) { console.error(`Not accepted: ${err.message}`); process.exit(1); }
    break;
  }
  case 'reject':
  case 'done': {
    if (!args.has('--note')) { console.error('Give the reason with --note.'); process.exit(1); }
    acquireLock('review.mjs');
    const i = find();
    pending(i);
    decide(i, cmd === 'reject' ? 'rejected' : 'done', args.get('--note'));
    save();
    screen(items[i]);
    if (cmd === 'reject' && items[i].kind === 'paper') rejectPaper(items[i], args.get('--note'));
    console.log(`${id}: ${cmd === 'reject' ? 'rejected' : 'done'}`);
    break;
  }
  case 'apply': {
    const dry = args.has('--dry-run');
    if (!dry) acquireLock('review.mjs');
    const out = { accepted: [], rejected: [], byHand: [], disputed: [], failed: [] };
    items.forEach((it, i) => {
      if (it.status !== 'pending') return;
      const st = reviewStatus(it.votes);
      const voters = (verdict) => (it.votes || []).filter((v) => v.verdict === verdict).map((v) => who(v.orcid)).join(', ');
      const remarks = (it.comments || []).map((c) => `${who(c.orcid)}: ${c.text.replace(/\s+/g, ' ')}`).join(' | ');
      if (st === 'validated') {
        const auto = it.kind === 'paper' || (it.kind === 'result' && it.origin !== 'cited');
        if (!auto) { out.byHand.push(`${line(it)}${remarks ? `\n${' '.repeat(38)}comments: ${remarks}` : ''}`); return; }
        if (dry) { out.accepted.push(`${it.id} (would be accepted: ${what(it)})`); return; }
        try {
          const msg = accept(i);
          decide(i, 'accepted', `validated on the review page by ${voters('valid')}${remarks ? `; ${remarks}` : ''}`, voters('valid'));
          save();
          out.accepted.push(`${it.id}: ${msg}`);
        } catch (err) { out.failed.push(`${it.id}: ${err.message.split('\n')[0]}`); }
      } else if (st === 'invalidated') {
        if (dry) { out.rejected.push(`${it.id} (would be rejected: ${what(it)})`); return; }
        const note = `invalidated on the review page by ${voters('invalid')}${remarks ? `; ${remarks}` : ''}`;
        decide(i, 'rejected', note, voters('invalid'));
        save();
        screen(it);
        if (it.kind === 'paper') rejectPaper(it, note);
        out.rejected.push(it.id);
      } else if (st === 'disputed') out.disputed.push(`${line(it)}${remarks ? `\n${' '.repeat(38)}comments: ${remarks}` : ''}`);
    });
    const show = (title, list) => { if (list.length) console.log(`\n${title} (${list.length}):\n${list.join('\n')}`); };
    show(dry ? 'Would be accepted' : 'Accepted', out.accepted);
    show(dry ? 'Would be rejected' : 'Rejected', out.rejected);
    show('Validated, to enter by hand (then `done <id> --note …`; a cited fact: `accept <id> --ref key`)', out.byHand);
    show('Disputed: settle with accept or reject', out.disputed);
    show('Not accepted (the build check fails: correct the item or reject it)', out.failed);
    if (!Object.values(out).some((l) => l.length)) console.log('No votes to apply.');
    else if (!dry) console.log('\nNext: npm run check && npm run build && npm test, then commit.');
    break;
  }
  default:
    console.error(`usage: ${USAGE}`);
    process.exit(1);
}
