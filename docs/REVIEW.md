# The review queue and the review page

Proposals that are **not part of the database** wait in `data/review.yaml` until
someone decides. They are shown on the review page of the viewer (`#/review`)
and nowhere else, until they are validated.

| kind | from | validating means | what the maintainer does |
|------|------|------------------|--------------------------|
| `result` | AI reader (`scripts/ai-analyze.mjs`): a fact that failed an automatic check (quote not found, confidence, verifier…) | the paper proves it, at the place or by the argument given | accepted by `apply` (stated, special case, deduced); a fact the paper attributes to another work needs `accept <id> --ref` |
| `statement` | AI reader: a principle missing from the catalogue | it belongs in the zoo, with this definition | adds the statement by hand (AGENTS.md), then `done` |
| `lead` | consolidation step 4: a theorem naming statements whose relation is open | it gives a result the zoo lacks (which: in a comment) | enters the result by hand, then `done` |
| `question` | consolidation step 4: a numbered question not in `data/questions.yaml` | an open question worth recording | records it in `data/questions.yaml`, then `done` |
| `answer` | consolidation step 6: a passage that may answer a recorded question | the paper answers it | enters the result or sets the status, then `done` |
| `paper` | consolidation step 1: a borderline new paper of the sweep | it belongs in the zoo | added to `data/references/sweep-<year>.yaml` by `apply` |

The kinds, their texts and the voting rule are in `site/js/review.js`; the
fields of an item in `scripts/lib/schema.mjs` (entity `review`).

**A decision is taken once.** Each item has a fingerprint: its kind, its paper and
what it proposes (the fact with its keys in a fixed order, the notation of a
missing statement, the passage of a lead). `proposed` keeps the fingerprint of the
original proposal, so a result corrected by hand before it was accepted is still
recognized. When the AI reader reads a paper again (`--replay`, `--redo`,
`--upgrade`) or the consolidation runs again, a proposal with the fingerprint of a
decided item is not queued. A pending copy left from an earlier run is closed with
the same outcome (rejected stays rejected; accepted or done becomes done) and a note
naming the decided item. This happens at every write of the queue, or on demand with
`node scripts/review.mjs repeats [--dry-run]`. A fact that differs in any way (another
reduction, statement or base) is a new proposal.

## Votes

On the live instance, researchers signed in with ORCID **validate** or
**invalidate** an item (one vote each, which they can change or withdraw) and
**comment** on it. Votes and comments are public, with the name and ORCID iD.

* One validation and no invalidation: **validated**. A validated `result` is
  shown in the database at once (the viewer rebuilds the zoo with it, marked
  “validated on the review page”), unless it would contradict the database or
  is already in it.
* One invalidation and no validation: **invalidated**.
* Both: **disputed**, for the maintainer to settle.

The maintainer's decision is final: `scripts/review.mjs apply` carries out the
votes (below), and anything can be corrected by hand in `data/review.yaml`.

## Where things are

| part | file |
|------|------|
| queue (committed) | `data/review.yaml`, header `scripts/review-header.yaml` |
| writing to the queue | `scripts/lib/review-queue.mjs` (`addToQueue`: never twice the same id; a paper analyzed again replaces its pending proposals, except those already voted on or commented) |
| open items for the viewer and the server | `site/data/review.json`, written by the build: pending items, minus consolidation leads already recorded in `data/screened.yaml` |
| statuses, kinds, the entry a validated result becomes | `site/js/review.js` |
| review page, live merge of validated results | `site/js/app.js` (section “review page”) |
| server: votes and comments | `site/api/index.php` (`review`, `rcomment`), stored with the endorsements in `<data_dir>/endorsements.json` |
| download | `scripts/endorsements-sync.mjs`: votes and comments go into the open items of `data/review.yaml` (`votes`, `comments`), and the people into `data/endorsements.yaml` |
| maintainer's command line | `scripts/review.mjs` |
| tests | `tests/review.test.mjs`, `tests/api.test.mjs` |

## Routine

```bash
RMZOO_ADMIN_TOKEN=… node scripts/endorsements-sync.mjs   # votes, comments, endorsements
node scripts/review.mjs apply --dry-run                    # what the votes would do
node scripts/review.mjs apply                              # do it
node scripts/review.mjs list --voted                       # items with votes or comments
npm run check && npm run build && npm test
git add data/ && git commit -m "Review decisions"
node scripts/deploy.mjs                                    # the decided items leave the review page
```

`apply`, for every pending item:

* **validated**: a `result` stated by the paper, a special case or a deduction
  is written to `data/results/` exactly as `accept` does (with the build check;
  undone if it fails), and a `paper` is added to the references. The other kinds
  are listed, to be entered by hand; then `node scripts/review.mjs done <id> --note "…"`;
* **invalidated**: rejected, with the voters and their comments as the note; a
  lead, question or answer is also recorded in `data/screened.yaml`, a paper in
  `data/sweep-rejected.yaml`, so the consolidation does not propose it again;
* **disputed**: listed; settle with `accept` or `reject`.

Without votes, the maintainer treats items as before: `list`, `show <id>`,
`accept <id>`, `reject <id> --note`, `done <id> --note` (AGENTS.md, “Treating the
review queue”). Items are never deleted.

Votes are a help, not a proof: before committing, the maintainer (or an AI
assistant, following AGENTS.md section 1) checks a validated result in the paper
like any other fact.
