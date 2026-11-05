# RM Zoo

A database of reverse-mathematics principles — definitions, literature,
implications and separations over several notions of reduction — with an
interactive viewer.

The database stores only **atomic, cited facts**; equivalences, diagrams and
most separations are derived by a small inference engine, and every derived
fact comes with a proof tree ending in citations. See
[docs/DESIGN.md](docs/DESIGN.md) for the concepts.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:8080.

* `npm run check` — validate the data and look for contradictions
* `npm run build` — regenerate `site/data/zoo.json` from `data/`
* `npm test` — engine and BibTeX tests (including known facts that must be derived)
* `node scripts/deploy.mjs` — upload the viewer and the endorsement server to
  rmzoo.ludovicpatey.com (an explicit list of files from `site/`, over SFTP;
  never deletes anything; `--dry-run` lists them; settings in
  `cache/deploy.json`, see `docs/ENDORSEMENTS.md`)
* `npm run consolidate` — search for new papers, publication updates, texts, candidate
  results and questions, and write a report to work through (see `docs/CONSOLIDATION.md`)

The viewer is a static site (`site/`): after `npm run build` it can be served
by GitHub Pages or any static host.

## Layout

```
data/
  reductions.yaml    notions of reduction and how they compare
  tags.yaml          categories (Big Five, Ramsey theory, …)
  properties.yaml    separating properties (cone avoidance, low basis, …)
  questions.yaml     open questions stated in the literature, with their status
  zoos.yaml          predefined selections shown on the front page
  modes.yaml         frameworks of the viewer's mode switch (reductions shown, properties, conservation)
  classes.yaml       formula classes for conservation results (Π⁰ₙ, ∀Π⁰ₙ, Π¹₁, rΠ¹₂…)
  context.yaml       short historical context for the main statements ([@key] cites a paper)
  concepts.yaml      sourced definitions of the words used in statement definitions (shown on statement pages)
  errata.yaml        wrong statements or claims of papers, with the correction (shown on paper pages)
  abstracts.yaml     abstracts of the papers (scripts/abstracts.mjs)
  references/*.yaml  bibliography
  statements/*.yaml  the catalogue (definitions, formulations, literature)
  results/**/*.yaml  implications, separations, properties — each cited
  fulltext-exclude.yaml  Zotero items not to use (wrong attachment)
  sweep-rejected.yaml    papers found by the sweep and judged out of scope
  screened.yaml          consolidation leads already examined (not proposed again)
  acronyms-ignored.yaml  acronyms examined and deliberately not added as statements
  ai-analyzed.yaml       papers already read by the AI reader (scripts/ai-analyze.mjs)
  review.yaml            the review queue: AI proposals and consolidation candidates awaiting a decision (docs/REVIEW.md)
scripts/             build (YAML → JSON + validation), consolidation, dev server
  lib/schema.mjs     the data model: every allowed field, its meaning, its readers
  lib/lock.mjs       one writer at a time on data/
  lib/cli.mjs        --help and option checking for every script
  lib/results.mjs    writing results without duplicates (add-results, AI reader)
  lib/ai-facts.mjs   checks deciding which AI-proposed facts are published
  lib/ai-models.mjs  models of the AI reader, prices, cost estimates, the --upgrade selection
  lib/data-hash.mjs  hash of data/ stored in zoo.json by the build, checked by deploy
  mine/              candidate results and questions from the full texts (regexes)
  ai-analyze.mjs     AI reading of each full text, once (Claude API)
  review.mjs         the review queue: list, accept / reject, apply the votes of the review page
  ai/                instructions given to the model (extract.md, verify.md)
site/                the viewer (vanilla JS, KaTeX, no build step)
  js/engine.js       inference engine (shared with the build script)
  js/layout.js       layered layout for Hasse diagrams
  js/bibtex.js       BibTeX export
  js/related.js      related statements (statement page)
  js/community.js    endorsements and comments (live instance)
  api/               endorsement server (PHP, ORCID sign-in): docs/ENDORSEMENTS.md
cache/fulltext/      local full texts of the papers (git-ignored)
docs/DESIGN.md       data model and design rationale
docs/ENDORSEMENTS.md endorsements and comments: server set-up, sync, privacy
docs/REVIEW.md      the review queue and the review page (votes, apply)
feedback/            comments and error reports downloaded from the server (git-ignored)
docs/CONSOLIDATION.md  keeping the database up to date
AGENTS.md            instructions for AI assistants and contributors (read first)
```

## Adding a result

Append to a file in `data/results/`:

```yaml
- type: separation          # implication | separation | equivalence | property
  from: srt22
  to: rt22
  over: omega               # or a list: [sw, rca0star]
  refs: [{ref: moninpatey2021, loc: Theorem 1.1}]
```

then run `npm run check`. If the new fact contradicts something already
derivable, the check fails and names the pair.

## AI reading of the full texts

The miners only see results written in the usual notation. `scripts/ai-analyze.mjs`
has Claude (Opus 5.5 by default) read each cached paper once, in full, with the catalogue,
and list every fact it states about catalogue statements however it is worded
("every computable instance has a solution not computing C" is cone avoidance),
plus immediate special cases of stated theorems (MTT² is the case d = 1 of the
product version PMTT²).

