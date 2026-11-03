# RM Zoo — design of the database and the viewer

This document explains the concepts behind the database and why it is shaped
this way. The short version:

> The database stores **only atomic, cited facts** (a theorem from a paper,
> one fact per entry). Everything else — equivalence classes, the diagram,
> separations obtained by preservation of properties, which formulation to
> display — is **derived** by a small inference engine, and every derived fact
> carries a proof tree that ends in citations.

## 1. Concepts

### 1.1 Reductions (the "over what?" question)

Every implication or separation is stated *relative to a notion of reduction*.
Reductions form a partial order by **strength**: a finer reduction gives more
information.

```
   RCA₀*          sW
     │          ╱    ╲
   RCA₀       W       sc
     │      ╱   ╲    ╱
     │    gW      c
      ╲    │    ╱
         ω (ω-models)
```

(`a` above `b` means "a reduction at `a` yields a reduction at `b`".)

Two transfer rules follow, and they are the backbone of the engine:

* an **implication** at a finer reduction holds at every coarser one
  (`Q ≤_W P` ⇒ `Q ≤_c P` ⇒ `Q ≤_ω P`);
* a **separation** at a coarser reduction holds at every finer one
  (`P ⊬_ω Q` ⇒ `P ⊬_{RCA₀} Q` ⇒ `P ⊬_{RCA₀*} Q`).

Reductions are data (`data/reductions.yaml`), not code, so adding e.g.
"provability over RCA₀ + BΣ⁰₂" or "computable reduction with finitely many
parallel uses" is a matter of adding a node and saying which reductions it is
finer/coarser than.

Each reduction has a **domain**: proof-theoretic reductions and ω-models
compare arbitrary statements; Weihrauch-style reductions only compare
*problems* (Π¹₂ statements with an instance/solution reading). A first-order
schema such as BΣ⁰₂ simply does not appear in a Weihrauch diagram.

### 1.2 Statements and formulations

A **statement** is one precise mathematical formulation — one node of the zoo.
A problem-statement records its *instances* and *solutions* in addition to its
definition, because the Weihrauch-style reductions are about that reading.

The same "principle" often has several formulations which are equivalent over
a coarse reduction but split over finer ones:

| principle | formulations | equivalent over | split over |
|-----------|--------------|-----------------|-----------|
| stable Ramsey for pairs | SRT²₂, D²₂ | RCA₀, ω | W |
| Ramsey for pairs | RT²₂, RT²₃, … | RCA₀, ω | c |
| pigeonhole | RT¹₂, RT¹₃, … | RCA₀, c | W |

We model this as: each statement may declare `formulationOf: <main>`, which
makes `<main>` the **main formulation** of the principle. This is purely an
*editorial* link — the equivalences themselves are ordinary cited results in
the results database, so the viewer can show *exactly at which reductions*
two formulations coincide, and the claim "they are equivalent" can never get
out of sync with the literature.

When a diagram is drawn at reduction R, statements that are provably
equivalent at R are collapsed into one node. The displayed label is chosen by
(1) main formulation of a principle, (2) explicit `priority`, (3) the first
statement selected by the user. So at RCA₀ the node reads "SRT²₂ ≡ D²₂", while
at W the two are drawn separately.

**Compound statements** (`conjunction: [coh, srt22]`) are first-class
statements. Over theories and ω-models the engine knows that `P + Q` implies
both conjuncts and is implied by anything implying both. (Over Weihrauch-style
reductions a conjunction is not a problem; products would be a different
operator and are left for future work.)

**Flags.** `base: [reductions]` marks a statement as the bottom of the listed
reductions: RCA₀* is the bottom over RCA₀*, RCA₀ and ω-models; RCA₀ is the
bottom over RCA₀ and ω-models but is a genuine statement over RCA₀* (equivalent
to IΣ⁰₁). Computability-theoretic reductions have no named bottom; being
"computably true" is a property. `firstOrder: true` marks arithmetical statements true in ℕ, which
hold in every ω-model, so every statement ω-implies them.

