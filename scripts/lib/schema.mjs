// The data model: every field allowed in data/*.yaml, what it means, and which
// code reads it. This file is the reference for the data format:
//   - scripts/build.mjs rejects any field not listed here (typos, YAML mistakes
//     such as an unquoted "loc: Section 1, (5)" that YAML splits into two keys);
//   - tests/schema.test.mjs checks that every file named in `usedBy` still reads
//     the field, so this map cannot silently go stale.
//
// When you add, rename or change the meaning of a field: update this file, then
// go through every file in its `usedBy` list (and the procedures in AGENTS.md,
// "Change-impact checklist") and adapt them.
//
// Field spec: { doc, req?: true, usedBy: [file keys] }. `usedBy: []` means the
// field is documentation for human readers only.
// Fields starting with "_" are added by the build (file, git dates) and never written by hand.

export const FILES = {
  engine: 'site/js/engine.js',          // inference engine (browser and Node)
  viewer: 'site/js/app.js',             // the web viewer
  bibtex: 'site/js/bibtex.js',          // BibTeX export
  build: 'scripts/build.mjs',           // validation + site/data/zoo.json
  consolidate: 'scripts/consolidate.mjs',
  sweep: 'scripts/sweep.mjs',
  pubstatus: 'scripts/pubstatus.mjs',
  fulltext: 'scripts/fulltext.mjs',
  abstracts: 'scripts/abstracts.mjs',
  pdfAbstracts: 'scripts/pdf-abstracts.mjs',
  addResults: 'scripts/add-results.mjs',
  mineCommon: 'scripts/mine/common.mjs',
  mineFacts: 'scripts/mine/facts.mjs',
  mineQuestions: 'scripts/mine/questions.mjs',
  aiAnalyze: 'scripts/ai-analyze.mjs',  // AI reading of the full texts
  aiReview: 'scripts/ai-review.mjs',    // human decisions on its proposals
  results: 'scripts/lib/results.mjs',   // writing results without duplicates
};

const cite = (extra = {}) => ({
  ref: { req: true, doc: 'reference key (data/references/*.yaml)', usedBy: ['build', 'viewer', 'results'] },
  loc: { doc: 'where in the paper: theorem number, section… (quote it if it contains ", " or ": ")', usedBy: ['viewer', 'results'] },
  ...extra,
});