```bash
node scripts/ai-analyze.mjs --dry-run              # ranking of the papers not yet read, costs (reports/ai-priority.md)
node scripts/ai-analyze.mjs --budget 25            # the most important papers, up to about $25
node scripts/ai-analyze.mjs --only dauriacetal2024  # one paper
node scripts/ai-analyze.mjs --only simpson2009 --part 3  # one part of a book
node scripts/ai-analyze.mjs                        # every paper not yet read
node scripts/ai-analyze.mjs --model sonnet --budget 25        # a cheaper reader: about twice as many papers
node scripts/ai-analyze.mjs --upgrade --model opus --budget 25  # second pass: re-read the most important papers read by a weaker model
node scripts/review.mjs list                       # proposals awaiting a decision
```

**Models.** `--model haiku|sonnet|opus` chooses the model of the long extraction
call, which is nearly all the cost (prices in `scripts/lib/ai-models.mjs`): Sonnet
5.5 costs half as much as Opus 5.5, Haiku 5.5 a few cents a paper. The
verification call, which decides what is published without human review, stays
on Opus (`--verify-model` to change it): it is short, and a weaker verifier would
let more errors through. A weaker reader mostly misses facts or proposes more
dubious ones to the review queue; what it publishes passes the same checks. The
ledger records the models of each paper and the review page shows them, so a
later `--upgrade --model opus` re-reads only the papers a weaker model read, most
important first, up to `--budget`; their pending proposals are replaced by the
new reading, and facts already added are found again (citations merged) or kept.
Estimates (`--dry-run`, `--budget`) are calibrated on the costs recorded in the
ledger (by the same model once it has read 5 units): the actual output and
verification vary a lot with the number of facts.

It needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile). With Opus, a paper
costs about $0.40–$3.50 depending on its length and the number of facts (about $1
on average for the first 28 papers); the whole cache (≈ 700 texts, 20 M tokens)
about $450. Papers are read **most important first**
(`scripts/lib/paper-rank.mjs`): open leads of the miner, theorems naming catalogue
statements with a computability or reduction phrase, papers that define catalogue
statements, discounted by the results already citing them; texts too short to be
usable (failed extraction) are skipped. `--budget` or `--limit` stops along this
order; `--dry-run` writes the whole ranking with costs and cumulative costs to
`reports/ai-priority.md` (for instance $25 covers the top 45 papers, about a third
of the total score). Each paper is read only once (`data/ai-analyzed.yaml`), so
later runs continue down the list; `--replay` re-applies the rules to the saved
answers (`cache/ai/`) for free.

Books and theses (texts over 400,000 characters) are read **in parts** of at
most 250,000 characters (about 80 pages), made of whole chapters when the text
has chapter headings (`scripts/lib/split-text.mjs`): a whole book does not fit in
one call, or leaves too little room for the answer. Each part is a unit of its
own in the ranking, the budget and the ledger (`dzhafarovmummert2022#3`), and the
model is told which part it reads and that notation may come from other parts.
Dzhafarov–Mummert is read in 9 parts (about $4.60), Simpson's book in 8.

The model proposes; code decides. A fact is published only if its statements,
property and reduction are in the catalogue, the quoted passage is found verbatim
in the text, it has a theorem number, the model is confident and says the paper
states it (or that it is a special case of one stated theorem), it does not
contradict the database, a second independent call shown the passages confirms
it, and `npm run check` still passes. Stated facts cite the paper; special cases go
to `data/results/ai-derived.yaml` (shown as "AI-derived"). Facts the database
already derives are dropped. Everything else — and principles missing from the
catalogue — goes to the review queue, `data/review.yaml`, with the reasons: it is
shown on the review page of the viewer, where signed-in researchers validate,
invalidate and comment (docs/REVIEW.md), and the maintainer decides with
`node scripts/review.mjs apply|accept|reject|done`.
Every change made is listed per paper in `data/ai-analyzed.yaml`, so it can be
audited or undone.

## Open questions

