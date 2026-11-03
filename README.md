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
  classes.yaml       formula classes for conservation results (Π⁰ₙ, ∀Π⁰ₙ, Π¹₁, rΠ¹₂…)
  context.yaml       short historical context for the main statements ([@key] cites a paper)
  abstracts.yaml     abstracts of the papers (scripts/abstracts.mjs)
  references/*.yaml  bibliography
  statements/*.yaml  the catalogue (definitions, formulations, literature)
  results/**/*.yaml  implications, separations, properties — each cited
  fulltext-exclude.yaml  Zotero items not to use (wrong attachment)
  sweep-rejected.yaml    papers found by the sweep and judged out of scope
  screened.yaml          consolidation leads already examined (not proposed again)
  acronyms-ignored.yaml  acronyms examined and deliberately not added as statements
  ai-analyzed.yaml       papers already read by the AI reader (scripts/ai-analyze.mjs)
  ai-review.yaml         AI proposals awaiting a human decision (scripts/ai-review.mjs)
scripts/             build (YAML → JSON + validation), consolidation, dev server
  lib/schema.mjs     the data model: every allowed field, its meaning, its readers
  lib/lock.mjs       one writer at a time on data/
  lib/cli.mjs        --help and option checking for every script
  lib/results.mjs    writing results without duplicates (add-results, AI reader)
  lib/ai-facts.mjs   checks deciding which AI-proposed facts are published
  mine/              candidate results and questions from the full texts (regexes)
  ai-analyze.mjs     AI reading of each full text, once (Claude API)
  ai-review.mjs      accept / reject the AI proposals
  ai/                instructions given to the model (extract.md, verify.md)
site/                the viewer (vanilla JS, KaTeX, no build step)
  js/engine.js       inference engine (shared with the build script)
  js/layout.js       layered layout for Hasse diagrams
  js/bibtex.js       BibTeX export
  js/related.js      related statements (statement page)
cache/fulltext/      local full texts of the papers (git-ignored)
docs/DESIGN.md       data model and design rationale
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
has Claude (Opus 5.5) read each cached paper once, in full, with the catalogue,
and list every fact it states about catalogue statements however it is worded
("every computable instance has a solution not computing C" is cone avoidance),
plus immediate special cases of stated theorems (MTT² is the case d = 1 of the
product version PMTT²).

```bash
node scripts/ai-analyze.mjs --dry-run              # papers not yet read, cost estimate
node scripts/ai-analyze.mjs --only dauriacetal2024  # one paper
node scripts/ai-analyze.mjs                        # every paper not yet read
node scripts/ai-review.mjs list                    # proposals awaiting a decision
```

It needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile). A paper costs
about $0.10–$2 depending on its length; the whole cache (≈ 700 texts, 20 M
tokens) about $300 at once. Each paper is read only once (`data/ai-analyzed.yaml`);
`--replay` re-applies the rules to the saved answers (`cache/ai/`) for free.

The model proposes; code decides. A fact is published only if its statements,
property and reduction are in the catalogue, the quoted passage is found verbatim
in the text, it has a theorem number, the model is confident and says the paper
states it (or that it is a special case of one stated theorem), it does not
contradict the database, a second independent call shown the passages confirms
it, and `npm run check` still passes. Stated facts cite the paper; special cases go
to `data/results/ai-derived.yaml` (shown as "AI-derived"). Facts the database
already derives are dropped. Everything else — and principles missing from the
catalogue — goes to `data/ai-review.yaml` with the reasons, for
`node scripts/ai-review.mjs accept|reject|done <id>` (a web backend may replace it).
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