**Weihrauch operations.** Problems obtained from others by the operations of
the Weihrauch algebra are statements with `op` (`jump`, `par` for the
parallelization P̂, `fin` for the finite parallelization P*, `diamond` for P⋄,
the closure under compositional product, `product` P × Q, `compose` for the
compositional product P ⋆ Q) and `args`. Results may name them with dotted ids,
created on the fly with their label, name and definition: `lpo.jump` (LPO′),
`llpo.par` (LLPÔ), `lpo.fin` (LPO*), `lpo.diamond` (LPO⋄), `cn.x.lpo` (C_ℕ × LPO),
`tcn.star.tcn` (TC_ℕ ⋆ TC_ℕ); operators apply left to right and parentheses
group: `cn.star.(lpo.jump)` is C_ℕ ⋆ LPO′. The engine knows the laws of the
algebra for the reductions marked `algebra` in `data/reductions.yaml`:
P ≤sW P′, P̂, P*; P* ≤sW P̂; P, Q ≤W P × Q ≤W P ⋆ Q; P ≤W P⋄, and P⋄ is closed
under × and ⋆; all operations are monotone (jump and parallelizations also for
≤sW). Papers on completions (C̄_ℕ, …) write them with overlines that text
extraction loses: check the rendered PDF before entering such results. These statements are hidden in
the catalogue unless "Weihrauch operations" is checked.

### 1.3 Tags

Free classification ("Ramsey theory", "Big Five", "induction & bounding", …),
defined in `data/tags.yaml`. Tags are human classification; they are never
used for inference. Statements can have any number of tags.

### 1.4 Properties

Separations in the field are almost always proved by exhibiting a
**property** preserved by one statement and not by another (cone avoidance,
PA avoidance, low basis, Π¹₁-conservation, …). We make this explicit:

```yaml
- id: cone-avoidance
  closedUnder: omega       # the reduction under which it is preserved
  direction: down          # if P has it and P ⇒ Q (over ω), Q has it
```

