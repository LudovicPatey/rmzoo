// Human review of the facts proposed by scripts/ai-analyze.mjs (data/ai-review.yaml).
// A future web backend will do the same operations; this is the command-line version.
//
//   node scripts/ai-review.mjs list [--all] [--ref key]   pending items (or all)
//   node scripts/ai-review.mjs show <id>                  one item in full
//   node scripts/ai-review.mjs accept <id> [--ref key] [--loc "Theorem 3"] [--note text]
//   node scripts/ai-review.mjs reject <id> --note "why"
//   node scripts/ai-review.mjs done <id> --note "what was done by hand"
//
// accept (result items only) writes the proposed `result` into data/results/ and
// runs the build check (undone if it fails):
//   origin stated        cites the analyzed paper at `loc`;
//   origin cited         needs --ref (and --loc): the work the paper attributes it to;
//   special-case/deduced goes to data/results/ai-derived.yaml with provenance: ai and
//                        the argument as justification.
// Read the passage in the paper before accepting (AGENTS.md, section 1). To correct a
// proposal (another statement id, reduction, theorem number), edit the item's
// `result`/`loc` in data/ai-review.yaml first. Statement items (principles missing
// from the catalogue) are added by hand (AGENTS.md, "Adding a statement"), then
// marked `done`. Items are never deleted, so a rejected fact is not proposed again.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { cli } from './lib/cli.mjs';
import { acquireLock } from './lib/lock.mjs';
import { addResults } from './lib/results.mjs';
import { unknownFields } from './lib/schema.mjs';

const USAGE = 'node scripts/ai-review.mjs list [--all] [--ref key] | show <id> | accept <id> [--ref key] [--loc text] [--note text] | reject <id> --note text | done <id> --note text';
const args = cli(USAGE, { '--all': 0, '--ref': 1, '--loc': 1, '--note': 1 });
const [cmd, id] = args.rest;
const REVIEW = 'data/ai-review.yaml';
if (!fs.existsSync(REVIEW)) { console.log('No review file yet (data/ai-review.yaml): run scripts/ai-analyze.mjs first.'); process.exit(0); }
const doc = YAML.parseDocument(fs.readFileSync(REVIEW, 'utf8'));
const items = doc.toJSON() || [];
const errs = items.flatMap((it, i) => unknownFields(it, 'aiReview', `${REVIEW}[${i}]`));
if (errs.length) { errs.forEach((e) => console.error('✗ ' + e)); process.exit(1); }

const line = (it) => {
  const what = it.kind === 'statement'
    ? `missing statement ${it.statement.notation} (${it.statement.name})`
    : `${JSON.stringify(it.result)} at ${it.loc} [${it.origin}, ${it.confidence}]`;
  return `${it.id.padEnd(28)} ${it.status.padEnd(8)} ${what}\n${' '.repeat(38)}${(it.reasons || []).join('; ')}`;
};
const find = () => {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) { console.error(`no item ${id}`); process.exit(1); }
  return i;
};
const decide = (i, status, note) => {
  const node = doc.contents.items[i];
  node.set('status', status);
  node.set('decision', doc.createNode({ date: new Date().toISOString().slice(0, 10), by: process.env.USER || 'unknown', ...(note ? { note } : {}) }));
  fs.writeFileSync(REVIEW, doc.toString({ lineWidth: 0 }));
};

switch (cmd) {
  case 'list': {
    const shown = items.filter((x) => (args.has('--all') || x.status === 'pending') && (!args.has('--ref') || x.ref === args.get('--ref')));
    for (const it of shown) console.log(line(it));
    console.log(`${shown.length} items (${items.filter((x) => x.status === 'pending').length} pending in all)`);
    break;
  }
  case 'show':
    console.log(YAML.stringify(items[find()], { lineWidth: 0 }));
    break;
  case 'accept': {
    acquireLock('ai-review.mjs');
    const i = find();
    const it = items[i];
    if (it.status !== 'pending') { console.error(`${id} is already ${it.status}`); process.exit(1); }
    if (it.kind !== 'result') { console.error('Statement items are added by hand (AGENTS.md, "Adding a statement"), then marked with `done`.'); process.exit(1); }
    const loc = args.get('--loc', it.loc);
    let spec;
    if (it.origin === 'stated') spec = { [it.ref]: [{ ...it.result, loc }] };
    else if (it.origin === 'cited') {
      if (!args.has('--ref')) { console.error(`The paper attributes this to ${it.citedFrom || 'another work'}: give its key with --ref (and --loc).`); process.exit(1); }
      spec = { [args.get('--ref')]: [{ ...it.result, ...(args.has('--loc') ? { loc } : {}) }] };
    } else {
      const kind = it.origin === 'special-case' ? 'restriction' : 'reduction';
      spec = { _ai: [{ ...it.result, justification: { kind, by: 'ai', text: `${it.argument || ''} (From ${loc} of [@${it.ref}].)`.trim() } }] };
    }
    const res = addResults(spec);
    try {
      execFileSync('node', ['scripts/build.mjs', '--check'], { stdio: 'pipe' });
    } catch (err) {
      res.restore();
      console.error(`Not accepted: the build check fails with this fact.\n${String(err.stdout || '')}${String(err.stderr || '')}`);
      process.exit(1);
    }
    decide(i, 'accepted', args.get('--note'));
    console.log(res.changes.map((c) => `${c.action}: ${c.key} (${c.file})`).join('\n'));
    break;
  }
  case 'reject':
  case 'done': {
    if (!args.has('--note')) { console.error('Give the reason with --note.'); process.exit(1); }
    acquireLock('ai-review.mjs');
    const i = find();
    if (items[i].status !== 'pending') { console.error(`${id} is already ${items[i].status}`); process.exit(1); }
    decide(i, cmd === 'reject' ? 'rejected' : 'done', args.get('--note'));
    console.log(`${id}: ${cmd === 'reject' ? 'rejected' : 'done'}`);
    break;
  }
  default:
    console.error(`usage: ${USAGE}`);
    process.exit(1);
}
