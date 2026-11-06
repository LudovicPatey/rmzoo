// Writing to the review queue, data/review.yaml (docs/REVIEW.md). Used by
// scripts/ai-analyze.mjs (AI proposals), scripts/consolidate.mjs (candidates of
// the consolidation), scripts/review.mjs and scripts/endorsements-sync.mjs. The
// caller holds the data lock.
import fs from 'node:fs';
import crypto from 'node:crypto';
import YAML from 'yaml';

export const QUEUE = 'data/review.yaml';

export function readQueue(file = QUEUE) {
  const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync('scripts/review-header.yaml', 'utf8') + '[]\n');
  if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
  doc.contents.flow = false;
  return doc;
}
export const writeQueue = (doc, file = QUEUE) => fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));

// What a proposal says, whatever its id, date, wording or part of the paper: the kind,
// the paper and the fact (keys in a fixed order) or the missing statement's notation.
// Two readings that find the same fact give the same fingerprint. An item keeps the
// fingerprint of the original proposal in `proposed`, so that a result corrected by
// hand before it was accepted is still recognized.
const canon = (x) => (Array.isArray(x) ? x.map(canon)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, canon(x[k])])) : x);
const CONTENT = {
  result: (it) => it.result, statement: (it) => it.statement?.notation, paper: (it) => it.paper?.doi || it.paper?.arxiv || it.paper?.title,
  lead: (it) => it.text, question: (it) => it.text, answer: (it) => it.text && [it.question, it.text],
};
export const fingerprint = (it) => {
  const c = CONTENT[it.kind]?.(it);
  return c ? crypto.createHash('sha256').update(JSON.stringify([it.kind, it.ref ?? null, canon(c)])).digest('hex').slice(0, 12) : null;
};
// the fingerprints of the decided items (their original proposal and their current form)
const decidedPrints = (doc) => {
  const m = new Map();
  for (const n of doc.contents.items) {
    if (n.get('status') === 'pending') continue;
    const it = n.toJSON();
    for (const f of [it.proposed, fingerprint(it)]) if (f && !m.has(f)) m.set(f, it);
  }
  return m;
};

// Pending items that repeat a decided one (same fingerprint) are closed with the
// same outcome (rejected stays rejected; accepted or done becomes done) and a note
// naming the decided item; items are never deleted. Returns the ids closed.
export function closeRepeats(doc, today = new Date().toISOString().slice(0, 10)) {
  const decided = decidedPrints(doc);
  const closed = [];
  for (const n of doc.contents.items) {
    if (n.get('status') !== 'pending' || n.get('votes')?.items?.length || n.get('comments')?.items?.length) continue;
    const it = n.toJSON();
    const f = it.proposed || fingerprint(it);
    const twin = f && decided.get(f);
    if (!twin) continue;
    n.set('status', twin.status === 'rejected' ? 'rejected' : 'done');
    n.set('decision', doc.createNode({ date: today, by: 'review-queue', note: `Same proposal as ${twin.id} (${twin.status}${twin.decision?.note ? `: ${twin.decision.note}` : ''}).` }));
    closed.push(it.id);
  }
  return closed;
}

// Adds items whose id is not yet in the queue (an item already decided, or
// already queued, is never proposed again), nor the same fact as a decided item
// (a replay or a new reading that finds a fact already decided does not ask again). `replace(node)` selects pending items
// to drop first (a paper analyzed again replaces its pending proposals), except
// those that researchers already voted on or commented: their discussion is kept.
// Returns the number of items added.
export function addToQueue(items, { replace = null, file = QUEUE } = {}) {
  const doc = readQueue(file);
  if (replace) {
    doc.contents.items = doc.contents.items.filter((n) =>
      !(n.get('status') === 'pending' && replace(n) && !n.get('votes')?.items?.length && !n.get('comments')?.items?.length));
  }
  const ids = new Set(doc.contents.items.map((n) => n.get('id')));
  const decided = decidedPrints(doc);
  let added = 0;
  for (const it of items) {
    const f = it.proposed || fingerprint(it);
    if (ids.has(it.id) || (f && decided.has(f))) continue;
    ids.add(it.id);
    doc.contents.items.push(doc.createNode(f ? { ...it, proposed: f } : it));
    added++;
  }
  closeRepeats(doc);
  writeQueue(doc, file);
  return added;
}
