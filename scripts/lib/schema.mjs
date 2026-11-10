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
  related: 'site/js/related.js',        // related statements on a statement page
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
  review: 'scripts/review.mjs',         // the review queue: listing, decisions, applying votes
  reviewLib: 'site/js/review.js',       // review statuses and kinds (viewer, build, scripts)
  reviewQueue: 'scripts/lib/review-queue.mjs', // writing the queue: new proposals, repeats of decided ones
  results: 'scripts/lib/results.mjs',   // writing results without duplicates
  community: 'site/js/community.js',    // endorsements and comments in the viewer
  api: 'site/api/index.php',            // endorsement and review server (PHP, live instance)
  apiLib: 'site/api/lib.php',           // its storage
  endorseSync: 'scripts/endorsements-sync.mjs', // server → data/endorsements.yaml, feedback/
  uploadsSync: 'scripts/uploads-sync.mjs', // server → cache/fulltext/ (full texts uploaded by researchers)
  zbmath: 'scripts/zbmath.mjs',          // zbMATH identifiers of the references, authors' ORCID iDs
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
    phrases: { doc: 'names in words that papers use instead of the label ("generalized Higman\'s theorem"), read by the miners as the statement; case, apostrophes and hyphens do not matter', usedBy: ['build', 'mineCommon'] },
    aliases: { doc: 'other names and spellings; used by search and by the missing-statement check of consolidate', usedBy: ['viewer', 'consolidate'] },
    definition: { doc: 'definition in prose ($…$ for TeX)', usedBy: ['build', 'viewer'] },
    instance: { doc: 'for problems: what an instance is', usedBy: ['build', 'viewer'] },
    solution: { doc: 'for problems: what a solution is', usedBy: ['build', 'viewer'] },
    refs: { doc: 'papers introducing or studying it: [{ref, role, loc}]', usedBy: ['build', 'viewer', 'consolidate'], items: 'statementRef' },
    caution: { doc: 'warning shown with the statement when its name or acronym is misleading: the same acronym names another principle in some papers, or the label is read differently in another framework. Free text with $…$, [@ref] citations and [[id]] links to statements', usedBy: ['build', 'viewer', 'aiAnalyze'] },
    todo: { doc: 'the definition still needs to be checked against the source (free text); listed by consolidate', usedBy: ['viewer', 'consolidate'] },
    base: { doc: 'reductions in which this statement is the bottom (e.g. [rca0] for RCA₀ itself)', usedBy: ['engine', 'build', 'viewer'] },
    priority: { doc: 'ranking boost in search results', usedBy: ['engine'] },
    firstOrder: { doc: 'true for first-order (arithmetical) sentences: they hold in every ω-model', usedBy: ['build', 'engine', 'viewer'] },
    formulationOf: { doc: 'id of the main formulation this statement is a variant of', usedBy: ['build', 'engine', 'viewer'] },
    _modes: { doc: '(build) the modes the statement belongs to (data/modes.yaml)', usedBy: ['build', 'viewer'] },
    _concepts: { doc: '(build) ids of the concepts (data/concepts.yaml) its definition, instance or solution mentions', usedBy: ['build', 'viewer'] },
    minor: { doc: 'true for a statement studied in few papers or of secondary interest (a classical theorem equivalent to a Big Five system, a technical variant): hidden from the catalogue by default, not counted on the home page or in the implication counts, left out of related statements, listed as an equivalent statement on the pages of the statements equivalent to it', usedBy: ['build', 'viewer', 'related'] },
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
    refs: { doc: 'citations [{ref, loc}]; required unless folklore or provenance', usedBy: ['build', 'viewer', 'results'], items: 'resultRef' },
    folklore: { doc: 'true when the fact is folklore (then a justification explains it)', usedBy: ['build', 'viewer', 'results'] },
    provenance: { doc: 'direct: an immediate consequence (specialization, restriction of instances) of a cited result, with the argument (written by an AI: justification.by); ai: a non-trivial derivation by an AI, with a justification. Never for facts read in a paper', usedBy: ['build', 'viewer', 'results', 'reviewLib'] },
    justification: { doc: 'argument for folklore / AI-derived facts', usedBy: ['build', 'viewer'], fields: 'justification' },
    note: { doc: 'short remark shown with the result (quote it if it contains ", " or ": ")', usedBy: ['viewer', 'results'] },
  },
  resultRef: cite(),
  justification: {
    kind: { req: true, doc: 'restriction | reduction | classical | personal-communication | unreferenced', usedBy: ['build', 'viewer'] },
    by: { doc: 'who wrote it (e.g. ai, or a person)', usedBy: ['viewer'] },
    text: { req: true, doc: 'the argument ($…$ for TeX, [@key] cites a paper); with steps, the claim and the strategy of the proof', usedBy: ['build', 'viewer'] },
    steps: { doc: 'a longer proof as a list of steps, numbered in the viewer (collapsed under the result, expanded on its page #/result/<key>); same conventions as text', usedBy: ['build', 'viewer'] },
  },

  // data/references/*.yaml — a map key → reference
  reference: {
    authors: { req: true, doc: 'list of "First Last"', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'consolidate'] },
    title: { req: true, doc: 'title ($…$ for TeX)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'fulltext', 'abstracts', 'consolidate'] },
    year: { req: true, doc: 'publication year (preprint year if unpublished)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'consolidate', 'mineFacts', 'mineQuestions'] },
    venue: { doc: 'journal/book with volume and pages, or "arXiv preprint"', usedBy: ['viewer', 'bibtex', 'sweep', 'pubstatus'] },
    zbmath: { doc: 'zbMATH Open identifier (Zbl number, e.g. 1214.03047; JFM number, e.g. 55.0032.04; or arXiv:<id> for an indexed preprint), written by scripts/zbmath.mjs; versions of one work (version) may share it', usedBy: ['build', 'viewer', 'zbmath'] },
    zbmathAuthors: { doc: 'zbMATH author codes of its authors, in order (data/authors.yaml), written by scripts/zbmath.mjs', usedBy: ['build', 'viewer', 'zbmath'] },
    doi: { doc: 'DOI, of the form 10.<registrant>/<suffix> without TeX escapes (unique across references; an arXiv id goes in arxiv)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'fulltext', 'abstracts', 'consolidate'] },
    arxiv: { doc: 'arXiv id (unique unless `version` links the two)', usedBy: ['build', 'viewer', 'bibtex', 'sweep', 'pubstatus', 'fulltext', 'abstracts', 'consolidate'] },
    url: { doc: 'link when there is no DOI', usedBy: ['viewer', 'bibtex', 'fulltext'] },
    source: { doc: 'where the entry came from (zbmath, arxiv, rmzoo, review: added from the review page, …)', usedBy: ['viewer', 'sweep'] },
    read: { doc: 'how its content was checked: pdf-zotero | pdf-arxiv | pdf-oa | pdf-author (uploaded by a researcher) | pdf-local (a copy the maintainer placed by hand) | abstract | screened (written by fulltext.mjs)', usedBy: ['build', 'viewer', 'fulltext', 'uploadsSync'] },
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
    direction: { doc: 'down | up | equiv (with closedUnder). equiv: a Weihrauch property, invariant under equivalence over closedUnder and not preserved downwards (it separates nothing)', usedBy: ['build', 'engine'] },
    group: { req: true, doc: 'computability | proof | weihrauch: the viewer lists the groups separately, and a mode shows the groups listed in its properties field', usedBy: ['build', 'viewer'] },
    selfOp: { doc: 'operation such that the statement has the property exactly when it implies that operation applied to itself over closedUnder (idempotent: product, parallelizable: par, closed under compositional product: compose)', usedBy: ['build', 'engine'] },
    opHas: { doc: 'operations whose results always have the property (par: parallelizable)', usedBy: ['build', 'engine'] },
    opKeeps: { doc: 'operations whose results have the property when all their arguments do (jump: cylinder)', usedBy: ['build', 'engine'] },
    lift: { doc: '{from, to}: a statement with the property implies over `to` what it implies over `from` (cylinder: from w to sw)', usedBy: ['build', 'engine'] },
    description: { doc: 'definition', usedBy: ['viewer'] },
    fromConservation: { doc: 'the property follows from a conservation result over this class', usedBy: ['engine'] },
    bottomOf: { doc: 'reduction r such that a problem with the property is below every problem of the domain of r (computably true: c, assuming every problem has an instance computable from any set)', usedBy: ['build', 'engine'] },
    baseImplication: { doc: 'reduction r such that a problem has the property exactly when the bottom of r implies it over r (computably true: omega)', usedBy: ['build', 'engine'] },
    domain: { doc: 'problems: defined through instances and solutions, so it only applies to statements formulated as problems (see statement.problemForm)', usedBy: ['build', 'engine', 'aiAnalyze'] },
    implies: { doc: 'properties every statement having this one also has (low basis ⇒ weakly low basis); failing one of them means failing this one; no cycles. Statement pages list only the extremal properties (engine salientProps)', usedBy: ['build', 'engine'] },
    optional: { doc: 'member of an infinite family (low_n, Σ⁰_n basis…): listed for a statement only when it is an extremal known property, or an extremal open one between a property it has and one it fails (engine salientProps)', usedBy: ['engine'] },
  },
  // data/concepts.yaml — sourced definitions of the words used in statement definitions
  concept: {
    id: { req: true, doc: 'concept id', usedBy: ['build', 'viewer'] },
    term: { req: true, doc: 'the term as displayed (Homogeneous set)', usedBy: ['viewer'] },
    match: { req: true, doc: 'case-insensitive regular expressions, matched on word boundaries in the definition, instance and solution of each statement', usedBy: ['build'] },
    skip: { doc: 'statements where a matching word has another meaning (homogeneous for RSAT)', usedBy: ['build'] },
    definition: { req: true, doc: 'the definition, following its source ($…$ for TeX)', usedBy: ['build', 'viewer'] },
    refs: { req: true, doc: 'sources of the definition: [{ref, loc}]', usedBy: ['build', 'viewer'], items: 'resultRef' },
  },
  // data/errata.yaml — a list: wrong statements or claims of papers (shown on the paper's page)
  erratum: {
    ref: { req: true, doc: 'the paper (reference key)', usedBy: ['build', 'viewer'] },
    loc: { req: true, doc: 'where: theorem number, proof of…', usedBy: ['build', 'viewer'] },
    kind: { req: true, doc: 'misprint (the proof gives the right statement) | error (the claim is false) | gap (the proof is incomplete)', usedBy: ['build', 'viewer'] },
    claim: { req: true, doc: 'what the paper says ($…$ for TeX)', usedBy: ['build', 'viewer'] },
    correction: { req: true, doc: 'the correct statement and why ([@key] cites a paper, [[id]] links a statement)', usedBy: ['build', 'viewer'] },
    refs: { doc: 'sources of the correction [{ref, loc}]', usedBy: ['build', 'viewer'], items: 'resultRef' },
    date: { doc: 'when it was entered', usedBy: ['viewer'] },
  },
  // data/modes.yaml — lenses of the viewer: what a reader of one framework sees
  mode: {
    id: { req: true, doc: 'mode id (also the value of ?mode= in links)', usedBy: ['build', 'viewer'] },
    name: { req: true, doc: 'name', usedBy: ['viewer'] },
    short: { req: true, doc: 'short name for the header switch', usedBy: ['viewer'] },
    description: { doc: 'one sentence for the mode bar and the about page', usedBy: ['viewer'] },
    reductions: { req: true, doc: 'reduction ids shown in this mode', usedBy: ['build', 'viewer'] },
    default: { req: true, doc: 'the reduction selected when the mode is switched on', usedBy: ['build', 'viewer'] },
    properties: { doc: 'the property groups shown (computability, proof, weihrauch; data/properties.yaml), or true for all', usedBy: ['build', 'viewer'] },
    conservation: { doc: 'true to show conservation results', usedBy: ['build', 'viewer'] },
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
    question: { doc: 'the question, in our own words; with parts: an optional lead-in (required without parts)', usedBy: ['build', 'viewer'] },
    parts: { doc: 'sub-questions, numbered in the viewer, each settled on its own: [{question, formal | status, answer, resolvedBy}]; the question is resolved when all are, partial when some are (no formal or status at the top then)', usedBy: ['build', 'engine', 'viewer'], items: 'questionPart' },
    asked: { req: true, doc: 'every paper that asked it [{ref, loc}]', usedBy: ['build', 'viewer', 'consolidate', 'mineQuestions'], items: 'resultRef' },
    statements: { doc: 'statements it is about', usedBy: ['build', 'viewer'] },
    formal: { doc: 'comparisons [{from, to, over}] from which the status is derived', usedBy: ['build', 'engine', 'viewer'], items: 'formalPart' },
    status: { doc: 'open | partial | resolved — required without formal; must agree with the database otherwise', usedBy: ['build', 'engine', 'viewer', 'consolidate'] },
    answer: { doc: 'short answer when resolved', usedBy: ['viewer'] },
    resolvedBy: { doc: 'papers that answered it [{ref, loc}]', usedBy: ['build', 'viewer'], items: 'resultRef' },
    kind: { doc: 'question (default) | conjecture', usedBy: ['build', 'viewer'] },
    context: { doc: 'background; [@key] cites a reference', usedBy: ['build', 'viewer'] },
  },
  questionPart: {
    question: { req: true, doc: 'the sub-question', usedBy: ['build', 'viewer'] },
    formal: { doc: 'its comparisons [{from, to, over}], from which its status is derived', usedBy: ['build', 'engine', 'viewer'], items: 'formalPart' },
    status: { doc: 'open | partial | resolved; without formal or status, the status is not recorded (shown so, left out of the count)', usedBy: ['build', 'engine', 'viewer'] },
    answer: { doc: 'short answer when (partially) resolved', usedBy: ['viewer'] },
    resolvedBy: { doc: 'papers that answered it [{ref, loc}]; required when resolved without formal', usedBy: ['build', 'viewer'], items: 'resultRef' },
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
  // data/review.yaml — the review queue (docs/REVIEW.md), a list: proposals of the
  // AI reader and candidates of the consolidation, shown on the review page until
  // a decision. Never delete items.
  review: {
    id: { req: true, doc: '<refkey>-<hash> (AI proposals), lead-|question-|answer-|paper-<hash> (consolidation)', usedBy: ['aiAnalyze', 'review', 'build', 'viewer', 'api'] },
    kind: { req: true, doc: 'result | statement (AI reader) | lead | question | answer | paper (consolidation): see KINDS in site/js/review.js', usedBy: ['aiAnalyze', 'review', 'build', 'viewer', 'reviewLib', 'consolidate'] },
    status: { req: true, doc: 'pending (on the review page) | accepted | rejected | done (treated by hand)', usedBy: ['aiAnalyze', 'review', 'build'] },
    date: { req: true, doc: 'date it was proposed', usedBy: ['aiAnalyze', 'consolidate', 'viewer'] },
    ref: { doc: 'the paper (the analyzed paper; for lead, question, answer: the paper of the passage); not for kind paper', usedBy: ['aiAnalyze', 'review', 'viewer', 'reviewLib', 'consolidate'] },
    part: { doc: 'AI proposals from a long text read in parts: the part (scripts/lib/split-text.mjs)', usedBy: ['aiAnalyze', 'viewer'] },
    proposed: { doc: 'fingerprint of the original proposal (kind, paper, fact), kept when the result is corrected by hand: a later proposal of the same fact is not asked again', usedBy: ['reviewQueue'] },
    reasons: { doc: 'why a human must decide (AI: unknown id, quote not found, low confidence, verifier not confirming…; consolidation: what the miner saw)', usedBy: ['aiAnalyze', 'review', 'viewer', 'consolidate'] },
    result: { doc: 'result: the proposed entry, as in data/results/ without refs; edit it before accepting if needed', usedBy: ['aiAnalyze', 'review', 'viewer', 'reviewLib'] },
    loc: { doc: 'result, lead, question: the theorem or question number in the paper', usedBy: ['aiAnalyze', 'review', 'viewer', 'reviewLib', 'consolidate'] },
    origin: { doc: 'result: stated (the paper states it) | cited (the paper attributes it to citedFrom) | special-case (instance of one stated result) | deduced', usedBy: ['aiAnalyze', 'review', 'viewer', 'reviewLib'] },
    quote: { doc: 'result: verbatim passage of the extracted text', usedBy: ['aiAnalyze', 'viewer'] },
    paperNotation: { doc: "result: the paper's notation, when it differs from the catalogue", usedBy: ['aiAnalyze', 'viewer'] },
    argument: { doc: 'result: for special cases and deductions, the argument', usedBy: ['aiAnalyze', 'viewer', 'reviewLib'] },
    citedFrom: { doc: 'result: the work the paper attributes the fact to', usedBy: ['aiAnalyze', 'review', 'viewer', 'reviewLib'] },
    confidence: { doc: "result: the extractor's confidence (high | medium | low)", usedBy: ['aiAnalyze', 'review', 'viewer'] },
    concerns: { doc: 'result: what the extractor thinks a human should check', usedBy: ['aiAnalyze', 'viewer'] },
    verifier: { doc: 'result: {verdict: confirmed | rejected | unsure, reason, model} of the independent verification call', usedBy: ['aiAnalyze', 'viewer'] },
    model: { doc: 'result, statement (AI reader): the model that read the paper (a weaker one may have missed or misread facts: --upgrade re-reads)', usedBy: ['aiAnalyze', 'viewer'] },
    statement: { doc: 'statement: {notation, name, loc, definition, facts} as read in the paper', usedBy: ['aiAnalyze', 'review', 'viewer'] },
    text: { doc: 'lead, question, answer: the passage of the paper (extracted text)', usedBy: ['consolidate', 'viewer'] },
    open: { doc: 'lead: the relations still open in the database between the statements it names (e.g. "rt22⇏coh"), and over: the reduction', usedBy: ['consolidate', 'viewer'] },
    over: { doc: 'lead: the reduction or base system the theorem speaks of (miner guess)', usedBy: ['consolidate', 'viewer'] },
    statements: { doc: 'question: catalogue statements it names', usedBy: ['consolidate', 'viewer'] },
    question: { doc: 'answer: id of the recorded question (data/questions.yaml)', usedBy: ['consolidate', 'viewer', 'reviewLib'] },
    paper: { doc: 'paper: {title, authors, year, venue, doi, arxiv} of a borderline paper found by the sweep', usedBy: ['consolidate', 'review', 'viewer'] },
    votes: { doc: '[{orcid, verdict: valid | invalid, date}] from the live instance (scripts/endorsements-sync.mjs)', usedBy: ['build', 'review', 'viewer', 'apiLib', 'endorseSync'] },
    comments: { doc: '[{orcid, date, text}] public comments from the live instance (scripts/endorsements-sync.mjs)', usedBy: ['build', 'review', 'viewer', 'api', 'apiLib', 'endorseSync'] },
    decision: { doc: '{date, by, note} once treated', usedBy: ['review'] },
  },
  // data/endorsements.yaml — {people: {orcid: person}, endorsements: [endorsement]},
  // written by scripts/endorsements-sync.mjs from the live server (docs/ENDORSEMENTS.md)
  endorsement: {
    result: { req: true, doc: 'the resultKey of the endorsed result (see resultKey below)', usedBy: ['build', 'community', 'api'] },
    orcid: { req: true, doc: 'ORCID iD of the person (checksum validated)', usedBy: ['build', 'community', 'api', 'endorseSync'] },
    date: { req: true, doc: 'date of the endorsement (YYYY-MM-DD)', usedBy: ['api', 'community'] },
  },
  person: {
    name: { req: true, doc: 'name public on the ORCID record at sign-in (the iD when private)', usedBy: ['community', 'api'] },
  },
  // data/ai-analyzed.yaml — a map refkey → record: papers already read by ai-analyze.mjs
  // (long texts read in parts: one record per part, "<refkey>#<n>")
  aiAnalyzed: {
    part: { doc: 'for a part of a long text: "<n>/<of> (chapters…, pages…)" (scripts/lib/split-text.mjs)', usedBy: ['aiAnalyze'] },
    date: { req: true, doc: 'date of the analysis', usedBy: ['aiAnalyze'] },
    model: { req: true, doc: 'model that read the paper (--upgrade re-reads the papers read by a weaker one: scripts/lib/ai-models.mjs)', usedBy: ['aiAnalyze'] },
    effort: { doc: 'effort of the extraction call', usedBy: ['aiAnalyze'] },
    verifiedBy: { doc: 'model of the verification call, when there was one', usedBy: ['aiAnalyze'] },
    textHash: { req: true, doc: 'sha256 prefix of the text read (a new version of the text can be analyzed with --redo)', usedBy: ['aiAnalyze'] },
    facts: { req: true, doc: 'number of facts proposed', usedBy: ['aiAnalyze'] },
    added: { req: true, doc: 'number of results added or citations merged (all runs)', usedBy: ['aiAnalyze'] },
    review: { req: true, doc: 'number of items sent to the review queue, data/review.yaml', usedBy: ['aiAnalyze'] },
    dropped: { req: true, doc: 'number of cited/deduced facts dropped because the database already has them', usedBy: ['aiAnalyze'] },
    changes: { doc: 'the database changes ("added: <resultKey>", "merged: …"), to audit or undo them', usedBy: ['aiAnalyze'] },
    cost: { doc: 'cost of the two calls in dollars (from the usage reported by the API); also calibrates the estimates of --budget and --dry-run', usedBy: ['aiAnalyze'] },
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
//   data/fulltext-exclude.yaml reference key → {zotero | url, reason}: Zotero items or URLs not to use
//   data/author-pages.yaml     [{author, url, base?}]: publication pages read by fulltext.mjs --author-pages
//   data/authors.yaml          zbMATH author code → {name, orcid?}: written by scripts/zbmath.mjs, used by the viewer's bell
//   data/screened.yaml         {facts, questions, resolutions}: leads already examined
//   data/acronyms-ignored.yaml acronym → reason: not proposed as missing statements
//   data/review.yaml           entity review above; data/ai-analyzed.yaml: aiAnalyzed
//   data/modes.yaml            entity mode above: the frameworks of the viewer's mode switch
//   data/errata.yaml           entity erratum above: wrong statements of papers, on the paper's page
//   data/concepts.yaml         entity concept above: definitions of the words used in statements
//   data/endorsements.yaml     {people: orcid → person, endorsements: [endorsement]} (entities above)

// ORCID iD with a valid check digit (ISO 7064 11,2). Used by the build and the sync.
export function orcidValid(id) {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return false;
  const d = id.replace(/-/g, '');
  let t = 0;
  for (let i = 0; i < 15; i++) t = (t + +d[i]) * 2;
  const r = (12 - (t % 11)) % 11;
  return d[15] === (r === 10 ? 'X' : String(r));
}

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
