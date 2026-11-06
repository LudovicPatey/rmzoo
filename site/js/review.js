// The review queue (data/review.yaml, docs/REVIEW.md): what the viewer, the build
// and scripts/review.mjs share. Pure functions, tested in tests/review.test.mjs.
//
// An item is a proposal that is not part of the database: a fact or a missing
// statement proposed by the AI reader (scripts/ai-analyze.mjs), or a candidate of
// the consolidation (scripts/consolidate.mjs: a theorem naming statements whose
// relation is open, a numbered question, a passage that may answer a recorded
// question, a borderline new paper). Until it is validated it is shown on the
// review page only. Signed-in researchers vote (valid | invalid) and comment; the
// maintainer applies the outcome (scripts/review.mjs apply).

export const KINDS = {
  result: { name: 'Proposed results', one: 'proposed result', source: 'ai',
    valid: 'I have checked that the paper proves this result (at the place given, or by the argument given).',
    invalid: 'The paper does not prove this result, or the statements, direction or reduction are wrong.' },
  statement: { name: 'Missing statements', one: 'missing statement', source: 'ai',
    valid: 'This principle belongs in the zoo, and the definition is the one of the paper.',
    invalid: 'This principle does not belong in the zoo, is already in it, or the definition is wrong.' },
  lead: { name: 'Theorems to read', one: 'theorem to read', source: 'consolidation',
    valid: 'This theorem gives a result that the zoo lacks (say which in a comment).',
    invalid: 'Nothing to add from this theorem.' },
  question: { name: 'Questions to record', one: 'question to record', source: 'consolidation',
    valid: 'This is an open question about statements of the zoo, worth recording.',
    invalid: 'Not a question to record (not open, not about the zoo, or not a question).' },
  answer: { name: 'Possible answers', one: 'possible answer', source: 'consolidation',
    valid: 'This paper answers the question (say where in a comment).',
    invalid: 'This passage does not answer the question.' },
  paper: { name: 'Papers to add', one: 'paper to add', source: 'consolidation',
    valid: 'This paper belongs in the zoo (reverse mathematics or Weihrauch reducibility).',
    invalid: 'This paper is off topic.' },
};

// Votes needed: one validation and no invalidation publishes an item (live, on the
// instance); one invalidation and no validation withdraws it; both is a dispute
// that the maintainer settles.
export function reviewStatus(votes = []) {
  const v = votes.filter((x) => x.verdict === 'valid').length;
  const n = votes.filter((x) => x.verdict === 'invalid').length;
  return v && n ? 'disputed' : v ? 'validated' : n ? 'invalidated' : 'open';
}
export const STATUS_NAMES = { open: 'to review', validated: 'validated', invalidated: 'invalidated', disputed: 'disputed' };

// The entry a validated `result` item becomes in the database (as
// scripts/review.mjs apply writes it): stated facts cite the paper at `loc`;
// special cases are direct and deductions AI-derived, both with the argument; a fact the paper
// attributes to another work cites the paper until the maintainer finds that work.
export function itemResult(it) {
  if (it.kind !== 'result' || !it.result) return null;
  if (it.origin === 'special-case' || it.origin === 'deduced') {
    const kind = it.origin === 'special-case' ? 'restriction' : 'reduction';
    return { ...it.result, provenance: kind === 'restriction' ? 'direct' : 'ai', justification: { kind, by: 'ai', text: `${it.argument || ''} (From ${it.loc} of [@${it.ref}].)`.trim() } };
  }
  const loc = it.origin === 'cited' && it.citedFrom ? `${it.loc} (attributed to ${it.citedFrom})` : it.loc;
  return { ...it.result, refs: [{ ref: it.ref, ...(loc ? { loc } : {}) }] };
}

// Identity of a result: resultKey of scripts/lib/schema.mjs (the viewer cannot
// import that file; tests/review.test.mjs checks that the two agree). A validated
// result already in the database is not added twice in the viewer.
export const resultKey = (r) => [r.type, r.from ?? r.statement, r.to ?? r.property ?? r.base, [].concat(r.over ?? r.class ?? '').join(','), r.value ?? ''].join('|');

// The key of data/screened.yaml that closes a consolidation item (once the
// maintainer has examined the lead, by the report or on the review page).
export function screenKey(it) {
  if (it.kind === 'lead') return ['facts', `${it.ref}|${it.loc}`];
  if (it.kind === 'question') return ['questions', `${it.ref}|${it.loc}`];
  if (it.kind === 'answer') return ['resolutions', `${it.question}|${it.ref}`];
  return null;
}
