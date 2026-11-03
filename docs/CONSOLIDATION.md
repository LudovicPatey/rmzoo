# Consolidating the database

The database grows with the literature. `npm run consolidate` runs the whole
procedure and writes `reports/consolidation-<date>.md`; run it every few months,
then work through the report. `npm run consolidate -- --ai` also has every new
full text read by Claude (step 4b).

## What it does

| step | automatic | for a reader |
|------|-----------|--------------|
| 1. New papers (`scripts/sweep.mjs`) | zbMATH Open and arXiv are searched for documents since the last run; those whose title is clearly about reverse mathematics or Weihrauch reducibility are added to `data/references/sweep-<year>.yaml` | borderline papers, to add by hand if relevant |
| 2. Publication status (`scripts/pubstatus.mjs`) | preprints that have been published get their venue, DOI and year (arXiv journal references; Crossref exact-title matches) | — |
| 3. Texts (`abstracts.mjs`, `fulltext.mjs`, `pdf-abstracts.mjs`) | abstracts (arXiv TeX, else from the PDF, else OpenAlex), full texts (Zotero, arXiv, open access) cached in `cache/fulltext/` | cached texts that do not match their title |
| 4. Mining (`scripts/mine/facts.mjs`, `scripts/mine/questions.mjs`) | — | theorems of new texts mentioning statements whose relation is open; numbered questions not yet recorded |
| 4b. AI reading (`scripts/ai-analyze.mjs`, only with `--ai`: it costs API tokens) | every cached text not yet read is read by Claude; facts passing all checks are added (see README, "AI reading of the full texts") | proposals in `data/ai-review.yaml` (`node scripts/ai-review.mjs list`) |
| 5. Statements | — | definitions still flagged "to check", with the texts to read; acronyms used as principles in ≥ 3 papers but absent from the catalogue |
| 6. Questions | formal questions are re-derived from the database at every build | questions whose status changed; passages of recent papers that may answer open questions |
| 7. Checks | build validation, tests | — |

zbMATH Open and arXiv are preferred because they are curated or primary
sources with stable identifiers and an open API. OpenAlex and Semantic Scholar are
only used to find abstracts and open-access PDFs (OpenAlex has a daily quota per
network). Google Scholar is not used: it forbids automated queries.

## What the miners recognize

`scripts/mine/` links theorems to statements of the zoo through their names as
they appear in extracted text (TeX stripped), including:

* operator statements in the papers' notation: `LPO′`, `LPO∗`, `LPO⋄`,
  `lim ∗ COH` / `lim ⋆ COH`, `C_N × WKL`;
* principles stated in words, e.g. "∀X ∃Y (Y ≰T X)" or "the existence of relatively
  nonrecursive sets" (NON), "hyperimmune relative to X" (HYP), "1-random over X"
  (1-RAN), "1-generic over X" (1-GEN), "DNC over X′" (2-DNR).

They do not see parallelizations (the hat is lost in extracted text), completions
(overlines are lost: check the rendered PDF), primes placed before subscripts
(`C′N`), or Brattka–Rakotoniaina's `RTn,k`. Add phrases and spellings to
`scripts/mine/common.mjs` when a paper uses a new one.

## Working through the report

The full procedure, with the rules for reading papers, is in
[AGENTS.md](../AGENTS.md#working-through-a-consolidation-report-reportsconsolidation-datemd).
Decisions are recorded so that they are not proposed again:

* papers judged out of scope → `data/sweep-rejected.yaml` (title, DOI, reason);
* leads examined (theorems, questions, passages that may answer a question) →
  `data/screened.yaml`, with the key shown in the report;
* acronyms examined and not added → `data/acronyms-ignored.yaml` (with the reason);
* AI proposals → their `status` in `data/ai-review.yaml` (`accept`, `reject`,
  `done` with `scripts/ai-review.mjs`; items are never deleted).

`npm run consolidate -- --since 1975-01-01` re-mines the whole cache; leads in
`data/screened.yaml` are still skipped.

* **Results** are entered with `node scripts/add-results.mjs spec.json` (one
  entry per theorem, with its number). Read the theorem in the paper: the miner
  only points at it.
* **Questions** go to `data/questions.yaml`. Prefer a `formal` encoding, so the
  database keeps the status up to date; otherwise give the status and
  `resolvedBy` by hand.
* **Statements**: give the precise definition from the source paper (with its
  statement number in `refs[].loc`), never a paraphrase from a title or abstract.
  Use `todo: true` only when no source text is available, and say why.
* Facts derived by an AI assistant without a reference are marked
  `provenance: ai` with a `justification` (see `docs/DESIGN.md`).

Run `npm run check` after every batch of edits: contradictions, duplicates and
inconsistent question statuses make it fail.
