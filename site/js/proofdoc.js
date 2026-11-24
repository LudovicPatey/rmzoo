// Structured proofs (docs/DESIGN.md, "Structured proofs"): the format of a long proof of
// a result (justification.proof in data/results/, proof in a review item of kind
// `proof`), its checks (scripts/build.mjs) and its rendering (site/js/app.js).
// Pure functions, tested in tests/proofdoc.test.mjs.
//
// A proof document is { summary?, blocks: Body }, where a Body is a list of nodes:
//   "a paragraph"                           text ($…$ TeX, [@key] cites a paper,
//                                            [[id]] a statement, [#label] another block)
//   { steps: [node, …] }                     a numbered list; an item is a paragraph or a node
//   { env, label?, title?, text?, proof? }   a definition, lemma, theorem… with its statement
//                                            (text) and its proof (a Body)
//   { cases: [{ label, body }, …] }          a proof by cases
// `label` names the block for cross-references ("Lemma D", "Claim 2"); the reference
// [#Lemma D] links to it.

export const ENVS = {
  definition: { name: 'Definition', group: 'def' },
  notation: { name: 'Notation', group: 'def' },
  lemma: { name: 'Lemma', group: 'thm' },
  claim: { name: 'Claim', group: 'thm' },
  proposition: { name: 'Proposition', group: 'thm' },
  theorem: { name: 'Theorem', group: 'thm' },
  corollary: { name: 'Corollary', group: 'thm' },
  construction: { name: 'Construction', group: 'def' },
  part: { name: '', group: 'part' }, // a part of a proof (a direction, a case), titled by its label
  remark: { name: 'Remark', group: 'rem' },
};

// errors of a document (strings), for the build
export function checkProof(doc, where = 'proof') {
  const errs = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${where}: a proof is {summary?, blocks}`];
  for (const k of Object.keys(doc)) if (!['summary', 'blocks'].includes(k)) errs.push(`${where}: unknown field ${k}`);
  if (doc.summary !== undefined && typeof doc.summary !== 'string') errs.push(`${where}: summary is a text`);
  if (!Array.isArray(doc.blocks) || !doc.blocks.length) errs.push(`${where}: blocks is a nonempty list`);
  const labels = new Set();
  const body = (b, at) => {
    if (!Array.isArray(b)) { errs.push(`${at}: a list of nodes`); return; }
    b.forEach((n, i) => node(n, `${at}[${i}]`));
  };
  const node = (n, at) => {
    if (typeof n === 'string') { if (!n.trim()) errs.push(`${at}: empty paragraph`); return; }
    if (!n || typeof n !== 'object') { errs.push(`${at}: a paragraph or a block`); return; }
    if ('steps' in n) {
      if (Object.keys(n).length !== 1 || !Array.isArray(n.steps) || !n.steps.length) errs.push(`${at}: {steps: [ … ]} with a nonempty list`);
      else n.steps.forEach((s, i) => node(s, `${at}.steps[${i}]`));
      return;
    }
    if ('cases' in n) {
      if (Object.keys(n).length !== 1 || !Array.isArray(n.cases) || !n.cases.length) { errs.push(`${at}: {cases: [ … ]} with a nonempty list`); return; }
      n.cases.forEach((c, i) => {
        if (!c || typeof c.label !== 'string' || !Array.isArray(c.body)) errs.push(`${at}.cases[${i}]: {label, body}`);
        else body(c.body, `${at}.cases[${i}].body`);
      });
      return;
    }
    if (!ENVS[n.env]) { errs.push(`${at}: env must be one of ${Object.keys(ENVS).join(', ')}`); return; }
    for (const k of Object.keys(n)) if (!['env', 'label', 'title', 'text', 'proof'].includes(k)) errs.push(`${at}: unknown field ${k}`);
    // a named block (not a part: its label is only a heading) can be referred to, so its label is unique
    if (n.label !== undefined && n.env !== 'part') { if (labels.has(n.label)) errs.push(`${at}: label ${n.label} used twice`); labels.add(n.label); }
    if (n.text === undefined && n.proof === undefined) errs.push(`${at}: a block has a text or a proof`);
    if (n.proof !== undefined) body(n.proof, `${at}.proof`);
  };
  if (Array.isArray(doc.blocks)) body(doc.blocks, `${where}.blocks`);
  for (const t of proofTexts(doc)) for (const [, l] of t.matchAll(/\[#([^\]]+)\]/g)) if (!labels.has(l)) errs.push(`${where}: reference to an unknown block [#${l}]`);
  return errs;
}

// every text of a document (to check citations and statement links)
export function proofTexts(doc) {
  const out = [];
  const walk = (n) => {
    if (typeof n === 'string') { out.push(n); return; }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    for (const k of ['summary', 'title', 'text']) if (typeof n[k] === 'string') out.push(n[k]);
    for (const k of ['blocks', 'steps', 'proof', 'body', 'cases']) if (n[k]) walk(n[k]);
  };
  walk(doc);
  return out;
}

// counts shown on a collapsed proof
export function proofSize(doc) {
  let blocks = 0, steps = 0;
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (n.env && n.env !== 'part') blocks++;
    if (n.steps) steps += n.steps.length;
    for (const k of ['blocks', 'steps', 'proof', 'body', 'cases']) if (n[k]) walk(n[k]);
  };
  walk(doc);
  return { blocks, steps };
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// HTML of a document. fmt(text) renders a text (math, citations, statement links: the
// viewer's helpers); prefix makes the anchors unique on a page; open: proofs expanded.
export function proofDocHtml(doc, fmt, { prefix = 'pf', open = false } = {}) {
  const anchor = (label) => `${prefix}-${slug(label)}`;
  const text = (t) => fmt(String(t)).replace(/\[#([^\]]+)\]/g, (m, l) => `<a class="pf-ref" href="#${anchor(l)}" data-pf="${anchor(l)}">${l}</a>`);
  const para = (t) => `<p>${text(t)}</p>`;
  const nodeHtml = (n) => {
    if (typeof n === 'string') return para(n);
    if (n.steps) return `<ol class="pf-steps">${n.steps.map((s) => `<li>${typeof s === 'string' ? text(s) : nodeHtml(s)}</li>`).join('')}</ol>`;
    if (n.cases) return `<div class="pf-cases">${n.cases.map((c) => `<div class="pf-case"><span class="pf-case-label">${text(c.label)}</span>${body(c.body)}</div>`).join('')}</div>`;
    const E = ENVS[n.env];
    const head = n.env === 'part' ? `<span class="pf-name">${text(n.label || '')}</span>`
      : `<span class="pf-name">${n.label ? text(n.label) : E.name}</span>${n.title ? ` <span class="pf-title">(${text(n.title)})</span>` : ''}`;
    const id = n.label && n.env !== 'part' ? ` id="${anchor(n.label)}"` : '';
    const stmt = n.text ? `<div class="pf-stmt">${text(n.text)}</div>` : '';
    const proof = n.proof ? (n.env === 'part' || !n.text ? `<div class="pf-body">${body(n.proof)}</div>`
      : `<details class="pf-proof"${open ? ' open' : ''}><summary>Proof</summary><div class="pf-body">${body(n.proof)}<span class="pf-qed" aria-label="end of proof">∎</span></div></details>`) : '';
    return `<section class="pf-env pf-${E.group} pf-${n.env}"${id}><div class="pf-head">${head}.</div>${stmt}${proof}</section>`;
  };
  const body = (b) => b.map(nodeHtml).join('');
  return `<div class="pf-doc">${doc.summary ? `<p class="pf-summary">${text(doc.summary)}</p>` : ''}${body(doc.blocks)}</div>`;
}
