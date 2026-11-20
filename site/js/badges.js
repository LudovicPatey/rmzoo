// Badges of a person (docs/ENDORSEMENTS.md, "Badges"): what their contributions did,
// shown in the hover card of their name and on their profile.
//
//   facts:        facts entered on their suggestion (data/credits.yaml, kind fact)
//   fixes:        errors of the database corrected on their report (kind fix)
//   sources:      better or earlier sources added on their remark (kind source)
//   endorsements: results they endorsed
//   comments:     their public comments (questions, review page)
//   uploads:      full texts they shared (live instance only: the files stay private)
// Pure functions, tested in tests/badges.test.mjs.

export const BADGES = [
  ['facts', '＋', 'fact entered', 'facts entered', 'Facts entered in the database on their suggestion'],
  ['fixes', '✎', 'error fixed', 'errors fixed', 'Errors of the database corrected on their report'],
  ['sources', '§', 'source added', 'sources added', 'Better or earlier sources added on their remark'],
  ['endorsements', '✓', 'endorsement', 'endorsements', 'Results whose proof they read and endorsed'],
  ['comments', '❝', 'public comment', 'public comments', 'Public comments on open questions and on the review page'],
  ['uploads', '▤', 'full text shared', 'full texts shared', 'Full texts of papers shared with the maintainer'],
];

// {facts, fixes, sources} of one person from the credits (data/credits.yaml)
export function creditCounts(credits, orcid) {
  const n = { facts: 0, fixes: 0, sources: 0 };
  for (const c of credits || []) {
    if (c.orcid !== orcid) continue;
    if (c.kind === 'fact') n.facts += c.count ?? 1;
    else if (c.kind === 'fix') n.fixes += 1;
    else if (c.kind === 'source') n.sources += 1;
  }
  return n;
}

// the badges with a nonzero count, in the order of BADGES: [{key, icon, count, label, title}]
// (uploads undefined: unknown, as on a static copy)
export function personBadges({ credits, orcid, endorsements = 0, comments = 0, uploads }) {
  const n = { ...creditCounts(credits, orcid), endorsements, comments, uploads: uploads || 0 };
  return BADGES.filter(([k]) => n[k] > 0).map(([key, icon, one, many, title]) => ({ key, icon, count: n[key], label: n[key] === 1 ? one : many, title }));
}

// the credits of a person, newest first (profile page)
export const personCredits = (credits, orcid) => (credits || []).filter((c) => c.orcid === orcid).sort((a, b) => b.date.localeCompare(a.date));
