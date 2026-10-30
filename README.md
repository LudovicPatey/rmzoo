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
* `npm test` — engine tests (including known facts that must be derived)

The viewer is a static site (`site/`): after `npm run build` it can be served
by GitHub Pages or any static host.

## Layout

```
data/
  reductions.yaml    notions of reduction and how they compare
  tags.yaml          categories (Big Five, Ramsey theory, …)
  properties.yaml    separating properties (cone avoidance, low basis, …)
  references.yaml    bibliography
  statements/*.yaml  the catalogue (definitions, formulations, literature)
  results/*.yaml     implications, separations, properties — each cited
scripts/             build (YAML → JSON + validation) and dev server
site/                the viewer (vanilla JS, KaTeX, no build step)
  js/engine.js       inference engine (shared with the build script)
  js/layout.js       layered layout for Hasse diagrams
docs/DESIGN.md       data model and design rationale
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