and the database records `property` results ("RT²₂ admits cone avoidance
[Seetapun–Slaman 1995]"). The engine then:

* propagates properties down implications (and failures up);
* derives a **separation** `P ⊬ Q` at `closedUnder` (hence at every finer
  reduction) whenever P has the property and Q fails it.

So adding a single property fact can yield dozens of separations, each one
justified by a proof tree showing which property was used. It also gives the
"common properties" view for free: the property matrix of a selection.

A property may be **characterized by the base system**
(`baseImplication: omega` on *computably true*): a problem has it exactly when
the bottom of that reduction implies it (RCA₀ ⇒ P over ω-models, i.e. P holds in
every Turing ideal). The engine then derives the property from that comparison
(RCA₀ ⇏ NON over ω gives "NON is not computably true") and conversely (a
published "computably true" gives RCA₀ ⇒ P over ω).

Most properties are defined through instances and solutions ("every Z-computable
instance has a solution Y such that…"): they carry `domain: problems` and only
apply to statements that can be formulated as problems — problems, and sentences
that are not first-order (Π¹₂ principles entered as sentences, such as MTT² or
ATR₀). A sentence that cannot be read as a problem is marked `problemForm: false`.
The viewer says so instead of showing a column of "?".

Properties are related: `implies` lists the properties every statement with this
one also has (computably true ⇒ cone avoidance, low basis, …; low basis ⇒ weakly
low basis), and the engine propagates values both ways (failing the low₂ basis
means failing the low basis). The **lowness hierarchy**
low → weakly low → low₂ → weakly low₂ → … is infinite: its members are marked
`optional`, and a
new level is added to `data/properties.yaml` when a paper proves something about
it (ACA₀'s failure, true at every level, is recorded at the highest level present).

**Arithmetical bases** (every computable instance has a Δ⁰ₙ, Σ⁰ₙ or Π⁰ₙ
solution) are not preservation notions: they cannot be iterated to build
ω-models. A Δ⁰ₙ basis passes along computable reductions (`closedUnder: c`), so it
still yields separations over c and finer reductions; Σ⁰ₙ and Π⁰ₙ bases pass along
no reduction (a set computable from a Σ⁰ₙ set need not be Σ⁰ₙ), so they have no
`closedUnder` and are only related to the other properties (Δ⁰ₙ ⇒ Σ⁰ₙ, Π⁰ₙ ⇒
Δ⁰ₙ₊₁; low ⇒ Δ⁰₂, low₂ ⇒ Δ⁰₃). A consequence: a Π⁰₂ basis for RT²<∞ says nothing
about RT²₂ to the engine; each statement needs its own citation.

**What a statement page lists.** The implications between properties form a
diagram (no cycles: the build checks it). A statement page and the compare
matrix list only its extremal properties (`salientProps` in the engine): the
strongest properties it has and the weakest it fails (the others follow; a
toggle shows them), and the open ones. An open main property is always listed;
an open `optional` one only when it lies in a gap (it implies a property the
statement has and is implied by one it fails) and is the strongest or weakest
open property of that gap. For COH (weakly low basis ✓, low basis ✗) the gap
shows Δ⁰₂, Σ⁰₂ and Π⁰₂ bases as open.

### 1.5 Results (the atomic facts)

`data/results/*.yaml`. Four kinds:

| kind | meaning |
|------|---------|
| `implication` | `from` implies `to` over `over` (i.e. `to ≤_over from`) |
| `separation`  | `from` does **not** imply `to` over `over` |
| `equivalence` | shorthand for two implications |
| `property`    | `statement` has (`value: true`) or fails (`false`) `property` |

Every result has `refs: [{ref: <bibkey>, loc: "Theorem 3.1"}]` and optional
`note`. A result with no reference must be marked `folklore: true` — so the
database distinguishes "trivial/folklore" from "missing citation".

**Provenance.** Folklore results carry a `justification`:

```yaml
justification:
  kind: restriction | reduction | classical | personal-communication | unreferenced
  text: "A 2-coloring is a 3-coloring with the same homogeneous sets."
  by: ai            # present when the argument was written by an AI assistant
```

Results that were not taken from the literature at all, but derived by an AI
assistant (typically restrictions of instances or one-line reductions that no
paper states), are marked `provenance: ai` and must have a justification.
They live in `data/results/ai-derived.yaml`. The viewer shows them with an
"AI-derived" badge, and the Results page can filter by provenance, so they can
be reviewed and either confirmed (add a reference, drop `provenance`) or
removed.

Results are grouped into files by topic, but nothing depends on the grouping;
a natural contribution workflow is "one paper → append its theorems".

### 1.5b Formula classes

Conservation results ("T is Γ-conservative over S") and the `form` of a
statement refer to syntactic classes defined in `data/classes.yaml`: each class
has a notation, a definition, older notations (`aliases`, e.g. Π̃⁰₃ for ∀Π⁰₃)
and the classes it `includes`. The engine closes `includes` transitively, so a
Π¹₁-conservation result also applies to ∀Π⁰₄, Π⁰₃, … sentences. The About page
lists the classes with their definitions.

### 1.5c Open questions

`data/questions.yaml` records the questions stated in the literature. A
question is either free text with a hand-written status, or *formal*: a list of
comparisons `{from, to, over}`. For a formal question the status is computed
(`questionStatus` in the engine): resolved if the engine settles every
comparison, partial if it settles some. Its answering papers are the citations
of the proofs, restricted to papers that appeared after the question was first
asked, unless `resolvedBy` names them. This keeps the list of open problems in
sync with the results: nobody has to remember to close a question.

### 1.6 References

Each reference may record how far it was read when the database was built:
`read: pdf-zotero | pdf-arxiv | pdf-oa | abstract | screened` (absent: not read). Only
`pdf-*` entries had their full text parsed; `abstract` entries were read from
their abstract only (so theorem numbers may be missing), and `screened` ones
were only scanned by keywords. The Literature page can filter on this status. The texts
themselves are kept in a git-ignored local cache (`cache/fulltext/`, filled by
`scripts/fulltext.mjs`), so that papers can be mined again without being
downloaded again.


`data/references.yaml`, keyed by citation key; author list, title, venue,
year, DOI/URL. Statements cite references with a *role*: `origin` (where it
was introduced), `rm` (first reverse-mathematical analysis), `survey`.
The literature page lists, for every paper, the statements it introduced and
every result citing it.

## 2. The inference engine (`site/js/engine.js`)

Facts are `I(R,a,b)` (a implies b over R), `N(R,a,b)` (a does not imply b
over R), and `Has(p,s)` / `Lacks(p,s)`. Rules:

| rule | from | derive |
|------|------|--------|
| refl | — | `I(R,a,a)` |
| base | b is base | `I(R,a,b)` |
| ω-first-order | b first-order, R = ω-like | `I(R,a,b)` |
| conj-elim / conj-intro | conjunctions | `I(R,a+b,a)`, `I(R,x,a)∧I(R,x,b) ⇒ I(R,x,a+b)` |
| trans | `I(R,a,b)`, `I(R,b,c)` | `I(R,a,c)` |
| coarsen | `I(R',a,b)`, R' finer than R | `I(R,a,b)` |
| prop-down / prop-up | `Has(p,a)`, `I(Rp,a,b)` | `Has(p,b)` (and dually for `Lacks`) |
| prop-sep | `Has(p,a)`, `Lacks(p,b)` | `N(Rp,a,b)` |
| refine | `N(R,a,b)`, R' finer than R | `N(R',a,b)` |
| weaken-left | `N(R,a,c)`, `I(R,a,b)` | `N(R,b,c)` |
| strengthen-right | `N(R,a,c)`, `I(R,d,c)` | `N(R,a,d)` |

Implications are saturated first (worklist), then properties, then
non-implications reduction by reduction from coarse to fine. Each fact
remembers the first rule that produced it; since direct results are seeded
first and the worklist is FIFO, proofs are short. The engine reports
**contradictions** (both `I` and `N` derived for the same pair) — these are
data errors, and the build fails on them.

Everything not derivable is **open**. The viewer distinguishes "open" from
"not applicable" (e.g. BΣ⁰₂ vs. a Weihrauch reduction).

## 3. The viewer

* **Catalogue** — searchable (acronym, name, aliases, definition, tags),
  faceted by tag, grouped by principle with formulations nested under the
  main one. Each card can be added to the *selection*.
* **Statement page** — in tabs (kept in the URL, `#/s/coh?tab=position`):
  *Overview* (definition, instance/solution reading, context, related
  statements), *Position* (formulations with their equivalence profile; what
  it implies / is implied by / fails to imply), *Properties* (with proofs),
  *Literature*, *Questions* (when there are some) and *Results*. **Related
  statements** (`site/js/related.js`) are those worth comparing it with: the
  ones studied in the same papers (results citing the paper, or its literature
  list), papers about many statements counting less and very common statements
  (ACA₀, WKL₀) slightly less, then the same tags; base systems, operator
  statements and formulations of the same principle are left out.
* **Diagram** — for the selection and a chosen reduction: the Hasse diagram
  of the induced order (on equivalence classes), with optional separation and
  open-question arrows reduced to their non-redundant core (strongest
  hypothesis, weakest conclusion). Laid out by a custom layered
  (Sugiyama-style) algorithm: longest-path layering so that vertical position
  reads as strength, dummy vertices for long edges, barycentric crossing
  reduction, then smooth curves. Hovering a node highlights what it implies
  and what implies it; clicking an arrow shows its proof tree.
* **Compare** — the pairwise matrix of the selection across *all* reductions
  at once (each cell is a miniature of the reduction lattice coloured
  ✓/✗/?) and the property matrix.
* **Results / Literature** — the raw database, filterable, and the
  bibliography with what each paper contributes.

The state (selection, reduction, toggles) is in the URL, so diagrams can be
shared by link.

## 4. Why not Graphviz?

Graphviz lays out an arbitrary digraph; here the graph is a *partial order*
with a very specific reading (up = stronger), heavy equivalence collapsing,
and two kinds of arrows of which only one (implications) should drive the
layout. A dedicated layered layout gives: stable vertical meaning, separation
arrows that don't distort the picture, HTML/KaTeX node labels, and
interactivity (hover cones, click-for-proof) without an SVG post-processing
step. The layout code is ~300 lines and has no dependency.
