// Statements related to a given one: those worth comparing it with.
//
// Two statements are related when papers study them together. Each paper that
// mentions both (in a result it is cited for, or in the literature list of the
// statements) adds to the score, weighted down for papers that mention many
// statements (a monograph relates everything to everything); statements present
// in very many papers (ACA₀, WKL₀) are weighted down a little, as they relate to
// everything. Shared tags (same area) add a small bonus; when papers give fewer
// than `fill` statements, the list is completed with the most studied statements
// sharing tags with it. Base systems (RCA₀), operator statements (P′, P̂…),
// formulations of the same principle and the statement itself are left out.
// Pure function of the zoo (engine output); tested in tests/related.test.mjs.

export function relatedIndex(zoo) {
  const { S, sidx, raw } = zoo;
  const papers = new Map(); // ref -> Set of statement indices
  const add = (ref, id) => {
    const j = sidx.get(id);
    if (j === undefined || !ref) return;
    if (!papers.has(ref)) papers.set(ref, new Set());
    papers.get(ref).add(j);
  };
  for (const res of raw.results)
    for (const r of res.refs || []) for (const id of [res.from, res.to, res.statement, res.base]) if (id) add(r.ref, id);
  S.forEach((s) => (s.refs || []).forEach((r) => add(r.ref, s.id)));
  const byStmt = S.map(() => []); // statement -> its papers
  for (const [ref, set] of papers) for (const j of set) byStmt[j].push(ref);
  const weight = new Map([...papers].map(([ref, set]) => [ref, 1 / Math.log2(1 + set.size)]));
  const spread = byStmt.map((ps) => 1 / Math.sqrt(Math.log2(2 + ps.length)));
  return { papers, byStmt, weight, spread };
}

export function relatedStatements(zoo, i, { limit = 12, fill = 6, index = relatedIndex(zoo) } = {}) {
  const { S } = zoo;
  const s = S[i];
  const main = s.formulationOf || s.id;
  const skip = (j) => j === i || !!S[j].op || !!S[j].base?.length || !!S[j].minor || (S[j].formulationOf || S[j].id) === main;
  const score = new Map(), common = new Map();
  for (const ref of index.byStmt[i]) {
    const w = index.weight.get(ref);
    for (const j of index.papers.get(ref)) {
      if (skip(j)) continue;
      score.set(j, (score.get(j) || 0) + w);
      if (!common.has(j)) common.set(j, []);
      common.get(j).push(ref);
    }
  }
  const tags = new Set(s.tags || []);
  const sharedTags = (j) => (S[j].tags || []).filter((t) => tags.has(t));
  const out = [...score]
    .map(([j, sc]) => ({ j, score: sc * index.spread[j] + 0.15 * sharedTags(j).length, papers: common.get(j), tags: sharedTags(j) }))
    .sort((a, b) => b.score - a.score || b.papers.length - a.papers.length || S[a.j].id.localeCompare(S[b.j].id))
    .slice(0, limit);
  if (out.length < fill && tags.size) {
    const extra = S.map((_, j) => j).filter((j) => !skip(j) && !score.has(j) && sharedTags(j).length)
      .map((j) => ({ j, score: 0, papers: [], tags: sharedTags(j) }))
      .sort((a, b) => b.tags.length - a.tags.length || index.byStmt[b.j].length - index.byStmt[a.j].length || S[a.j].id.localeCompare(S[b.j].id));
    out.push(...extra.slice(0, fill - out.length));
  }
  return out;
}
