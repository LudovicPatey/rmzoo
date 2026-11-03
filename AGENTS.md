# Instructions for AI assistants and maintainers

This file is for anyone who changes this repository: an AI assistant (Claude,
another LLM, any agent), a new contributor, or the maintainer in a later session.
Read it before your first change. `CLAUDE.md` points here.

The project is a database of results in **reverse mathematics** and on
**Weihrauch reducibility** (implications, separations, conservation results,
open questions, with their sources) and a static web viewer that derives
everything else with an inference engine. The maintainer is a researcher in the
field: the mathematics must be exact, and every fact must be traceable to a
paper.

* What the data means: [docs/DESIGN.md](docs/DESIGN.md).
* Layout, commands, adding results, full texts, abstracts: [README.md](README.md).
* Keeping the database up to date: [docs/CONSOLIDATION.md](docs/CONSOLIDATION.md).
* Every allowed data field, its meaning and the code that reads it:
  [scripts/lib/schema.mjs](scripts/lib/schema.mjs).

## 1. Ground rules for the mathematics

1. **Never invent a fact.** Every result cites the paper and the exact theorem
   number (`refs: [{ref, loc}]`). Read the statement in the full text
   (`cache/fulltext/<key>.txt`, or the PDF next to it), not in a title, an
   abstract, a miner snippet or your memory. The miners only point at
   candidates.
2. **Extracted text loses notation.** Check the rendered PDF
   (`pdftoppm -f N -l N -png cache/fulltext/<key>.pdf /tmp/p`) whenever it matters:
   * overlines (completions, `C̄_N`) and hats (parallelizations, `LPO^`) vanish,
     so `C_N` in the text may be `C̄_N` in the paper;
   * `≰` often comes out as `6≤`, or disappears entirely ("LPO × NON W RT22").
     Read the proof ("Assume otherwise…") to know which way it goes;
   * primes before subscripts (`C′N`), and superscripts and subscripts run together
     (`RT22` for RT²₂, `SRT23` for SRT²₃).
3. **Facts you derive yourself** (no paper states them) get
   `provenance: ai` and a `justification` with the argument. Never cite a paper
   for something it does not state. Folklore gets `folklore: true` and a
   justification.
4. **Definitions** come from the source paper, with its number in `refs[].loc`.
   Use `todo:` only when no source text is available, and say why.