export const SCHEMA = {
  // data/statements/*.yaml — a list
  statement: {
    id: { req: true, doc: 'unique id; lowercase. Operator statements use dotted ids (lpo.jump, cn.x.wkl), conjunctions "a-b" (sorted conjuncts)', usedBy: ['build', 'engine', 'viewer'] },
    label: { doc: 'TeX label (required except for conjunctions and operator statements, which get one from their parts)', usedBy: ['build', 'viewer', 'consolidate', 'mineCommon'] },
    name: { doc: 'full English name', usedBy: ['build', 'viewer', 'consolidate'] },
    kind: { req: true, doc: 'problem (instance/solution form, can be compared by Weihrauch-style reductions) | sentence', usedBy: ['build', 'engine', 'viewer'] },
    tags: { doc: 'topic tags (data/tags.yaml)', usedBy: ['build', 'engine', 'viewer'] },
    aliases: { doc: 'other names and spellings; used by search and by the missing-statement check of consolidate', usedBy: ['viewer', 'consolidate'] },
    definition: { doc: 'definition in prose ($…$ for TeX)', usedBy: ['build', 'viewer'] },
    instance: { doc: 'for problems: what an instance is', usedBy: ['build', 'viewer'] },
    solution: { doc: 'for problems: what a solution is', usedBy: ['build', 'viewer'] },
    refs: { doc: 'papers introducing or studying it: [{ref, role, loc}]', usedBy: ['build', 'viewer', 'consolidate'], items: 'statementRef' },
    todo: { doc: 'the definition still needs to be checked against the source (free text); listed by consolidate', usedBy: ['viewer', 'consolidate'] },
    base: { doc: 'reductions in which this statement is the bottom (e.g. [rca0] for RCA₀ itself)', usedBy: ['engine', 'build', 'viewer'] },
    priority: { doc: 'ranking boost in search results', usedBy: ['engine'] },
    firstOrder: { doc: 'true for first-order (arithmetical) sentences: they hold in every ω-model', usedBy: ['build', 'engine', 'viewer'] },
    formulationOf: { doc: 'id of the main formulation this statement is a variant of', usedBy: ['build', 'engine', 'viewer'] },
    conjunction: { doc: 'ids of the conjuncts (kind must be sentence)', usedBy: ['build', 'engine', 'viewer', 'mineCommon'] },
    form: { doc: 'syntactic class of the sentence (data/classes.yaml), used for conservation results', usedBy: ['build', 'engine', 'viewer'] },
    op: { doc: 'Weihrauch operation: jump | par | fin | diamond | product | compose (normally created by the build from dotted ids)', usedBy: ['build', 'engine', 'viewer', 'mineCommon'] },
    args: { doc: 'arguments of op (ids of problems)', usedBy: ['build', 'engine', 'viewer', 'mineCommon'] },
    problemForm: { doc: 'false for a sentence that cannot be formulated as a problem (instances and solutions): properties with domain problems do not apply. First-order sentences are excluded without it', usedBy: ['build', 'engine'] },
  },
  statementRef: cite({ role: { doc: 'rm (studied) | def (defined) | … ; shown in the viewer', usedBy: ['viewer'] } }),

  // data/results/**/*.yaml — a list
  result: {
    type: { req: true, doc: 'implication | separation | equivalence | conservation | property', usedBy: ['build', 'engine', 'viewer'] },
    from: { doc: 'implication/separation/equivalence: the stronger side ("from implies to")', usedBy: ['build', 'engine', 'viewer', 'consolidate'] },
    to: { doc: 'implication/separation/equivalence: the other side', usedBy: ['build', 'engine', 'viewer', 'consolidate'] },
    over: { doc: 'reduction id, or a list of them (data/reductions.yaml)', usedBy: ['build', 'engine', 'viewer', 'consolidate'] },
    statement: { doc: 'conservation/property: the statement', usedBy: ['build', 'engine', 'viewer'] },
    base: { doc: 'conservation: the base system (a statement id)', usedBy: ['build', 'engine', 'viewer'] },
    class: { doc: 'conservation: formula class (data/classes.yaml)', usedBy: ['build', 'engine', 'viewer'] },
    property: { doc: 'property: property id (data/properties.yaml)', usedBy: ['build', 'engine', 'viewer'] },
    value: { doc: 'property: true or false', usedBy: ['build', 'engine', 'viewer'] },
    refs: { doc: 'citations [{ref, loc}]; required unless folklore or provenance: ai', usedBy: ['build', 'viewer', 'results'], items: 'resultRef' },
    folklore: { doc: 'true when the fact is folklore (then a justification explains it)', usedBy: ['build', 'viewer', 'results'] },
    provenance: { doc: 'ai: derived by an AI, with a justification; never for facts read in a paper', usedBy: ['build', 'viewer'] },
    justification: { doc: 'argument for folklore / AI-derived facts', usedBy: ['build', 'viewer'], fields: 'justification' },
    note: { doc: 'short remark shown with the result (quote it if it contains ", " or ": ")', usedBy: ['viewer', 'results'] },
  },
  resultRef: cite(),
  justification: {
    kind: { req: true, doc: 'restriction | reduction | classical | personal-communication | unreferenced', usedBy: ['build', 'viewer'] },
    by: { doc: 'who wrote it (e.g. ai, or a person)', usedBy: ['viewer'] },
    text: { req: true, doc: 'the argument ($…$ for TeX, [@key] cites a paper)', usedBy: ['build', 'viewer'] },
  },

  // data/references/*.yaml — a map key → reference
  reference: {
    authors: { req: true, doc: 'list of "First Last"', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'consolidate'] },
    title: { req: true, doc: 'title ($…$ for TeX)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'fulltext', 'abstracts', 'consolidate'] },
    year: { req: true, doc: 'publication year (preprint year if unpublished)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'consolidate', 'mineFacts', 'mineQuestions'] },
    venue: { doc: 'journal/book with volume and pages, or "arXiv preprint"', usedBy: ['viewer', 'bibtex', 'sweep', 'pubstatus'] },
    doi: { doc: 'DOI (unique across references)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'fulltext', 'abstracts', 'consolidate'] },
    arxiv: { doc: 'arXiv id (unique unless `version` links the two)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'fulltext', 'abstracts', 'consolidate'] },
    url: { doc: 'link when there is no DOI', usedBy: ['viewer', 'bibtex', 'fulltext'] },
    source: { doc: 'where the entry came from (zbmath, arxiv, rmzoo, …)', usedBy: ['viewer', 'sweep'] },
    read: { doc: 'how its content was checked: pdf-zotero | pdf-arxiv | pdf-oa | abstract | screened (written by fulltext.mjs)', usedBy: ['build', 'viewer', 'fulltext'] },
    preprintYear: { doc: 'year of the preprint, when `year` became the publication year (written by pubstatus.mjs)', usedBy: ['pubstatus'] },
    version: { doc: 'key of another version of the same work (conference vs journal)', usedBy: ['build'] },
  },

  // data/reductions.yaml
  reduction: {
    id: { req: true, doc: 'rca0star | rca0 | omega | sw | w | sc | c | gw', usedBy: ['build', 'engine', 'viewer'] },
    name: { req: true, doc: 'name', usedBy: ['viewer'] },
    short: { doc: 'short name for chips and tables', usedBy: ['viewer'] },
    tex: { doc: 'TeX notation (documentation)', usedBy: [] },
    phrase: { doc: 'how "A ⇒ B" reads in prose (documentation)', usedBy: [] },
    description: { doc: 'explanation', usedBy: ['viewer'] },
    domain: { doc: 'all | problems (compares only problems)', usedBy: ['engine'] },
    finerThan: { doc: 'reductions this one directly refines', usedBy: ['build', 'engine', 'viewer'] },
    conjunction: { doc: 'true when "P + Q" behaves as a conjunction', usedBy: ['engine'] },
    conservation: { doc: 'true when conservation results yield separations here', usedBy: ['engine'] },
    omegaModels: { doc: 'true when first-order sentences are free (ω-models)', usedBy: ['engine'] },
    algebra: { doc: 'strong | weak: which laws of the Weihrauch algebra hold (operator statements)', usedBy: ['engine'] },
    refs: { doc: 'references', usedBy: ['viewer'], items: 'resultRef' },
  },
  tag: {
    id: { req: true, doc: 'tag id', usedBy: ['build', 'viewer'] },
    name: { req: true, doc: 'name', usedBy: ['viewer'] },
    description: { doc: 'description', usedBy: ['viewer'] },
  },
  property: {
    id: { req: true, doc: 'property id (cone-avoidance, …)', usedBy: ['build', 'engine', 'viewer'] },
    name: { req: true, doc: 'name', usedBy: ['viewer'] },
    closedUnder: { doc: 'reduction under which it is preserved; absent when no reduction preserves it (Σ⁰ₙ and Π⁰ₙ bases: a set computable from a Σ⁰ₙ set need not be Σ⁰ₙ)', usedBy: ['build', 'engine', 'viewer'] },
    direction: { doc: 'down | up (with closedUnder)', usedBy: ['build', 'engine'] },
    description: { doc: 'definition', usedBy: ['viewer'] },
    fromConservation: { doc: 'the property follows from a conservation result over this class', usedBy: ['engine'] },
    baseImplication: { doc: 'reduction r such that a problem has the property exactly when the bottom of r implies it over r (computably true: omega)', usedBy: ['build', 'engine'] },
    domain: { doc: 'problems: defined through instances and solutions, so it only applies to statements formulated as problems (see statement.problemForm)', usedBy: ['build', 'engine', 'aiAnalyze'] },
    implies: { doc: 'properties every statement having this one also has (low basis ⇒ weakly low basis); failing one of them means failing this one; no cycles. Statement pages list only the extremal properties (engine salientProps)', usedBy: ['build', 'engine'] },
    optional: { doc: 'member of an infinite family (low_n, Σ⁰_n basis…): listed for a statement only when it is an extremal known property, or an extremal open one between a property it has and one it fails (engine salientProps)', usedBy: ['engine'] },
  },
  zoo: {
    id: { req: true, doc: 'preset id', usedBy: ['build', 'viewer'] },
    name: { req: true, doc: 'name', usedBy: ['viewer'] },
    reduction: { req: true, doc: 'reduction shown', usedBy: ['build', 'viewer'] },
    description: { doc: 'description', usedBy: ['viewer'] },
    statements: { req: true, doc: 'statement ids (dotted operator ids allowed)', usedBy: ['build', 'viewer'] },
  },
  class: {
    id: { req: true, doc: 'class id (pi11, api02, …)', usedBy: ['build', 'engine', 'viewer'] },
    notation: { req: true, doc: 'TeX notation', usedBy: ['build', 'viewer'] },
    name: { doc: 'name', usedBy: ['viewer'] },
    definition: { req: true, doc: 'definition', usedBy: ['build', 'viewer'] },
    includes: { doc: 'classes it directly contains', usedBy: ['build', 'engine', 'viewer'] },
    aliases: { doc: 'older notations (e.g. Π̃⁰ₙ for ∀Π⁰ₙ)', usedBy: ['viewer'] },
  },
  // data/questions.yaml (format documented at the top of that file)
  question: {
    id: { req: true, doc: 'slug', usedBy: ['build', 'viewer', 'consolidate'] },
    question: { req: true, doc: 'the question, in our own words', usedBy: ['build', 'viewer'] },
    asked: { req: true, doc: 'every paper that asked it [{ref, loc}]', usedBy: ['build', 'viewer', 'consolidate', 'mineQuestions'], items: 'resultRef' },
    statements: { doc: 'statements it is about', usedBy: ['build', 'viewer'] },
    formal: { doc: 'comparisons [{from, to, over}] from which the status is derived', usedBy: ['build', 'engine', 'viewer'], items: 'formalPart' },
    status: { doc: 'open | partial | resolved — required without formal; must agree with the database otherwise', usedBy: ['build', 'engine', 'viewer', 'consolidate'] },
    answer: { doc: 'short answer when resolved', usedBy: ['viewer'] },
    resolvedBy: { doc: 'papers that answered it [{ref, loc}]', usedBy: ['build', 'viewer'], items: 'resultRef' },
    kind: { doc: 'question (default) | conjecture', usedBy: ['build', 'viewer'] },
    context: { doc: 'background; [@key] cites a reference', usedBy: ['build', 'viewer'] },
  },
  formalPart: {
    from: { req: true, doc: 'does `from` imply `to`…', usedBy: ['build', 'engine'] },
    to: { req: true, doc: '…', usedBy: ['build', 'engine'] },
    over: { req: true, doc: '…over this reduction?', usedBy: ['build', 'engine'] },
  },
  // data/abstracts.yaml — a map key → abstract (written by abstracts.mjs, pdf-abstracts.mjs)
  abstract: {
    source: { req: true, doc: 'arxiv | pdf | openalex', usedBy: ['build', 'abstracts', 'pdfAbstracts'] },
    text: { req: true, doc: 'the abstract (TeX kept when the source has it)', usedBy: ['build', 'abstracts', 'pdfAbstracts'] },
    arxiv: { doc: 'arXiv id it was taken from', usedBy: ['build', 'abstracts'] },
  },
  // data/sweep-rejected.yaml — a list (read by sweep.mjs)
  sweepRejected: {
    title: { req: true, doc: 'title of the rejected paper', usedBy: ['sweep'] },
    doi: { doc: 'its DOI', usedBy: ['sweep'] },
    reason: { req: true, doc: 'why it is out of scope', usedBy: [] },
  },
  // data/ai-review.yaml — a list: facts proposed by ai-analyze.mjs awaiting a human
  // decision (scripts/ai-review.mjs, later a web backend). Never delete items.
  aiReview: {
    id: { req: true, doc: '<refkey>-<n> (result n of the extraction) or <refkey>-s<n> (missing statement n)', usedBy: ['aiAnalyze', 'aiReview'] },
    ref: { req: true, doc: 'the analyzed paper', usedBy: ['aiAnalyze', 'aiReview'] },
    date: { req: true, doc: 'date of the analysis', usedBy: ['aiAnalyze', 'aiReview'] },
    status: { req: true, doc: 'pending | accepted | rejected | done (treated by hand)', usedBy: ['aiAnalyze', 'aiReview'] },
    kind: { req: true, doc: 'result (a proposed fact) | statement (a principle missing from the catalogue)', usedBy: ['aiAnalyze', 'aiReview'] },
    result: { doc: 'result: the proposed entry, as in data/results/ without refs; edit it before accepting if needed', usedBy: ['aiAnalyze', 'aiReview'] },
    loc: { doc: 'result: theorem number in the paper', usedBy: ['aiAnalyze', 'aiReview'] },
    origin: { doc: 'result: stated (the paper states it) | cited (the paper attributes it to citedFrom) | special-case (instance of one stated result) | deduced', usedBy: ['aiAnalyze', 'aiReview'] },
    quote: { doc: 'result: verbatim passage of the extracted text', usedBy: ['aiAnalyze'] },
    paperNotation: { doc: "result: the paper's notation, when it differs from the catalogue", usedBy: ['aiAnalyze'] },
    argument: { doc: 'result: for special cases and deductions, the argument', usedBy: ['aiAnalyze', 'aiReview'] },
    citedFrom: { doc: 'result: the work the paper attributes the fact to', usedBy: ['aiAnalyze', 'aiReview'] },
    confidence: { doc: "result: the extractor's confidence (high | medium | low)", usedBy: ['aiAnalyze', 'aiReview'] },
    concerns: { doc: 'result: what the extractor thinks a human should check', usedBy: ['aiAnalyze'] },
    verifier: { doc: 'result: {verdict: confirmed | rejected | unsure, reason} of the independent verification call', usedBy: ['aiAnalyze'] },
    statement: { doc: 'statement: {notation, name, loc, definition, facts} as read in the paper', usedBy: ['aiAnalyze', 'aiReview'] },
    reasons: { req: true, doc: 'why a human must decide (unknown id, quote not found, low confidence, verifier not confirming…)', usedBy: ['aiAnalyze', 'aiReview'] },
    decision: { doc: '{date, by, note} once treated', usedBy: ['aiReview'] },
  },
  // data/ai-analyzed.yaml — a map refkey → record: papers already read by ai-analyze.mjs
  aiAnalyzed: {
    date: { req: true, doc: 'date of the analysis', usedBy: ['aiAnalyze'] },
    model: { req: true, doc: 'model that read the paper', usedBy: ['aiAnalyze'] },
    textHash: { req: true, doc: 'sha256 prefix of the text read (a new version of the text can be analyzed with --redo)', usedBy: ['aiAnalyze'] },
    facts: { req: true, doc: 'number of facts proposed', usedBy: ['aiAnalyze'] },
    added: { req: true, doc: 'number of results added or citations merged (all runs)', usedBy: ['aiAnalyze'] },
    review: { req: true, doc: 'number of items sent to data/ai-review.yaml', usedBy: ['aiAnalyze'] },
    dropped: { req: true, doc: 'number of cited/deduced facts dropped because the database already has them', usedBy: ['aiAnalyze'] },
    changes: { doc: 'the database changes ("added: <resultKey>", "merged: …"), to audit or undo them', usedBy: ['aiAnalyze'] },
    cost: { doc: 'cost of the two calls in dollars (estimate)', usedBy: ['aiAnalyze'] },
  },
};

// Operations of the Weihrauch algebra (statement field `op`). `dotted` is the
// name in dotted ids (lpo.jump, cn.x.wkl, tcn.star.tcn). Adding one requires: the
// build (label, name, definition: fillOp), the engine (laws), the viewer (op line),
// the miner (textual forms in scripts/mine/common.mjs); tests/schema.test.mjs checks them.
export const OPERATIONS = {
  jump: { arity: 1, dotted: 'jump' },
  par: { arity: 1, dotted: 'par' },
  fin: { arity: 1, dotted: 'fin' },
  diamond: { arity: 1, dotted: 'diamond' },
  product: { arity: 2, dotted: 'x' },
  compose: { arity: 2, dotted: 'star' },
};

// Other data files with a simple shape (not entity lists):
//   data/context.yaml          statement id → background text ([@key] citations)
//   data/fulltext-exclude.yaml reference key → {zotero, reason}: Zotero items not to use
//   data/screened.yaml         {facts, questions, resolutions}: leads already examined
//   data/acronyms-ignored.yaml acronym → reason: not proposed as missing statements
//   data/ai-review.yaml        entity aiReview above; data/ai-analyzed.yaml: aiAnalyzed

// Unknown fields of `obj` (and of its nested citations), as error messages.
export function unknownFields(obj, entity, where) {
  const spec = SCHEMA[entity];
  const errs = [];
  if (!obj || typeof obj !== 'object') return errs;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    const f = spec[k];
    if (!f) { errs.push(`${where}: unknown field "${k}" (allowed: ${Object.keys(spec).join(', ')}; see scripts/lib/schema.mjs)`); continue; }
    if (f.items && Array.isArray(v)) v.forEach((x, i) => errs.push(...unknownFields(x, f.items, `${where}, ${k}[${i}]`)));
    if (f.fields) errs.push(...unknownFields(v, f.fields, `${where}, ${k}`));
  }
  return errs;
}

// Two results state the same fact when they have the same key (built from
// type, from/statement, to/property/base, over/class, value) (then their
// citations must be merged into one entry). Used by the build and add-results.mjs.
export const resultKey = (r) => [r.type, r.from ?? r.statement, r.to ?? r.property ?? r.base, [].concat(r.over ?? r.class ?? '').join(','), r.value ?? ''].join('|');