`data/questions.yaml` lists questions and conjectures stated explicitly in the
papers, written in our own words, with where they were asked (every paper that
asked them), the statements involved and some context. A question that can be
phrased as comparisons of the zoo carries a `formal` list ("does A imply B over
R?"); its status is then derived from the database: resolved when every part
is settled, partially answered when some are, and the answering papers are
those cited by the proofs (or given in `resolvedBy`). So entering the result
that answers a question resolves it, and the build fails if a hand-written
status disagrees with the database. Other questions carry their status by hand.
The front page counts the questions that are still open.

## Front page

The front page (`#/`) shows database statistics, a search bar, the predefined
zoos of `data/zoos.yaml` (each a list of statements and a notion of reduction,
opened as a diagram) and the most recently added results, statements and
papers. Entry dates come from `git blame` at build time: a result counts as
updated when a citation or theorem number is added to it.

## Full texts of the papers

`scripts/fulltext.mjs` keeps a local, git-ignored cache of the papers in
`cache/fulltext/` (`<key>.txt` for the text and `<key>.pdf` for the PDF, downloaded
or copied from Zotero, plus `index.json`, which records each paper's source, and `failed.json`), so papers never need
to be fetched twice when they are mined again:

```bash
node scripts/fulltext.mjs --zotero --download
```

`--zotero` extracts the matching PDFs of your Zotero library, `--download`
fetches the missing ones (arXiv, else an open-access copy found through
OpenAlex), `--retry` retries previous failures and `--only k1,k2` restricts to
some references. It then records the reading status (`read: pdf-zotero |
pdf-arxiv | pdf-oa`) in `data/references/`. It needs `pdftotext` and `sqlite3`.
Scanned PDFs (no text layer) are read by OCR with Tesseract (`brew install
tesseract`; about 5 s per page) and marked `ocr: true` in
`cache/fulltext/index.json`. OCR keeps the prose but merges sub- and
superscripts (RT²₂ may come out as "RT3", RCA₀ as "RCAg"): the AI reader is
warned for these papers and must identify principles from their definitions,
and the regex miners' leads from them deserve extra care.

When neither Zotero nor `--download` finds a paper, look on each author's web
page (publications list, CV, preprint folder): many authors post their papers
there, sometimes as a conference or preprint version. Save it by hand as
`cache/fulltext/<key>.pdf` and `.txt` (`pdftotext`), add
`"<key>": {"source": "oa", "url": "…", "date": "…"}` to
`cache/fulltext/index.json`, then run `node scripts/fulltext.mjs --status --only
<key>`. A different version of the work (conference vs journal) gets its own
reference linked by `version`, and results cite the version that was read.
Never use shadow libraries (Sci-Hub, LibGen and the like).

## Abstracts

Abstracts live in `data/abstracts.yaml`, each with its source:

1. `node scripts/abstracts.mjs` takes them from the arXiv API (the authors' TeX,
   formulas included), searching arXiv by title for papers without an arXiv
   id (ids found this way are added to the references), and otherwise from
   OpenAlex, whose abstracts often lose their inline formulas.
2. `node scripts/pdf-abstracts.mjs` replaces OpenAlex abstracts, and fills
   missing ones, with the abstract read from the paper's PDF (downloaded or
   in Zotero). Formulas are rebuilt from the typesetting: text in a smaller
   font that is raised or lowered becomes a superscript or subscript, and text
   in math fonts becomes math. An extraction must contain the same words as
   the OpenAlex abstract to replace it; scanned PDFs are skipped.

Paper pages load them on demand from `site/data/abstracts.json` and name the
source.

## Labels "Over RCA₀", "Over RCA₀*", "Weihrauch"

The build labels a statement with a framework when at least one paper states a
result about it (or about a combination containing it) over RCA₀, over RCA₀*,
or for Weihrauch or strong Weihrauch reducibility. Folklore and AI-derived
results do not count. The catalogue can filter on these labels.

## BibTeX

The viewer exports references as BibTeX: the Literature page (the filtered
list), the Results page (papers cited by the filtered results), each statement
page (its literature and the papers cited by its results) and each paper's page.
Entry keys are the zoo's citation keys; journal, volume, number and pages are
recovered from the free-text venue (`site/js/bibtex.js`).

## Where the data comes from

| source | what | files |
|--------|------|-------|
| Hand-written seed | ~30 core statements and results | `data/statements/{core,induction,ramsey,orders}.yaml`, `data/results/*.yaml` |
| Eric Astor's RM Zoo (`github.com/ericastor/rmzoo`, 2024) | ~470 cited results from ~60 papers up to ~2017, 169 statements | `data/results/rmzoo/`, `data/statements/rmzoo.yaml`, importer in `scripts/import/` |
| Literature sweep 1987–2026 (arXiv and OpenAlex abstracts) | ~180 results from ~60 papers: Weihrauch landmarks, post-2017 combinatorics, theorems of ordinary mathematics equivalent to Big Five systems | `data/results/literature/`, `data/statements/{weihrauch,literature,classical}.yaml` |
| AI-derived trivial implications | ~55 restrictions and one-line reductions, each with its argument and an "AI-derived" badge | `data/results/ai-derived.yaml` |
| Property facts (Astor's "unsupported" notes + papers) | ~35 facts on low basis, hyperimmunity, Δ⁰₂ and arithmetic preservation, c.b.-immunity, cone avoidance | `data/results/properties.yaml` |
| Brattka's Bibliography on Weihrauch Complexity + arXiv sweep | ~560 further papers, mostly computable analysis, proof theory or outside the zoo's statements | `data/references/bibliography-*.yaml` |

To review before announcing the zoo:

* statements marked `todo: true` (shown "to check"): their definition was
  written from the paper title and context, not from the paper itself;
* results from the literature sweep were extracted from abstracts, so the
  theorem numbers (`loc`) are missing and the reduction (`over`) should be
  double-checked against the paper;
* references marked "arXiv preprint" may since have appeared in a journal;
* the remaining bibliography-only papers were triaged by abstract; those left
  are mostly about computable analysis problems, proof theory or set theory, or
  have no abstract available (≈140, mostly pre-2013 Weihrauch papers and theses).