5. **Ambiguous names**: the same acronym can name different principles in
   different papers (HBT is Hahn–Banach or Heine–Borel; BCT is Brattka–Gherardi's
   or Sanders' third-order version). Check the definition in each paper before
   linking a result to a statement.
6. **Open questions** (`data/questions.yaml`) are recorded only when a paper
   states them explicitly. Give `formal` parts whenever the question is a
   comparison of statements: the status is then derived from the database. Never
   set a status that the database contradicts (the build fails).
7. When unsure whether a theorem says what you think, leave it out and tell the
   maintainer which theorem and why. A missing fact is better than a wrong one.

## 2. Ground rules for the repository

* **One writer at a time.** Scripts that rewrite `data/` take a lock
  (`cache/.data-lock`, `scripts/lib/lock.mjs`). Before running or editing data
  while a script may run, check the lock. **Never stop or start a script the
  maintainer launched** (e.g. their `npm run consolidate`); ask first.
* Every script prints its usage with `--help` and refuses unknown options
  (`scripts/lib/cli.mjs`). Do not run `consolidate`, `sweep`, `pubstatus`,
  `fulltext` or `abstracts` just to test something: they query external services
  for many minutes and write data. Use `--only key` or the dry-run modes.
* External services: zbMATH Open and arXiv first (curated, stable identifiers);
  Crossref, OpenAlex (daily quota) and Semantic Scholar only for metadata,
  abstracts and open-access PDFs. **Google Scholar forbids automated queries:
  do not use it or work around its blocking.**
* Zotero (`~/Zotero`) is read-only. Papers are copied into `cache/fulltext/`,
  which is git-ignored (copyrighted texts are never committed).
* Commit only when the maintainer asks; they push. Deploying to the live
  instance (`node scripts/deploy.mjs`) is also theirs to run; a new file the
  site needs must be added to the list in `scripts/lib/deploy.mjs`. End commit messages with the
  co-author line requested in your session, if any.
* Write YAML by hand with care: in a flow map `{ … }`, quote any value
  containing `, ` or `: ` (`loc: "Section 1, (5)"`); unquoted, YAML splits it and
  the build reports an unknown field. Add results with
  `node scripts/add-results.mjs spec.json` (it merges citations of duplicates).
* After any data edit: `npm run check` (validation, contradictions, duplicates,
  question statuses), then `npm run build` and `npm test`.

## 3. Map of the code

| part | file | reads |
|------|------|-------|
| validation, derived fields (operator statements, conjunctions, labels "studied over"), `site/data/zoo.json` | `scripts/build.mjs` | all of `data/` |
| data model: allowed fields, operations, result identity | `scripts/lib/schema.mjs` | — |
| inference engine (rules, operator laws, question status) | `site/js/engine.js` | `zoo.json` |
| viewer (home, catalogue, statement, paper, results, questions pages) | `site/js/app.js`, `layout.js`, `bibtex.js`, `related.js` | `zoo.json`, `abstracts.json` |
| consolidation (steps 1–7, report in `reports/`) | `scripts/consolidate.mjs` | everything below |
| new papers | `scripts/sweep.mjs` | references, `data/sweep-rejected.yaml` |
| publication status | `scripts/pubstatus.mjs` | references |
| full texts, `read` status | `scripts/fulltext.mjs` | references, `data/fulltext-exclude.yaml`, Zotero |
| abstracts | `scripts/abstracts.mjs`, `scripts/pdf-abstracts.mjs` | references, cached texts |
| mining (candidate results / questions) | `scripts/mine/{common,facts,questions}.mjs` | `zoo.json`, cached texts, `data/screened.yaml` |
| AI reading of full texts (once per paper), triage, verification | `scripts/ai-analyze.mjs`, `scripts/lib/ai-facts.mjs`, prompts in `scripts/ai/` | `zoo.json` (catalogue in the prompt), cached texts, `data/ai-analyzed.yaml` |
| human decisions on AI proposals | `scripts/ai-review.mjs` | `data/ai-review.yaml` |
| adding results | `scripts/add-results.mjs` → `scripts/lib/results.mjs` | results |
| endorsements and comments: server (PHP), viewer, download | `site/api/*.php`, `site/js/community.js`, `scripts/endorsements-sync.mjs` | `zoo.json` (results' `_key`), `data/endorsements.yaml` |
| upload to the live instance (explicit file list, never deletes) | `scripts/deploy.mjs` → `scripts/lib/deploy.mjs` | `site/`, `cache/deploy.json` |
| one-off imports (kept for provenance, not maintained) | `scripts/import/` | — |
| tests | `tests/*.test.mjs` | engine, data, schema |

## 4. Change-impact checklist

**Whenever you change the system — above all the data model — go through every
procedure below, decide how the change affects it, adapt it, and tell the
maintainer what you checked.** Do this at the time of the change, without
waiting to be asked. (Example of what goes wrong otherwise: when operator
statements such as `lpo.jump` were added, the miners did not recognize `LPO′`
and the missing-statement check did not know them, until the maintainer asked.)

Start from `scripts/lib/schema.mjs`: each field lists the files that read it.
Then go through:

| procedure | what to check |
|-----------|---------------|
| **schema** (`scripts/lib/schema.mjs`) | new/renamed field documented, `usedBy` updated; `npm test` checks `usedBy` |
| **build** validation | the new field/value is validated (unknown references, allowed values); derived fields (labels, `studied`, operator statements, conjunctions) handle it |
| **engine** | inference rules, `questionStatus`, `classMembers`, search ranking |
| **viewer** | catalogue (filters, checkboxes, "over" chips, select all), statement page (its tabs: definition, context, glance, related statements, frames, operator line, position, properties, questions), paper page (abstract, BibTeX, questions asked/answered), results, questions, about page, home page stats and recent items |
| **miners** (`scripts/mine/common.mjs`) | the acronym dictionary (labels in extracted-text form, `extra` spellings, operator forms, `PHRASES`), `relation()` (which reduction a theorem speaks of: one branch per reduction), `normalize()` |
| **consolidate** steps | 1 sweep (relevance and auto-add rules, rejected list), 2 pubstatus, 3 texts, 4 mining (screened list), 5 statements (`known` labels/aliases, `acronyms-ignored.yaml`, `STOP`), 6 questions (status changes, resolution leads), 7 checks |
| **AI reader** (`scripts/ai-analyze.mjs`, `scripts/ai/*.md`, `scripts/lib/ai-facts.mjs`) | the catalogue given to the model (statement fields, reductions, properties, classes, operations), the answer schema (`FACT_SCHEMA`: result types and their fields), `entry()` and `validity()`, the reading rules in `scripts/ai/extract.md` and `verify.md` (notation for reductions, dotted ids), `tests/ai-facts.test.mjs`. Saved answers can be re-checked with `--replay` |
| **sweep / pubstatus / fulltext / abstracts** | reference fields they read or write (`doi`, `arxiv`, `venue`, `year`, `read`, `preprintYear`) |
| **add-results** | result identity (`resultKey` in the schema module) |
| **endorsements** (`docs/ENDORSEMENTS.md`) | endorsements refer to `resultKey`: changing the key (its fields) orphans existing endorsements; the server (`site/api/`) reads `zoo.json` (results' `_key`, statements, references); new targets of comments need the `feedback` action and `feedbackPanel` |
| **"studied over" labels** | `FRAME` in `scripts/build.mjs` maps reductions to labels: a new reduction needs an entry or a decision |
| **tests** | add a test for the new behaviour (engine rules on a toy zoo; schema/handler coverage in `tests/schema.test.mjs`) |
| **docs** | `docs/DESIGN.md` (concepts), `README.md` (usage), `docs/CONSOLIDATION.md` (procedure), this file |

Specific cases:

* **New operation of the Weihrauch algebra**: add it to `OPERATIONS` in the
  schema; then build `fillOp` (label, name, definition), engine laws (which hold
  for strong vs weak reductions: `algebra` in `data/reductions.yaml`), viewer op
  line, miner textual forms, the dotted-id paragraph of `scripts/ai/extract.md`. `tests/schema.test.mjs` fails until all are done.
* **New reduction**: `data/reductions.yaml` (`finerThan`, `domain`, `algebra`…),
  `FRAME` for labels, `relation()` in the miners, the catalogue chips, preset zoos,
  the reduction paragraphs of `scripts/ai/extract.md` and `verify.md`.
* **New kind of result or statement field**: schema, build validation, engine,
  viewer, `resultKey` if it changes the identity of a result, `scripts/lib/results.mjs`,
  the AI reader (answer schema, `entry()`, `validity()`, `standing()`, prompts).
* **New property**: give its `closedUnder` only if some reduction really preserves
  it (none for Σ⁰ₙ/Π⁰ₙ bases; c, not omega, for Δ⁰ₙ bases, which cannot be
  iterated), its `domain` (problems, if defined through instances and
  solutions) and its `implies` relations with the existing ones (and theirs with
  it: `computably-true` implies every preservation property). A new level of the
  lowness hierarchy is `optional`, implied by the level below and implying the one
  above; move ACA₀'s folklore failure (in `data/results/core.yaml`) to the new
  top level. Nothing to change in the AI reader (the catalogue lists properties),
  but run `node scripts/ai-analyze.mjs --replay` to re-check saved answers that
  named it before it existed.
* **New data file**: document it in the schema module (bottom list), README layout,
  and whichever script reads it.

## 5. Workflows

### Working through a consolidation report (`reports/consolidation-<date>.md`)

1. Check that the run is finished (no `cache/.data-lock`, or its pid is dead).
2. Section 1 (new papers): reject off-topic additions with a reason in
   `data/sweep-rejected.yaml` and delete them from `sweep-<year>.yaml`; add relevant
   "to review" papers by hand. The build rejects references without authors/year.
3. Section 4 (candidate results, questions): for each lead, read the theorem in
   the text (section 1 rules), enter results with `add-results.mjs`, questions in
   `data/questions.yaml`; then record the lead's key in `data/screened.yaml`
   (whether or not it led to a change) so it is not proposed again.
4. Section 5 (statements): add a missing statement only after reading its
   definition in a source; otherwise record the acronym and the reason in
   `data/acronyms-ignored.yaml`. Statement ids are lowercase; problems need
   `instance` and `solution`. Add spellings the miner should know as `aliases`
   (and in `scripts/mine/common.mjs` if the extracted text differs from the label).
5. Section 6 (questions): read the passage; if a question is answered, enter the
   result that answers it (formal questions update themselves) or set
   `status`/`resolvedBy`; record `question-id|refkey` in `data/screened.yaml`.
6. `npm run check`, `npm run build`, `npm test`; summarize for the maintainer what
   was added, what was skipped and why.

### Treating AI proposals (`data/ai-review.yaml`)

`node scripts/ai-review.mjs list` shows each pending item with the reasons it was
not published. For a result: read the theorem at `loc` in the paper (section 1
rules; `quote` is the passage the model relied on), correct `result`/`loc` in the
file if needed, then `accept <id>` (a `cited` fact needs `--ref` of the original
work), or `reject <id> --note "why"`. For a missing statement: add it (below) if
it belongs to the zoo, then `done <id> --note …`, and enter the facts the item lists
about it (or re-read the paper: `node scripts/ai-analyze.mjs --redo --only <key>`). Never delete items.

### Endorsements and comments from the live instance

`RMZOO_ADMIN_TOKEN=… node scripts/endorsements-sync.mjs` (see
`docs/ENDORSEMENTS.md`) rewrites `data/endorsements.yaml` (the server is
authoritative: never edit it by hand) and saves new messages in
`feedback/inbox/`. A report of an error is a lead like any other: read the
theorem in the paper (section 1) before changing data, then move the file to
`feedback/done/`. Never put messages, `site/api/config.php` or the admin token
in git.

### Adding a statement

Entry in the right `data/statements/*.yaml` (see the schema for fields), with
`definition`, `instance`/`solution` for problems, `refs` with the defining paper
and its number, `aliases` for other spellings. Then at least one result (the
build warns about statements in no result), and `data/context.yaml` if
background helps. Operator statements (`lpo.jump`, `cn.x.wkl`, `tcn.star.tcn`,
`(cn.x.lpo).jump`) need no entry: the build creates them from their dotted ids.

### Adding a paper

Key `authorsYEAR` (lowercase surnames, `etal` beyond three authors, suffix
`b`, `c`… on collision), in `data/references/*.yaml`, with `authors`, `title`,
`year`, `venue`, `doi` and/or `arxiv`. The build rejects duplicate DOIs, arXiv ids
and titles (mark a conference/journal pair with `version`). Then
`node scripts/fulltext.mjs --download --only key` and
`node scripts/abstracts.mjs --only key`.
