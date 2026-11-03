// Writing to the review queue, data/review.yaml (docs/REVIEW.md). Used by
// scripts/ai-analyze.mjs (AI proposals), scripts/consolidate.mjs (candidates of
// the consolidation), scripts/review.mjs and scripts/endorsements-sync.mjs. The
// caller holds the data lock.
import fs from 'node:fs';
import YAML from 'yaml';

export const QUEUE = 'data/review.yaml';

export function readQueue(file = QUEUE) {
  const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync('scripts/review-header.yaml', 'utf8') + '[]\n');
  if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
  doc.contents.flow = false;
  return doc;
}
export const writeQueue = (doc, file = QUEUE) => fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));

// Adds items whose id is not yet in the queue (an item already decided, or
// already queued, is never proposed again). `replace(node)` selects pending items
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
  let added = 0;
  for (const it of items) {
    if (ids.has(it.id)) continue;
    ids.add(it.id);
    doc.contents.items.push(doc.createNode(it));
    added++;
  }
  writeQueue(doc, file);
  return added;
}
