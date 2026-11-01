import { buildZoo, orderView, RULES, CLASS_NAMES } from './engine.js';
import { layered, verticalSpline } from './layout.js';
import { bibtex } from './bibtex.js';

// ============================================================================
// helpers
// ============================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const texCache = new Map();
function tex(src) {
  if (texCache.has(src)) return texCache.get(src);
  let out;
  try { out = window.katex.renderToString(src, { throwOnError: false }); } catch { out = esc(src); }
  texCache.set(src, out);
  return out;
}
// Escape text and render $...$ as inline math.
const rich = (text) => String(text ?? '').split(/(\$[^$]+\$)/g)
  .map((p) => (p.length > 1 && p.startsWith('$') && p.endsWith('$') ? tex(p.slice(1, -1)) : esc(p))).join('');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const plain = (label) => label
  .replace(/\\(lim|min|max|log)\b/g, '$1')
  .replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\(mathsf|mathrm|mathbf)\{([^}]*)\}/g, '$2')
  .replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_\s]/g, '');

// ============================================================================
// state
// ============================================================================
let Z; // the zoo (engine output)
const state = {
  sel: store.get('rmzoo.sel', ['rca0', 'wkl', 'aca', 'rt22', 'srt22', 'coh']),
  r: store.get('rmzoo.r', 'rca0'),
  sep: store.get('rmzoo.sep', true),
  open: store.get('rmzoo.open', false),
};
const saveState = () => {
  store.set('rmzoo.sel', state.sel); store.set('rmzoo.r', state.r);
  store.set('rmzoo.sep', state.sep); store.set('rmzoo.open', state.open);
};

const S = (i) => Z.S[i];
const idx = (id) => Z.sidx.get(id);
const rIdx = () => Z.ridx.get(state.r) ?? 0;
function labelOf(i, r = rIdx()) {
  const s = S(i);
  return s.label;
}
const L = (i, r) => tex(labelOf(i, r));
const sLink = (i, r) => `<a href="#/s/${S(i).id}">${L(i, r)}</a>`;
const tagName = (id) => (Z.raw.tags.find((t) => t.id === id) || { name: id }).name;
const isSel = (id) => state.sel.includes(id);
function toggleSel(id) {
  state.sel = isSel(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
  saveState(); renderTray();
}

function refShort(key) {
  const r = Z.raw.references[key];
  if (!r) return key;
  const last = (a) => a.replace(/,?\s+(Jr\.?|Sr\.?|III|II)$/, '').split(' ').slice(-1)[0];
  const au = r.authors.length > 3 ? `${last(r.authors[0])} et al.` : r.authors.map(last).join(', ');
  return `${au} ${r.year}`;
}
const refLink = (ref) => `<a href="#/refs/${ref.ref}">${esc(refShort(ref.ref))}</a>${ref.loc ? `, ${esc(ref.loc)}` : ''}`;

// ============================================================================
// long lists: render a first page, then "Show more" / "Show all" on demand
// ============================================================================
// lazy(items, render, { size, wrap, head, empty, noun }) returns a placeholder;
// a MutationObserver fills it as soon as it is attached to the document.
const lazyLists = new Map();
let lazyId = 0;
function lazy(items, render, opt = {}) {
  if (!items.length) return opt.empty ?? '<p class="muted">None.</p>';
  const id = ++lazyId;
  lazyLists.set(id, { items, render, shown: 0, size: opt.size || 50, wrap: opt.wrap || 'div', head: opt.head || '', noun: opt.noun || 'items' });
  return `<div class="lazy" data-lazy="${id}"></div>`;
}
const WRAPS = {
  table: (head) => [`<table class="grid">${head}<tbody>`, '</tbody></table>'],
  chips: () => ['<div class="rel-list">', '</div>'],
  div: () => ['<div class="lazy-items">', '</div>'],
};
function fillLazy(el, all = false) {
  const L = lazyLists.get(+el.dataset.lazy);
  if (!L) return;
  const next = all ? L.items.length : Math.min(L.items.length, L.shown + L.size);
  const html = L.items.slice(L.shown, next).map(L.render).join('');
  if (!L.shown) {
    const [open, close] = WRAPS[L.wrap](L.head);
    el.innerHTML = `${open}${html}${close}<div class="more-bar"></div>`;
  } else {
    const body = el.querySelector('tbody') || el.firstElementChild;
    body.insertAdjacentHTML('beforeend', html);
  }
  L.shown = next;
  const left = L.items.length - L.shown;
  const bar = el.querySelector('.more-bar');
  bar.innerHTML = left > 0
    ? `<span class="small muted">Showing ${L.shown} of ${L.items.length} ${esc(L.noun)}</span>
       <button class="btn small" data-more>Show ${Math.min(L.size, left)} more</button>
       ${left > L.size ? `<button class="btn small" data-all>Show all</button>` : ''}`
    : '';
}
function hydrateLazy(root) {
  root.querySelectorAll?.('[data-lazy]:not([data-ready])').forEach((el) => { el.dataset.ready = '1'; fillLazy(el); });
}
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) {
    if (n.matches?.('[data-lazy]:not([data-ready])')) { n.dataset.ready = '1'; fillLazy(n); }
    hydrateLazy(n);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-more],[data-all]');
  if (!b) return;
  const el = b.closest('[data-lazy]');
  if (el) { e.stopPropagation(); fillLazy(el, b.hasAttribute('data-all')); }
}, true);

// ============================================================================
// search
// ============================================================================
let hay;
function buildHaystack() {
  hay = Z.S.map((s) => {
    const ascii = plain(s.label).toLowerCase();
    return {
      ascii,
      text: [s.id, ascii, s.name, ...(s.aliases || []), s.definition, ...(s.tags || []).map(tagName)]
        .join(' ').toLowerCase(),
    };
  });
}
// number of results mentioning each statement (search tie-breaker)
function usage() {
  if (usage.u) return usage.u;
  const u = new Array(Z.n).fill(0);
  for (const r of Z.raw.results) for (const id of [r.from, r.to, r.statement, r.base]) { const i = id && idx(id); if (i !== undefined && i !== '') u[i]++; }
  return (usage.u = u);
}
function search(q, limit = 50) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const toks = q.split(/\s+/);
  const qs = q.replace(/\s+/g, '');
  const res = [];
  Z.S.forEach((s, i) => {
    const h = hay[i];
    if (!toks.every((t) => h.text.includes(t) || h.ascii.includes(t.replace(/[^a-z0-9]/g, '')))) return;
    let score = 0;
    if (h.ascii === qs || s.id === qs) score += 100;
    else if (h.ascii.startsWith(qs)) score += 50;
    if (s.name.toLowerCase().includes(q)) score += 10;
    if (s.conjunction) score -= 5;
    if (s.formulationOf) score -= 2;
    score += Math.min(8, Math.log2(1 + usage()[i])); // well-studied statements first among similar matches
    res.push([score, i]);
  });
  return res.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

function attachSearch(input, pop, onPick) {
  let hl = 0, items = [];
  const show = () => {
    items = search(input.value, 12);
    if (!items.length) { pop.hidden = true; return; }
    hl = Math.min(hl, items.length - 1);
    pop.innerHTML = items.map((i, k) => `<div class="opt ${k === hl ? 'hl' : ''}" data-i="${i}">
      <span>${L(i)}</span><span class="muted">${esc(S(i).name)}</span></div>`).join('');
    pop.hidden = false;
  };
  input.addEventListener('input', () => { hl = 0; show(); });
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(() => (pop.hidden = true), 150));
  input.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, items.length - 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); show(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[hl] !== undefined) { onPick(items[hl]); input.value = ''; pop.hidden = true; e.preventDefault(); }
    else if (e.key === 'Escape') { pop.hidden = true; input.blur(); }
  });
  pop.addEventListener('mousedown', (e) => {
    const o = e.target.closest('.opt');
    if (o) { onPick(+o.dataset.i); input.value = ''; pop.hidden = true; e.preventDefault(); }
  });
}

// ============================================================================
// reduction lattice widget
// ============================================================================
let latticeGeom;
function latticeLayout() {
  if (latticeGeom) return latticeGeom;
  const nodes = Z.R.map((r) => ({ w: Math.max(34, r.short.length * 8 + 18), h: 22 }));
  const edges = [];
  Z.R.forEach((r, i) => (r.finerThan || []).forEach((c) => edges.push([i, Z.ridx.get(c)])));
  latticeGeom = { ...layered(nodes, edges, { hgap: 12, vgap: 18 }), edgeList: edges };
  return latticeGeom;
}
// opts: { pick: true, selected: r } or { status: (r) => 'implies'|... , small: true }
function latticeSvg(opts = {}) {
  const g = latticeLayout();
  const pad = 4;
  if (opts.small) {
    const k = 0.32;
    const pts = g.nodes.map((nd) => [nd.x * k + pad, nd.y * k + pad]);
    const w = g.width * k + 2 * pad, h = g.height * k + 2 * pad;
    const color = { implies: 'var(--yes)', separated: 'var(--no)', open: 'var(--open)', na: 'var(--line)', contradiction: '#000' };
    return `<svg width="${w.toFixed(0)}" height="${h.toFixed(0)}" class="mini">
      ${g.edgeList.map(([a, b]) => `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}" stroke="var(--line)" stroke-width="1"/>`).join('')}
      ${pts.map((p, r) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.2" fill="${color[opts.status(r)]}"><title>${esc(Z.R[r].short)}</title></circle>`).join('')}
    </svg>`;
  }
  const w = g.width + 2 * pad, h = g.height + 2 * pad;
  return `<svg class="lattice" width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}">
    ${g.edgeList.map(([a, b]) => `<path class="edge" d="${verticalSpline([[g.nodes[a].x, g.nodes[a].y + 11], [g.nodes[b].x, g.nodes[b].y - 11]])}"/>`).join('')}
    ${g.nodes.map((nd, r) => {
      const cls = ['node'];
      if (opts.pick) cls.push('pick');
      if (opts.selected === r) cls.push('sel');
      if (opts.status) cls.push('st-' + opts.status(r), 'pick');
      return `<g class="${cls.join(' ')}" data-r="${r}"><title>${esc(Z.R[r].name)}</title>
        <rect x="${nd.x - nd.w / 2}" y="${nd.y - nd.h / 2}" width="${nd.w}" height="${nd.h}"/>
        <text x="${nd.x}" y="${nd.y + 4}" text-anchor="middle">${esc(Z.R[r].short)}${opts.status ? ' ' + sym(opts.status(r)) : ''}</text></g>`;
    }).join('')}
  </svg>`;
}
const sym = (st) => ({ implies: '✓', separated: '✗', open: '?', na: '–', contradiction: '‼' })[st];

function reductionPicker(onPick) {
  const el = document.createElement('div');
  el.innerHTML = latticeSvg({ pick: true, selected: rIdx() }) +
    `<div class="small muted" style="margin-top:6px">${esc(Z.R[rIdx()].name)}</div>`;
  el.addEventListener('click', (e) => {
    const g = e.target.closest('[data-r]');
    if (!g) return;
    state.r = Z.R[+g.dataset.r].id; saveState(); onPick();
  });
  return el;
}

// ============================================================================
// proofs and pair panel (drawer)
// ============================================================================
const drawer = () => $('#drawer');
function openDrawer(html) {
  const d = drawer();
  d.innerHTML = `<button class="btn small close" data-close>✕</button>${html}`;
  d.hidden = false;
  d.scrollTop = 0;
}
function closeDrawer() { drawer().hidden = true; }

function factHtml(f) {
  if (f.t === 'P') {
    const p = Z.raw.properties[f.p];
    return `${L(f.s)} ${f.v ? '<span class="yes">has</span>' : '<span class="no">fails</span>'} ${esc(p.name)}`;
  }
  const arrow = f.t === 'I' ? '<span class="yes">⇒</span>' : '<span class="no">⇏</span>';
  return `${L(f.a, f.r)} ${arrow} ${L(f.b, f.r)} <span class="muted small">over ${esc(Z.R[f.r].short)}</span>`;
}
const JUSTIFICATION_KINDS = {
  restriction: 'restriction of instances',
  reduction: 'short reduction',
  classical: 'classical fact',
  'personal-communication': 'personal communication',
  unreferenced: 'no reference found',
};
function resultCite(ri) {
  const res = Z.raw.results[ri];
  const refs = (res.refs || []).map(refLink).join('; ');
  const j = res.justification;
  return `<div class="cite">${refs}${res.folklore ? ' <span class="badge folk">folklore</span>' : ''}
    ${res.provenance === 'ai' ? ' <span class="badge ai" title="Not taken from the literature: derived by an AI assistant and to be checked">AI-derived</span>' : ''}
    ${j?.by === 'ai' && res.provenance !== 'ai' ? ' <span class="badge ai" title="The justification below was written by an AI assistant">argument by AI</span>' : ''}
    ${res.status === 'needs-check' ? ' <span class="badge warn">needs check</span>' : ''}</div>
    ${j ? `<div class="note"><b>${esc(JUSTIFICATION_KINDS[j.kind] || j.kind)}.</b> ${rich(j.text)}</div>` : ''}
    ${res.note ? `<div class="note">${rich(res.note)}</div>` : ''}`;
}
function proofHtml(node) {
  const rule = node.rule === 'prop-sep' && node.prop !== undefined
    ? `${RULES['prop-sep']}: ${esc(Z.raw.properties[node.prop].name)}`
    : RULES[node.rule] || node.rule;
  const kids = node.children && node.children.length
    ? `<ul>${node.children.map(proofHtml).join('')}</ul>` : '';
  return `<li><span class="fact">${factHtml(node.fact)}</span><span class="rule">${esc(rule)}${node.ref ? ' (shown above)' : ''}</span>
    ${node.result !== undefined ? resultCite(node.result) : ''}${kids}</li>`;
}
function proofBlock(f) {
  const st = f.t === 'P' ? null : Z.status(f.r, f.a, f.b);
  if (f.t !== 'P' && st === 'open') return `<p class="muted">No proof either way is known to the database.</p>`;
  const tree = Z.proof(f);
  const srcs = Z.sources(f);
  return `<ul class="proof">${proofHtml(tree)}</ul>
    <p class="small muted">Relies on ${srcs.length} published result${srcs.length === 1 ? '' : 's'}.</p>`;
}

function verdictText(a, b, r) {
  const st = Z.status(r, a, b);
  const R = Z.R[r];
  const base = { implies: 'implies', separated: 'does not imply', open: 'is not known to imply', na: 'cannot be compared with', contradiction: 'CONTRADICTION:' }[st];
  return `<div class="verdict ${st}">${L(a, r)} <b>${base}</b> ${L(b, r)} over <b>${esc(R.short)}</b>
    ${st === 'na' ? `<div class="small muted">${esc(R.name)} only compares problems.</div>` : ''}</div>`;
}

function pairPanel(a, b, r = rIdx()) {
  const section = (x, y) => `
    <h3>${L(x, r)} ⇒ ${L(y, r)} ?</h3>
    <div class="pair-lattice" data-x="${x}" data-y="${y}">${latticeSvg({ status: (rr) => Z.status(rr, x, y) })}</div>`;
  const render = (rr) => {
    openDrawer(`
      <h2 style="margin-top:0">${sLink(a, rr)} vs ${sLink(b, rr)}</h2>
      <p class="small muted">Each diagram shows the status at every notion of reduction. Click one to see the proof there.</p>
      <div class="two-col">${section(a, b)}${section(b, a)}</div>
      ${verdictText(a, b, rr)}${proofBlock(Z.status(rr, a, b) === 'separated' ? { t: 'N', r: rr, a, b } : { t: 'I', r: rr, a, b })}
      ${verdictText(b, a, rr)}${proofBlock(Z.status(rr, b, a) === 'separated' ? { t: 'N', r: rr, a: b, b: a } : { t: 'I', r: rr, a: b, b: a })}
    `);
    $$('.pair-lattice [data-r]', drawer()).forEach((g) => g.addEventListener('click', () => render(+g.dataset.r)));
  };
  render(r);
}

function propertyPanel(p, s) {
  const prop = Z.raw.properties[p];
  const e = Z.prop(p, s);
  openDrawer(`<h2 style="margin-top:0">${esc(prop.name)}</h2>
    <p>${rich(prop.description)}</p>
    <p class="small muted">Preserved downwards under ${esc(Z.R[Z.ridx.get(prop.closedUnder)].name)}:
      if a statement has it, so does every statement it implies; if A has it and B does not, A does not imply B.</p>
    ${e ? `<ul class="proof">${proofHtml(Z.proof({ t: 'P', p, s, v: e.v }))}</ul>`
      : `<div class="verdict open">Not known whether ${L(s)} has this property.</div>`}`);
}

// ============================================================================
// selection tray
// ============================================================================
function renderTray() {
  const t = $('#tray');
  const route = currentRoute();
  if (!state.sel.length || route === 'diagram' || route === 'compare') { t.hidden = true; return; }
  t.hidden = false;
  t.innerHTML = `<span class="small muted">${state.sel.length} selected</span>
    <div class="items">${state.sel.map((id) => idx(id) !== undefined
      ? `<span class="chip" data-id="${id}" title="Remove">${L(idx(id), null)} ×</span>` : '').join('')}</div>
    <a class="btn primary" href="#/diagram">Diagram</a>
    <a class="btn" href="#/compare">Compare</a>
    <button class="btn" data-clear>Clear</button>`;
  t.onclick = (e) => {
    const c = e.target.closest('[data-id]');
    if (c) { toggleSel(c.dataset.id); rerender(); }
    if (e.target.closest('[data-clear]')) { state.sel = []; saveState(); renderTray(); rerender(); }
  };
}

// ============================================================================
// views
// ============================================================================
const main = () => $('#main');

// ---- front page -------------------------------------------------------------
function zooCounts() { // derived facts over all (statement, statement, reduction) triples
  if (zooCounts.c) return zooCounts.c;
  let nI = 0, nN = 0, nO = 0;
  for (let r = 0; r < Z.R.length; r++) for (let a = 0; a < Z.n; a++) for (let b = 0; b < Z.n; b++) {
    if (a === b) continue;
    const st = Z.status(r, a, b);
    if (st === 'implies') nI++; else if (st === 'separated') nN++; else if (st === 'open') nO++;
  }
  return (zooCounts.c = { nI, nN, nO });
}
const fmt = (n) => n.toLocaleString('en-US');
const newest = (list) => list.filter((x) => x[1]._t).sort((a, b) => b[1]._t - a[1]._t || b[1]._pos - a[1]._pos);
const presetHref = (z) => `#/diagram?s=${z.statements.join(',')}&r=${z.reduction}&sep=1&open=0`;

function viewHome() {
  const m = main();
  m.className = 'home';
  const mains = Z.S.filter((s) => !s.conjunction && !s.formulationOf).length;
  const refs = Object.values(Z.raw.references);
  const parsed = refs.filter((r) => /^pdf/.test(r.read || '')).length;
  const cited = new Set(Z.raw.results.flatMap((r) => (r.refs || []).map((x) => x.ref))).size;
  const lastDate = Z.raw.results.concat(Z.raw.statements).reduce((d, x) => (x._date > d ? x._date : d), '');
  const N = 6;
  const recentRefs = newest(Object.entries(Z.raw.references)).slice(0, N);
  const recentStmts = newest(Z.S.map((s, i) => [i, Z.raw.statements.find((x) => x.id === s.id) || s])).filter(([i]) => !S(i).conjunction).slice(0, N);
  const recentRes = newest(Z.raw.results.map((res, ri) => [ri, res])).slice(0, N);
  const stat = (num, label, href, title = '') => `<a class="card stat" href="${href}" title="${esc(title)}"><div class="num">${num}</div><div class="small muted">${label}</div></a>`;
  m.innerHTML = `
    <section class="hero">
      <h1>The Reverse Mathematics Zoo</h1>
      <p class="muted">Principles of reverse mathematics and the Weihrauch lattice, how they compare under ${Z.R.length} notions of reduction, and where each fact was proved.</p>
      <div class="search big"><input id="home-q" type="search" placeholder="Search a statement — RT22, WKL, Ramsey, induction, LPO…" autocomplete="off" autofocus>
        <div id="home-pop" class="popover" hidden></div></div>
      <div class="chips hero-tags">${Z.raw.tags.map((t) => `<a class="chip" href="#/catalogue?tags=${t.id}">${esc(t.name)}</a>`).join('')}</div>
    </section>

    <div class="stats">
      ${stat(fmt(mains), 'principles', '#/catalogue', `${Z.S.length} statements counting all formulations and combinations`)}
      ${stat(fmt(Z.raw.results.length), 'cited results', '#/results')}
      ${stat(fmt(cited), 'papers cited', '#/refs', `${refs.length} papers in the bibliography`)}
      ${stat(fmt(parsed), 'papers read in full', '#/refs', 'Papers whose full text was parsed when building the database')}
      <span id="derived-stats" style="display:contents"></span>
    </div>

    <h2>Predefined zoos</h2>
    <p class="small muted">Each opens the diagram of a classical selection of statements (it replaces your current selection).</p>
    <div class="presets">${(Z.raw.zoos || []).map((z) => {
      const R = Z.R[Z.ridx.get(z.reduction)];
      return `<a class="card preset" href="${presetHref(z)}">
        <div class="row"><h3 class="grow">${esc(z.name)}</h3><span class="badge" title="${esc(R.name)}">${esc(R.short)}</span></div>
        <p class="small muted">${rich(z.description)}</p>
        <div class="preset-labels">${z.statements.map((id) => `<span>${L(idx(id))}</span>`).join('')}</div></a>`;
    }).join('')}</div>

    <h2>Recently added${lastDate ? ` <span class="small muted">· last update ${esc(lastDate)}</span>` : ''}</h2>
    <div class="recent">
      <div class="card"><h3><a href="#/results">Results</a></h3><ul>${recentRes.map(([ri, res]) =>
        `<li>${resultFact(res)}<div class="small muted">${(res.refs || []).slice(0, 2).map(refLink).join('; ') || (res.provenance === 'ai' ? 'AI-derived' : 'folklore')} · ${esc(res._date)}</div></li>`).join('')}</ul></div>
      <div class="card"><h3><a href="#/catalogue">Statements</a></h3><ul>${recentStmts.map(([i, s]) =>
        `<li>${sLink(i)} <span class="muted">${esc(S(i).name)}</span><div class="small muted">${esc(s._date)}</div></li>`).join('')}</ul></div>
      <div class="card"><h3><a href="#/refs">Papers</a></h3><ul>${recentRefs.map(([k, r]) =>
        `<li><a href="#/refs/${k}"><i>${rich(r.title)}</i></a><div class="small muted">${esc(refShort(k))} · ${esc(r._date)}</div></li>`).join('')}</ul></div>
    </div>`;
  const q = $('#home-q');
  attachSearch(q, $('#home-pop'), (i) => { location.hash = '#/s/' + S(i).id; });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('#home-pop').hidden && q.value.trim()) location.hash = '#/catalogue?q=' + encodeURIComponent(q.value.trim());
  });
  // the derived counts take a moment: fill them after the first paint
  setTimeout(() => {
    const el = $('#derived-stats');
    if (!el) return;
    const { nI, nN, nO } = zooCounts();
    el.innerHTML = stat(fmt(nI), 'derived implications', '#/about', 'Over all pairs of statements and all notions of reduction')
      + stat(fmt(nN), 'derived separations', '#/about', 'Over all pairs of statements and all notions of reduction')
      + stat(fmt(nO), 'open questions', '#/about', 'Pairs (A, B) and reductions for which neither A ⇒ B nor A ⇏ B is known');
  }, 30);
}

// ---- catalogue ------------------------------------------------------------
function viewCatalogue(params) {
  const q = params.get('q') || '';
  const tags = new Set((params.get('tags') || '').split(',').filter(Boolean));
  const showForms = params.get('forms') !== '0';
  let showConj = params.get('conj') === '1';
  const m = main();
  m.className = '';
  const setParams = (next) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.tags.size) p.set('tags', [...next.tags].join(','));
    history.replaceState(null, '', '#/catalogue?' + p.toString());
    draw(next);
  };
  m.innerHTML = `
    <div class="cat-layout">
      <aside class="facets">
        <input class="text" id="cat-q" type="search" placeholder="Filter…" value="${esc(q)}">
        <h3>Categories</h3><div class="chips" id="tag-chips"></div>
        <h3>Show</h3>
        <label class="toggle"><input type="checkbox" id="cat-conj" ${showConj ? 'checked' : ''}> Combinations (A + B)</label>
        <h3>Database</h3>
        <div class="small muted">${Z.S.length} statements · ${Z.raw.results.length} results ·
          ${Object.keys(Z.raw.references).length} papers</div>
      </aside>
      <section><div class="row" style="margin-bottom:12px"><h1 style="margin:0" class="grow">Catalogue</h1>
        <span class="small muted" id="cat-count"></span>
        <button class="btn small" id="cat-selall" title="Add every statement of the list to the selection">+ Select all</button>
        <button class="btn small" id="cat-unselall" title="Remove the statements of the list from the selection" hidden>− Deselect all</button></div>
        <div class="cat-list" id="cat-list"></div></section>
    </div>`;
  const cur = { q, tags };
  let listed = [];
  const syncSelButtons = () => {
    const n = listed.filter((id) => !isSel(id)).length;
    $('#cat-selall').hidden = !n;
    $('#cat-selall').textContent = `+ Select all${n === listed.length ? '' : ' remaining'} (${n})`;
    $('#cat-unselall').hidden = !listed.some(isSel);
  };
  $('#cat-selall').addEventListener('click', () => {
    const add = listed.filter((id) => !isSel(id));
    if (add.length > 80 && !confirm(`Add ${add.length} statements to the selection? Diagrams of that size are slow to read.`)) return;
    state.sel = [...state.sel, ...add]; saveState(); renderTray(); draw(cur);
  });
  $('#cat-unselall').addEventListener('click', () => {
    const drop = new Set(listed);
    state.sel = state.sel.filter((id) => !drop.has(id)); saveState(); renderTray(); draw(cur);
  });
  $('#cat-q').addEventListener('input', (e) => setParams({ ...cur, q: (cur.q = e.target.value) }));
  $('#cat-conj').addEventListener('change', (e) => { showConj = e.target.checked; draw(cur); });
  function draw(c) {
    let ids = c.q ? search(c.q, 1000)
      : Z.S.map((_, i) => i).sort((x, y) => (S(y).base ? 1 : 0) - (S(x).base ? 1 : 0) || hay[x].ascii.localeCompare(hay[y].ascii, 'en', { numeric: true }));
    const matchesTags = (i) => [...c.tags].every((t) => (S(i).tags || []).includes(t));
    const tagCounts = new Map();
    ids.forEach((i) => (S(i).tags || []).forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
    ids = ids.filter(matchesTags).filter((i) => showConj || !S(i).conjunction);
    $('#tag-chips').innerHTML = Z.raw.tags.map((t) => `<span class="chip ${c.tags.has(t.id) ? 'on' : ''}" data-tag="${t.id}" title="${esc(t.description)}">
      ${esc(t.name)} <span class="count">${tagCounts.get(t.id) || 0}</span></span>`).join('');
    $('#tag-chips').onclick = (e) => {
      const t = e.target.closest('[data-tag]');
      if (!t) return;
      c.tags.has(t.dataset.tag) ? c.tags.delete(t.dataset.tag) : c.tags.add(t.dataset.tag);
      setParams(c);
    };
    // group formulations under their main formulation; conjunctions last
    const shown = new Set(ids);
    const mains = [];
    for (const i of ids) {
      const s = S(i);
      const mainI = s.formulationOf ? idx(s.formulationOf) : i;
      if (!mains.includes(mainI)) mains.push(mainI);
    }
    mains.sort((x, y) => (!!S(x).conjunction - !!S(y).conjunction) || (c.q ? 0 : 0));
    $('#cat-count').textContent = `${ids.length} statement${ids.length === 1 ? '' : 's'}`;
    listed = ids.map((i) => S(i).id);
    syncSelButtons();
    $('#cat-list').innerHTML = lazy(mains, (i) => card(i, shown, showForms),
      { size: 30, noun: 'principles', empty: '<p class="muted">No statement matches.</p>' });
  }
  $('#cat-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    if (b) { toggleSel(b.dataset.sel); b.classList.toggle('on', isSel(b.dataset.sel)); b.textContent = isSel(b.dataset.sel) ? '✓ Selected' : '+ Select'; syncSelButtons(); }
  });
  draw(cur);
}

function card(i, shown) {
  const s = S(i);
  const forms = Z.S.map((t, j) => [t, j]).filter(([t]) => t.formulationOf === s.id);
  const def = s.conjunction ? `Conjunction of ${s.conjunction.map((c) => sLink(idx(c))).join(' and ')}.` : rich(s.definition);
  return `<article class="card stmt-card">
    <div class="label">${sLink(i)}</div>
    <div>
      <div class="name"><a href="#/s/${s.id}" style="color:inherit">${esc(s.name)}</a>
        ${s.kind === 'sentence' && !s.conjunction ? '<span class="badge folk" title="Not a problem: only compared over theories and ω-models">sentence</span>' : ''}
        ${s.todo ? '<span class="badge warn" title="The precise definition should be checked against the source">to check</span>' : ''}</div>
      <div class="def">${def}</div>
      ${forms.length ? `<div class="forms">Other formulations: ${forms.map(([t, j]) =>
        `<a href="#/s/${t.id}" style="${shown.has(j) ? '' : 'opacity:.5'}">${L(j)}</a>`).join('')}</div>` : ''}
      <div class="tags">${(s.tags || []).map((t) => `<a class="chip" href="#/catalogue?tags=${t}">${esc(tagName(t))}</a>`).join('')}</div>
    </div>
    <button class="btn small sel-toggle ${isSel(s.id) ? 'on' : ''}" data-sel="${s.id}">${isSel(s.id) ? '✓ Selected' : '+ Select'}</button>
  </article>`;
}

// ---- statement page ---------------------------------------------------------
function viewStatement(id) {
  const i = idx(id);
  const m = main();
  m.className = '';
  if (i === undefined) { m.innerHTML = `<h1>Unknown statement</h1><p><a href="#/catalogue">Back to the catalogue</a></p>`; return; }
  const s = S(i);
  const r = rIdx();
  const mainId = s.formulationOf || s.id;
  const mainI = idx(mainId);
  const family = [mainI, ...Z.S.map((t, j) => (t.formulationOf === mainId ? j : -1)).filter((j) => j >= 0)];
  const refsOf = (s.refs || []);
  const directResults = Z.raw.results.map((res, ri) => [res, ri]).filter(([res]) =>
    [res.from, res.to, res.statement, res.base].includes(s.id));

  m.innerHTML = `
    <div class="stmt-head">
      <span class="label">${L(i)}</span>
      <h1 style="margin:0" class="grow">${esc(s.name)}</h1>
      <button class="btn sel-toggle ${isSel(s.id) ? 'on' : ''}" data-sel="${s.id}">${isSel(s.id) ? '✓ Selected' : '+ Select'}</button>
    </div>
    <div class="row" style="margin:6px 0 14px">
      ${(s.tags || []).map((t) => `<a class="chip" href="#/catalogue?tags=${t}">${esc(tagName(t))}</a>`).join('')}
      ${s.aliases ? `<span class="small muted">Also: ${s.aliases.map(esc).join(', ')}</span>` : ''}
    </div>
    ${s.formulationOf ? `<p>A formulation of ${sLink(mainI)} (the main formulation of this principle).</p>` : ''}
    ${s.todo ? `<p><span class="badge warn">definition to be checked</span> <span class="small muted">The precise statement should be checked against the source paper.</span></p>` : ''}
    ${s.form || s.firstOrder ? `<p class="small muted">Syntactic form: ${esc(CLASS_NAMES[s.form] || (s.firstOrder ? 'arithmetical' : s.form))} (used by conservation results).</p>` : ''}
    <div class="card def-box">${s.conjunction ? `Conjunction of ${s.conjunction.map((c) => sLink(idx(c))).join(' and ')}.` : rich(s.definition)}</div>
    ${s.kind === 'problem' && s.instance ? `<div class="io">
      <div class="card"><h3>Instances</h3>${rich(s.instance)}</div>
      <div class="card"><h3>Solutions</h3>${rich(s.solution)}</div></div>`
      : s.kind === 'sentence' && !s.conjunction ? `<p class="small muted">Not a problem: compared only over theories and ω-models.</p>` : ''}

    ${family.length > 1 ? `<h2>Formulations</h2>
      <p class="small muted">How each formulation compares with the main one, ${L(mainI)}, at each notion of reduction.
      ≡ equivalent · &gt; main is strictly stronger · &lt; strictly weaker · | incomparable · ? unknown · – not applicable. Click a cell for proofs.</p>
      <div style="overflow-x:auto"><table class="grid" id="forms"><tr><th></th>${Z.R.map((R) => `<th class="c">${esc(R.short)}</th>`).join('')}</tr>
      ${family.filter((j) => j !== mainI).map((j) => `<tr><td>${sLink(j)}</td>${Z.R.map((_, rr) => {
        const [sy, cls] = compareSym(Z.status(rr, mainI, j), Z.status(rr, j, mainI));
        return `<td class="c ${cls}" style="cursor:pointer" data-pair="${mainI},${j},${rr}">${sy}</td>`;
      }).join('')}</tr>`).join('')}</table></div>` : ''}

    <h2>Position in the zoo</h2>
    <div class="row" style="align-items:flex-start;gap:24px">
      <div id="rpick"></div>
      <div class="grow" id="rels"></div>
    </div>

    <h2>Properties</h2>
    <table class="grid" id="props"><tr><th>Property</th><th class="c">Status</th><th>Preserved under</th></tr>
    ${Z.raw.properties.map((p, pi) => {
      const e = Z.prop(pi, i);
      const st = e ? (e.v ? '<span class="yes">✓ has</span>' : '<span class="no">✗ fails</span>') : '<span class="open">?</span>';
      return `<tr data-prop="${pi}" style="cursor:pointer"><td>${esc(p.name)}</td><td class="c">${st}</td><td class="small muted">${esc(Z.R[Z.ridx.get(p.closedUnder)].short)}</td></tr>`;
    }).join('')}</table>

    <div class="row h2row"><h2 class="grow">Literature</h2>${refsOf.length || directResults.length ? bibButton('bib-stmt', 'BibTeX (literature + cited in results)') : ''}</div>
    ${refsOf.length ? `<ul class="reflist">${refsOf.map((rf) => `<li><span class="role">${esc(rf.role || '')}</span>${refFull(rf.ref)}${rf.loc ? ` — ${esc(rf.loc)}` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">No reference recorded.</p>'}

    <h2>Results mentioning ${L(i)}</h2>
    ${resultsTable(directResults)}
  `;
  // reduction picker + relations
  const drawRels = () => {
    $('#rpick').replaceChildren(reductionPicker(() => drawRels()));
    $('#rels').innerHTML = relations(i, rIdx());
  };
  drawRels();
  $('#bib-stmt')?.addEventListener('click', () => downloadBib(sortKeys([...refsOf.map((x) => x.ref), ...citedKeys(directResults)]), s.id));
  m.onclick = (e) => {
    const b = e.target.closest('[data-sel]');
    if (b) { toggleSel(b.dataset.sel); b.classList.toggle('on'); b.textContent = isSel(b.dataset.sel) ? '✓ Selected' : '+ Select'; return; }
    const pc = e.target.closest('[data-pair]');
    if (pc) { const [a, b2, rr] = pc.dataset.pair.split(',').map(Number); pairPanel(a, b2, rr); return; }
    const pr = e.target.closest('[data-prop]');
    if (pr) propertyPanel(+pr.dataset.prop, i);
  };
}

function compareSym(ab, ba) {
  if (ab === 'na' || ba === 'na') return ['–', 'na'];
  if (ab === 'implies' && ba === 'implies') return ['≡', 'yes'];
  if (ab === 'implies' && ba === 'separated') return ['&gt;', 'yes'];
  if (ab === 'separated' && ba === 'implies') return ['&lt;', 'yes'];
  if (ab === 'separated' && ba === 'separated') return ['|', 'no'];
  if (ab === 'implies') return ['≥ ?', 'open'];
  if (ba === 'implies') return ['≤ ?', 'open'];
  return ['?', 'open'];
}

function relations(i, r) {
  if (!Z.inDomain(r, i)) return `<p class="muted">${L(i)} is not a problem, so it is not compared over ${esc(Z.R[r].name)}.</p>`;
  const groups = { eq: [], implies: [], impliedBy: [], notImp: [], notImpBy: [], openTo: [], openFrom: [] };
  for (let j = 0; j < Z.n; j++) {
    if (j === i || !Z.inDomain(r, j)) continue;
    const ab = Z.status(r, i, j), ba = Z.status(r, j, i);
    if (ab === 'implies' && ba === 'implies') { groups.eq.push(j); continue; }
    if (ab === 'implies') groups.implies.push(j);
    if (ba === 'implies') groups.impliedBy.push(j);
    if (ab === 'separated') groups.notImp.push(j);
    if (ba === 'separated') groups.notImpBy.push(j);
    if (ab === 'open') groups.openTo.push(j);
    if (ba === 'open') groups.openFrom.push(j);
  }
  const box = (title, list, dir) => `<div class="card"><h3>${title} <span class="muted">${list.length}</span></h3>
    ${lazy(list, (j) => `<span class="chip" data-pair="${dir ? `${i},${j}` : `${j},${i}`},${r}">${L(j, r)}</span>`,
      { size: 24, wrap: 'chips', noun: 'statements', empty: '<span class="small muted">none</span>' })}</div>`;
  const R = Z.R[r];
  return `<p class="small muted" style="margin-top:0">Over <b>${esc(R.name)}</b>. Click a statement for the proof.</p>
  <div class="rel-cols">
    ${box('Equivalent to', groups.eq, true)}
    ${box(`${L(i, r)} implies`, groups.implies, true)}
    ${box(`Implies ${L(i, r)}`, groups.impliedBy, false)}
    ${box(`${L(i, r)} does not imply`, groups.notImp, true)}
    ${box(`Does not imply ${L(i, r)}`, groups.notImpBy, false)}
    ${box(`Open: does ${L(i, r)} imply…`, groups.openTo, true)}
    ${box(`Open: does … imply ${L(i, r)}`, groups.openFrom, false)}
  </div>`;
}

const READ = {
  'pdf-zotero': ['full text parsed', 'The PDF (from the maintainer\'s Zotero library) was parsed when extracting results.'],
  'pdf-arxiv': ['full text parsed', 'The arXiv PDF was parsed when extracting results.'],
  'pdf-oa': ['full text parsed', 'An open-access PDF (found via OpenAlex) was parsed when extracting results.'],
  abstract: ['abstract read', 'Only the abstract was read; theorem numbers may be missing.'],
  screened: ['abstract screened', 'The abstract was only screened by keywords; results may be missing.'],
};
const readBadge = (r) => {
  const [label, title] = READ[r.read] || ['not read', 'This paper has not been read; its results come from other sources, if any.'];
  return `<span class="badge read-${r.read || 'none'}" title="${esc(title)}">${label}</span>`;
};
// ---- BibTeX export -----------------------------------------------------------
function downloadBib(keys, name) {
  const blob = new Blob([bibtex(Z.raw.references, [...new Set(keys)])], { type: 'application/x-bibtex' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name + '.bib' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const bibButton = (id, label = 'BibTeX') =>
  `<button class="btn small" id="${id}" title="Download the references in BibTeX format">⤓ ${label}</button>`;
const citedKeys = (results) => results.flatMap(([res]) => (res.refs || []).map((r) => r.ref));
const sortKeys = (keys) => [...new Set(keys)].filter((k) => Z.raw.references[k])
  .sort((a, b) => (Z.raw.references[a].year || 0) - (Z.raw.references[b].year || 0) || a.localeCompare(b));

function refFull(key) {
  const r = Z.raw.references[key];
  if (!r) return esc(key);
  return `${esc(r.authors.join(', '))}. <a href="#/refs/${key}"><i>${rich(r.title)}</i></a>. ${esc(r.venue)}, ${r.year}.
    ${r.doi ? `<a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener" class="small">doi</a>` : ''}
    ${r.arxiv ? `<a href="https://arxiv.org/abs/${esc(r.arxiv)}" target="_blank" rel="noopener" class="small">arXiv</a>` : ''}
    ${r.url && !r.doi ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="small">link</a>` : ''}
    ${readBadge(r)}`;
}

function resultFact(res) {
  const R = (id) => Z.R[Z.ridx.get(id)];
  const overs = [].concat(res.over || []);
  const r0 = Z.ridx.get(overs[0]);
  const over = overs.map((o) => esc(R(o).short)).join(', ');
  if (res.type === 'property') {
    const p = Z.raw.properties[Z.pidx.get(res.property)];
    return `${sLink(idx(res.statement))} ${res.value ? '<span class="yes">has</span>' : '<span class="no">fails</span>'} ${esc(p.name)}`;
  }
  if (res.type === 'conservation') {
    const cls = CLASS_NAMES[res.class] || res.class;
    // "RCA₀ + X", or just "RCA₀" when X is RCA₀ itself (or another base statement over RCA₀)
    const sys = (id) => (S(idx(id)).base || []).includes('rca0') ? sLink(idx(id), Z.ridx.get('rca0')) : `RCA₀ + ${sLink(idx(id), Z.ridx.get('rca0'))}`;
    return `${sys(res.statement)} is ${res.value === false ? '<b class="no">not</b> ' : ''}<b>${esc(cls)}</b>-conservative over ${sys(res.base)}`;
  }
  const arrow = { implication: '<span class="yes">⇒</span>', equivalence: '<span class="yes">⇔</span>', separation: '<span class="no">⇏</span>' }[res.type];
  return `<span class="res-stmt">${sLink(idx(res.from), r0)} ${arrow} ${sLink(idx(res.to), r0)}</span> <span class="muted small">over ${over}</span>`;
}
function resultsTable(list, size = 25) {
  return lazy(list, ([res, ri]) => `<tr><td>${resultFact(res)}</td><td>${resultCite(ri)}</td></tr>`,
    { size, wrap: 'table', head: '<thead><tr><th>Result</th><th>Source</th></tr></thead>', noun: 'results' });
}

// ---- diagram --------------------------------------------------------------
let view = { k: 1, tx: 0, ty: 0 };
function viewDiagram(params) {
  if (params.get('s')) state.sel = params.get('s').split(',').filter((id) => idx(id) !== undefined);
  if (params.get('r') && Z.ridx.has(params.get('r'))) state.r = params.get('r');
  if (params.has('sep')) state.sep = params.get('sep') === '1';
  if (params.has('open')) state.open = params.get('open') === '1';
  saveState();
  const m = main();
  m.className = 'wide';
  m.style.padding = '0';
  m.innerHTML = `<div class="diagram-page">
    <aside class="diagram-side">
      <h3>Notion of reduction</h3><div id="rpick"></div>
      <h3>Show</h3>
      <label class="toggle"><input type="checkbox" id="t-sep" ${state.sep ? 'checked' : ''}> Separations</label>
      <label class="toggle"><input type="checkbox" id="t-open" ${state.open ? 'checked' : ''}> Open questions</label>
      <h3>Statements</h3>
      <div class="search" style="width:100%;margin-bottom:8px"><input id="add-q" type="search" placeholder="Add a statement…" autocomplete="off"><div id="add-pop" class="popover" hidden></div></div>
      <div class="row" style="margin-bottom:8px">
        <select id="add-tag" style="width:auto;flex:1"><option value="">Add a whole category…</option>
          ${Z.raw.tags.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <button class="btn small" id="clear-sel">Clear</button>
      </div>
      <div class="sel-list" id="sel-list"></div>
      <div id="excluded" class="small muted" style="margin-top:8px"></div>
      <h3>Legend</h3>
      <div class="legend">
        <div><svg width="44" height="10"><path d="M2 5H34" stroke="var(--ink)" stroke-width="1.6"/><path d="M34 1L42 5L34 9z" fill="var(--ink)"/></svg> implies (Hasse edge)</div>
        <div><svg width="44" height="10"><path d="M2 5H34" stroke="var(--no)" stroke-width="1.4" stroke-dasharray="6 4"/><path d="M34 1L42 5L34 9z" fill="var(--no)"/></svg> does not imply</div>
        <div><svg width="44" height="10"><path d="M2 5H34" stroke="var(--open)" stroke-width="1.4" stroke-dasharray="2 4"/><path d="M34 1L42 5L34 9z" fill="var(--open)"/></svg> open</div>
        <div class="small muted">Stronger statements are higher. Equivalent statements share a node. Separations and open questions are reduced to the strongest ones (strongest hypothesis, weakest conclusion). Hover a node to see what it implies; click an arrow for its proof.</div>
      </div>
      <h3>Share</h3>
      <div class="row"><button class="btn small" id="copy-link">Copy link</button><button class="btn small" id="export-svg">Export SVG</button></div>
    </aside>
    <div class="viewport" id="vp"><div class="stage" id="stage"></div>
      <div class="zoombar"><button class="btn small" id="z-in">+</button><button class="btn small" id="z-out">−</button><button class="btn small" id="z-fit">Fit</button></div>
    </div>
  </div>`;
  const redraw = () => {
    history.replaceState(null, '', '#/diagram?' + diagramParams());
    $('#rpick').replaceChildren(reductionPicker(redraw));
    drawSelList();
    drawDiagram();
  };
  const drawSelList = () => {
    $('#sel-list').innerHTML = state.sel.map((id) => `<div class="sel-item"><a href="#/s/${id}">${L(idx(id))}</a>
      <span class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S(idx(id)).name)}</span>
      <button class="x" data-rm="${id}" title="Remove">×</button></div>`).join('') || '<span class="small muted">Nothing selected.</span>';
  };
  $('#sel-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { state.sel = state.sel.filter((x) => x !== b.dataset.rm); saveState(); redraw(); }
  });
  attachSearch($('#add-q'), $('#add-pop'), (i) => {
    if (!isSel(S(i).id)) state.sel.push(S(i).id);
    saveState(); redraw();
  });
  $('#add-tag').addEventListener('change', (e) => {
    const t = e.target.value;
    Z.S.forEach((s) => { if ((s.tags || []).includes(t) && !s.conjunction && !isSel(s.id)) state.sel.push(s.id); });
    e.target.value = ''; saveState(); redraw();
  });
  $('#clear-sel').onclick = () => { state.sel = []; saveState(); redraw(); };
  $('#t-sep').onchange = (e) => { state.sep = e.target.checked; saveState(); redraw(); };
  $('#t-open').onchange = (e) => { state.open = e.target.checked; saveState(); redraw(); };
  $('#copy-link').onclick = async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    setTimeout(() => (e.target.textContent = 'Copy link'), 1500);
  };
  $('#export-svg').onclick = exportSvg;
  setupPanZoom();
  redraw();
}
const diagramParams = () => {
  const p = new URLSearchParams();
  p.set('s', state.sel.join(','));
  p.set('r', state.r);
  p.set('sep', state.sep ? '1' : '0');
  p.set('open', state.open ? '1' : '0');
  return p.toString().replace(/%2C/g, ',');
};

let lastDiagram;
function drawDiagram() {
  const r = rIdx();
  const v = orderView(Z, state.sel, r, { selectionOrder: state.sel });
  const stage = $('#stage');
  const vp = $('#vp');
  $('#excluded').innerHTML = v.excluded.length
    ? `Not shown (not problems, so not compared over ${esc(Z.R[r].short)}): ${v.excluded.map((id) => L(idx(id))).join(', ')}` : '';
  $('.empty-hint', vp)?.remove();
  if (!v.classes.length) {
    stage.innerHTML = '';
    vp.insertAdjacentHTML('beforeend', `<div class="empty-hint">Select statements from the catalogue or add them on the left.</div>`);
    return;
  }
  // 1. render nodes to measure them
  stage.innerHTML = v.classes.map((cl, ci) => {
    const others = cl.slice(1);
    return `<div class="dnode ${S(cl[0]).base ? 'base' : ''}" data-c="${ci}">${L(cl[0], r)}
      ${others.length ? `<span class="eq">≡ ${others.map((j) => L(j, r)).join(' ≡ ')}</span>` : ''}</div>`;
  }).join('');
  const els = $$('.dnode', stage);
  const sizes = els.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
  // 2. layout
  const g = layered(sizes, v.hasse, { hgap: 30, vgap: 62 });
  const pad = 40;
  g.nodes.forEach((nd, ci) => { els[ci].style.left = `${nd.x + pad}px`; els[ci].style.top = `${nd.y + pad}px`; });
  const W = g.width + 2 * pad, H = g.height + 2 * pad;
  stage.style.width = `${W}px`; stage.style.height = `${H}px`;
  // 3. edges
  const shift = (pts) => pts.map(([x, y]) => [x + pad, y + pad]);
  const imps = v.hasse.map(([a, b], k) => {
    const pts = shift(g.edges[k]);
    pts[pts.length - 1][1] -= 3; // leave room for the arrow head
    return { a, b, d: verticalSpline(pts), kind: 'imp' };
  });
  const box = (ci) => ({ x: g.nodes[ci].x + pad, y: g.nodes[ci].y + pad, w: g.nodes[ci].w, h: g.nodes[ci].h });
  const curved = (a, b, bend) => {
    const A = box(a), B = box(b);
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
    const clip = (P, tx, ty) => { // point on the border of P towards (tx, ty)
      const ux = tx - P.x, uy = ty - P.y;
      const s = Math.min((P.w / 2 + 3) / Math.abs(ux || 1e-9), (P.h / 2 + 3) / Math.abs(uy || 1e-9));
      return [P.x + ux * s, P.y + uy * s];
    };
    const p0 = clip(A, cx, cy), p1 = clip(B, cx, cy);
    return `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
  };
  const seps = state.sep ? v.separations.map(([a, b]) => ({ a, b, d: curved(a, b, 28), kind: 'sepa' })) : [];
  const opens = state.open ? v.open.map(([a, b]) => ({ a, b, d: curved(a, b, -28), kind: 'opn' })) : [];
  const all = [...imps, ...seps, ...opens];
  stage.insertAdjacentHTML('afterbegin', `<svg class="edges" width="${W}" height="${H}">
    <defs>
      <marker id="m-imp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" style="fill:var(--ink)"/></marker>
      <marker id="m-hl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" style="fill:var(--accent)"/></marker>
      <marker id="m-sep" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" style="fill:var(--no)"/></marker>
      <marker id="m-opn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" style="fill:var(--open)"/></marker>
    </defs>
    ${all.map((e, k) => `<path class="${e.kind}" data-e="${k}" d="${e.d}" marker-end="url(#${{ imp: 'm-imp', sepa: 'm-sep', opn: 'm-opn' }[e.kind]})"/>
      <path class="hit" data-e="${k}" d="${e.d}"><title>${esc(plain(labelOf(v.reps[e.a], r)))} ${e.kind === 'imp' ? '⇒' : e.kind === 'sepa' ? '⇏' : '⇒?'} ${esc(plain(labelOf(v.reps[e.b], r)))}</title></path>`).join('')}
  </svg>`);
  lastDiagram = { v, g, all, W, H, r };
  // interactions
  const svg = $('svg.edges', stage);
  const less = (x, y) => x !== y && Z.I[r].has(v.reps[x] * Z.n + v.reps[y]);
  els.forEach((el, ci) => {
    el.addEventListener('mouseenter', () => {
      stage.classList.add('dim');
      el.classList.add('focus');
      els.forEach((o, cj) => { if (less(cj, ci)) o.classList.add('above'); if (less(ci, cj)) o.classList.add('below'); });
      all.forEach((e, k) => {
        if (e.kind !== 'imp') { if (e.a === ci || e.b === ci) $(`path.${e.kind}[data-e="${k}"]`, svg).classList.add('hl'); return; }
        // edge a → b lies in the cone of ci: above it (b ⪰ ci) or below it (a ⪯ ci)
        const upCone = e.b === ci || less(e.b, ci);
        const downCone = e.a === ci || less(ci, e.a);
        if (upCone || downCone) {
          const p = $(`path.imp[data-e="${k}"]`, svg);
          p.classList.add('hl'); p.setAttribute('marker-end', 'url(#m-hl)');
        }
      });
    });
    el.addEventListener('mouseleave', () => {
      stage.classList.remove('dim');
      els.forEach((o) => o.classList.remove('focus', 'above', 'below'));
      $$('path.hl', svg).forEach((p) => { p.classList.remove('hl'); if (p.classList.contains('imp')) p.setAttribute('marker-end', 'url(#m-imp)'); });
    });
    el.addEventListener('click', (e) => { if (!dragMoved) nodePanel(v, ci, r); e.stopPropagation(); });
  });
  svg.addEventListener('click', (e) => {
    const p = e.target.closest('[data-e]');
    if (!p || dragMoved) return;
    const ed = all[+p.dataset.e];
    pairPanel(v.reps[ed.a], v.reps[ed.b], r);
  });
  fit();
}

function nodePanel(v, ci, r) {
  const cl = v.classes[ci];
  const i = cl[0];
  const s = S(i);
  const others = v.classes.map((c, cj) => cj).filter((cj) => cj !== ci);
  const st = (cj) => Z.status(r, i, v.reps[cj]);
  openDrawer(`
    <div class="stmt-head"><span class="label" style="font-size:1.6rem">${L(i, r)}</span><h2 style="margin:0">${esc(s.name)}</h2></div>
    ${cl.length > 1 ? `<p>Equivalent over ${esc(Z.R[r].short)} to ${cl.slice(1).map((j) => sLink(j, r)).join(', ')}.</p>` : ''}
    <div class="card" style="margin:10px 0">${s.conjunction ? 'Conjunction.' : rich(s.definition)}</div>
    <p><a class="btn small" href="#/s/${s.id}">Open statement page</a>
       <button class="btn small" data-rmc="${ci}">Remove from diagram</button></p>
    <h3>Against the other displayed statements</h3>
    <table class="grid"><tr><th></th><th class="c">${L(i, r)} ⇒ it</th><th class="c">it ⇒ ${L(i, r)}</th></tr>
      ${others.map((cj) => `<tr><td>${L(v.reps[cj], r)}</td>
        <td class="c ${cls(st(cj))}" data-pair="${i},${v.reps[cj]},${r}" style="cursor:pointer">${sym(st(cj))}</td>
        <td class="c ${cls(Z.status(r, v.reps[cj], i))}" data-pair="${v.reps[cj]},${i},${r}" style="cursor:pointer">${sym(Z.status(r, v.reps[cj], i))}</td></tr>`).join('')}
    </table>`);
  drawer().onclick = (e) => {
    const pc = e.target.closest('[data-pair]');
    if (pc) { const [a, b, rr] = pc.dataset.pair.split(',').map(Number); pairPanel(a, b, rr); }
    const rm = e.target.closest('[data-rmc]');
    if (rm) {
      const ids = v.classes[+rm.dataset.rmc].map((j) => S(j).id);
      state.sel = state.sel.filter((x) => !ids.includes(x)); saveState(); closeDrawer(); route();
    }
  };
}
const cls = (st) => ({ implies: 'yes', separated: 'no', open: 'open', na: 'na' })[st] || '';

// pan & zoom
let dragMoved = false;
function applyView() { const st = $('#stage'); if (st) st.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.k})`; }
function fit() {
  const vp = $('#vp'), st = $('#stage');
  if (!vp || !st) return;
  const W = st.offsetWidth, H = st.offsetHeight;
  const k = Math.min(1.4, vp.clientWidth / W, vp.clientHeight / H) * 0.96;
  view = { k, tx: (vp.clientWidth - W * k) / 2, ty: Math.max(8, (vp.clientHeight - H * k) / 2) };
  applyView();
}
function zoomAt(f, cx, cy) {
  const k2 = Math.min(4, Math.max(0.15, view.k * f));
  view.tx = cx - (cx - view.tx) * (k2 / view.k);
  view.ty = cy - (cy - view.ty) * (k2 / view.k);
  view.k = k2; applyView();
}
function setupPanZoom() {
  const vp = $('#vp');
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  let start = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoombar')) return;
    start = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    dragMoved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { dragMoved = true; vp.classList.add('dragging'); }
    if (dragMoved) { view.tx = start.tx + dx; view.ty = start.ty + dy; applyView(); }
  });
  window.addEventListener('pointerup', () => { start = null; vp.classList.remove('dragging'); setTimeout(() => (dragMoved = false), 0); });
  $('#z-in').onclick = () => zoomAt(1.25, vp.clientWidth / 2, vp.clientHeight / 2);
  $('#z-out').onclick = () => zoomAt(0.8, vp.clientWidth / 2, vp.clientHeight / 2);
  $('#z-fit').onclick = fit;
}

function exportSvg() {
  if (!lastDiagram) return;
  const stage = $('#stage');
  const cs = getComputedStyle(document.documentElement);
  const col = (v) => cs.getPropertyValue(v).trim();
  const svg = $('svg.edges', stage).cloneNode(true);
  $$('path.hit', svg).forEach((p) => p.remove());
  $$('path', svg).forEach((p) => {
    const c = getComputedStyle($(`path[data-e="${p.dataset.e}"].${p.classList[0]}`, stage) || p);
    p.setAttribute('stroke', c.stroke); p.setAttribute('stroke-width', c.strokeWidth);
    p.setAttribute('stroke-dasharray', c.strokeDasharray === 'none' ? '' : c.strokeDasharray); p.setAttribute('fill', 'none');
  });
  $$('marker path', svg).forEach((p) => p.setAttribute('fill', getComputedStyle($('marker path', stage)).fill));
  const nodes = $$('.dnode', stage).map((el) => {
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = parseFloat(el.style.left) - w / 2, y = parseFloat(el.style.top) - h / 2;
    return `<foreignObject x="${x}" y="${y}" width="${w + 2}" height="${h + 2}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${w}px;height:${h}px;border:1.5px solid ${col('--node-line')};border-radius:9px;background:${col('--node')};padding:6px 12px;text-align:center;white-space:nowrap;font-family:Inter,sans-serif;color:${col('--ink')}">${el.innerHTML}</div></foreignObject>`;
  }).join('');
  const W = lastDiagram.W, H = lastDiagram.H;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>@import url('https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css'); .eq{display:block;font-size:.78em;opacity:.7}</style>
<rect width="100%" height="100%" fill="${col('--bg')}"/>${svg.innerHTML}${nodes}</svg>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }));
  a.download = `rm-zoo-${state.r}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- compare ----------------------------------------------------------------
function viewCompare(params) {
  if (params.get('s')) state.sel = params.get('s').split(',').filter((id) => idx(id) !== undefined);
  saveState();
  const m = main();
  m.className = 'wide';
  const ids = state.sel.map(idx).filter((i) => i !== undefined);
  if (!ids.length) { m.innerHTML = `<h1>Compare</h1><p class="muted">Select statements in the <a href="#/catalogue">catalogue</a> or open a <a href="#/">predefined zoo</a> first.</p>`; return; }
  const r = rIdx();
  const g = latticeLayout();
  m.innerHTML = `
    <h1>Compare</h1>
    <p class="muted">Row <i>A</i>, column <i>B</i>: does <i>A</i> imply <i>B</i>? Each cell is the lattice of reductions below,
      coloured <span class="yes">implies</span> / <span class="no">does not imply</span> / <span class="open">open</span> / <span class="na">not applicable</span>.</p>
    <div class="row" style="align-items:flex-start;gap:32px">
      <div style="overflow-x:auto"><table class="matrix" id="mx">
        <tr><th></th>${ids.map((b) => `<th class="col">${L(b)}</th>`).join('')}</tr>
        ${ids.map((a) => `<tr><th style="text-align:right">${L(a)}</th>${ids.map((b) => a === b ? '<td class="diag"></td>'
          : `<td><span class="cell" data-pair="${a},${b}" title="${esc(plain(S(a).label))} ⇒ ${esc(plain(S(b).label))}: ${Z.R.map((R, rr) => `${R.short} ${sym(Z.status(rr, a, b))}`).join(', ')}">${latticeSvg({ small: true, status: (rr) => Z.status(rr, a, b) })}</span></td>`).join('')}</tr>`).join('')}
      </table></div>
      <div class="card"><h3>Key</h3>${latticeSvg({ pick: false })}<p class="small muted" style="max-width:${g.width + 10}px">Finer reductions are higher.</p></div>
    </div>

    <h2>Properties</h2>
    <p class="muted small">✓ has · ✗ fails · ? unknown. Columns where every selected statement agrees are highlighted. Click a cell for the proof.</p>
    <div style="overflow-x:auto"><table class="grid pmatrix"><tr><th></th>${Z.raw.properties.map((p) => {
      const vals = ids.map((i) => Z.prop(Z.pidx.get(p.id), i)?.v);
      const common = vals.every((x) => x === true) ? 'yes' : vals.every((x) => x === false) ? 'no' : '';
      return `<th class="c" title="${esc(p.description)}">${esc(p.name)}${common ? ` <span class="${common}">●</span>` : ''}</th>`;
    }).join('')}</tr>
    ${ids.map((i) => `<tr><td>${sLink(i)}</td>${Z.raw.properties.map((p, pi) => {
      const e = Z.prop(pi, i);
      return `<td class="c ${e ? (e.v ? 'yes' : 'no') : 'open'}" data-prop="${pi},${i}">${e ? (e.v ? '✓' : '✗') : '?'}</td>`;
    }).join('')}</tr>`).join('')}</table></div>
    <h2>At ${esc(Z.R[r].name)}</h2>
    <div id="rpick"></div>
    <div id="eqs"></div>`;
  const drawEq = () => {
    $('#rpick').replaceChildren(reductionPicker(drawEq));
    const v = orderView(Z, state.sel, rIdx(), { selectionOrder: state.sel });
    $('#eqs').innerHTML = `<p>${v.classes.length} equivalence class${v.classes.length === 1 ? '' : 'es'}:
      ${v.classes.map((c) => c.map((j) => L(j, rIdx())).join(' ≡ ')).join(' · ')}</p>
      <p><a class="btn" href="#/diagram?${diagramParams()}">Open the diagram</a></p>`;
  };
  drawEq();
  m.onclick = (e) => {
    const c = e.target.closest('[data-pair]');
    if (c) { const [a, b] = c.dataset.pair.split(',').map(Number); pairPanel(a, b, rIdx()); return; }
    const p = e.target.closest('[data-prop]');
    if (p) { const [pi, i] = p.dataset.prop.split(',').map(Number); propertyPanel(pi, i); }
  };
}

// ---- results ------------------------------------------------------------------
function viewResults(params) {
  const m = main();
  m.className = '';
  m.innerHTML = `<h1>Results</h1>
    <p class="muted">The atomic facts of the database. Everything else in the zoo is derived from these.</p>
    <div class="filters">
      <input class="text" id="f-q" placeholder="Statement…" value="${esc(params.get('q') || '')}" style="width:200px">
      <select id="f-type"><option value="">All types</option><option>implication</option><option>equivalence</option><option>separation</option><option>property</option><option>conservation</option></select>
      <select id="f-r"><option value="">All reductions</option>${Z.R.map((R) => `<option value="${R.id}">${esc(R.name)}</option>`).join('')}</select>
      <select id="f-prov"><option value="">Any provenance</option><option value="lit">From the literature</option>
        <option value="folk">Folklore</option><option value="ai">AI-derived</option><option value="aiarg">Argument by AI</option></select>
      <label class="toggle"><input type="checkbox" id="f-check"> Needs check only</label>
      ${bibButton('bib-res', 'BibTeX of cited papers')}
    </div><div id="res"></div>`;
  let shown = [];
  const draw = () => {
    const q = $('#f-q').value.trim();
    const matchIds = q ? new Set(search(q, 1000).map((i) => S(i).id)) : null;
    const type = $('#f-type').value, rr = $('#f-r').value, chk = $('#f-check').checked, prov = $('#f-prov').value;
    const provOk = (res) => !prov
      || (prov === 'lit' && res.refs?.length && !res.folklore && res.provenance !== 'ai')
      || (prov === 'folk' && res.folklore)
      || (prov === 'ai' && res.provenance === 'ai')
      || (prov === 'aiarg' && res.justification?.by === 'ai');
    const list = Z.raw.results.map((res, ri) => [res, ri]).filter(([res]) =>
      (!type || res.type === type) &&
      (!rr || [].concat(res.over || []).includes(rr)) &&
      (!chk || res.status === 'needs-check') && provOk(res) &&
      (!matchIds || [res.from, res.to, res.statement, res.base].some((x) => matchIds.has(x))));
    shown = list;
    $('#res').innerHTML = `<p class="small muted">${list.length} result${list.length === 1 ? '' : 's'} citing ${sortKeys(citedKeys(list)).length} papers</p>${resultsTable(list, 50)}`;
  };
  $('#bib-res').addEventListener('click', () => downloadBib(sortKeys(citedKeys(shown)), 'rmzoo-results'));
  ['#f-q', '#f-type', '#f-r', '#f-check', '#f-prov'].forEach((s) => $(s).addEventListener('input', draw));
  draw();
}

// ---- literature ------------------------------------------------------------------
function viewRefs(key) {
  const m = main();
  m.className = '';
  const refs = Object.entries(Z.raw.references).sort((a, b) => a[1].year - b[1].year || a[0].localeCompare(b[0]));
  const uses = (k) => Z.raw.results.map((res, ri) => [res, ri]).filter(([res]) => (res.refs || []).some((r) => r.ref === k));
  const intro = (k) => Z.S.map((s, i) => [s, i]).filter(([s]) => (s.refs || []).some((r) => r.ref === k));
  if (key) {
    const r = Z.raw.references[key];
    if (!r) { m.innerHTML = '<h1>Unknown reference</h1>'; return; }
    const st = intro(key);
    m.innerHTML = `<p><a href="#/refs">← Literature</a></p>
      <h1>${rich(r.title)}</h1><p>${esc(r.authors.join(', '))} — ${esc(r.venue)}, ${r.year}
      ${r.doi ? ` · <a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener">doi:${esc(r.doi)}</a>` : ''}
      ${r.arxiv ? ` · <a href="https://arxiv.org/abs/${esc(r.arxiv)}" target="_blank" rel="noopener">arXiv:${esc(r.arxiv)}</a>` : ''}
      · ${readBadge(r)}</p>
      <details class="bib"><summary>BibTeX</summary><pre id="bib-one">${esc(bibtex(Z.raw.references, [key]))}</pre>
        <div class="row">${bibButton('bib-ref', 'Download')}<button class="btn small" id="bib-copy">Copy</button></div></details>
      ${st.length ? `<h2>Statements</h2><div class="rel-list">${st.map(([s, i]) => {
        const role = s.refs.find((x) => x.ref === key).role;
        return `<a class="chip" href="#/s/${s.id}" style="color:var(--ink)">${L(i)} <span class="muted">${esc(role || '')}</span></a>`;
      }).join('')}</div>` : ''}
      <h2>Results</h2>${resultsTable(uses(key))}`;
    $('#bib-ref').addEventListener('click', () => downloadBib([key], key));
    $('#bib-copy').addEventListener('click', (e) => navigator.clipboard?.writeText($('#bib-one').textContent).then(() => { e.target.textContent = 'Copied'; }));
    return;
  }
  const nUse = new Map();
  Z.raw.results.forEach((res) => (res.refs || []).forEach((r) => nUse.set(r.ref, (nUse.get(r.ref) || 0) + 1)));
  m.innerHTML = `<h1>Literature</h1>
    <p class="muted">${refs.length} papers. Papers with extracted results feed the zoo; the others come from Brattka's Bibliography on Weihrauch Complexity and an arXiv sweep, and are waiting for their results to be entered.</p>
    <div class="filters"><input class="text" id="rq" placeholder="Author, title, year…" style="width:280px">
      <select id="rsrc"><option value="results">With results in the zoo</option><option value="">All papers</option>
        <option value="weihrauch-bibliography">Weihrauch bibliography only</option><option value="arxiv">arXiv sweep only</option></select>
      <select id="rread"><option value="">Any reading status</option><option value="pdf">Full text parsed</option>
        <option value="abstract">Abstract read</option><option value="screened">Abstract screened</option><option value="none">Not read</option></select>
      <select id="rsort"><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
      ${bibButton('bib-lit', 'BibTeX of this list')}</div>
    <div id="rcount" class="small muted"></div><div id="rl"></div>`;
  const draw = () => {
    const q = $('#rq').value.toLowerCase();
    const src = $('#rsrc').value, dir = $('#rsort').value === 'asc' ? 1 : -1, rd = $('#rread').value;
    const readOk = (r) => !rd || (rd === 'pdf' ? /^pdf/.test(r.read || '') : rd === 'none' ? !r.read : r.read === rd);
    const list = refs.filter(([k, r]) => (!q || [k, r.title, r.venue, r.year, ...r.authors].join(' ').toLowerCase().includes(q)) &&
      (src === 'results' ? nUse.has(k) || intro(k).length : !src || r.source === src) && readOk(r))
      .sort((a, b) => dir * ((a[1].year || 0) - (b[1].year || 0)) || a[0].localeCompare(b[0]));
    shown = list.map(([k]) => k);
    $('#rcount').textContent = `${list.length} paper${list.length === 1 ? '' : 's'}`;
    $('#rl').innerHTML = lazy(list, ([k]) => {
      const u = nUse.get(k) || 0, s = intro(k).length;
      return `<div class="ref-entry">${refFull(k)}
        <div class="small muted">${u} result${u === 1 ? '' : 's'}${s ? ` · ${s} statement${s === 1 ? '' : 's'}` : ''}</div></div>`;
    }, { size: 40, noun: 'papers', empty: '<p class="muted">No paper matches.</p>' });
  };
  let shown = [];
  $('#bib-lit').addEventListener('click', () => downloadBib(shown, 'rmzoo-literature'));
  ['#rq', '#rsrc', '#rsort', '#rread'].forEach((sel) => $(sel).addEventListener('input', draw));
  draw();
}

// ---- about ---------------------------------------------------------------------
function viewAbout() {
  const m = main();
  m.className = '';
  const { nI, nN, nO } = zooCounts();
  const needs = Z.raw.results.filter((r) => r.status === 'needs-check').length;
  const nAi = Z.raw.results.filter((r) => r.provenance === 'ai').length;
  const nFolk = Z.raw.results.filter((r) => r.folklore).length;
  m.innerHTML = `<h1>About the zoo</h1>
    <div class="stats">
      <div class="card"><div class="num">${Z.S.length}</div><div class="small muted">statements</div></div>
      <div class="card"><div class="num">${Z.raw.results.length}</div><div class="small muted">published results</div></div>
      <div class="card"><div class="num">${nI}</div><div class="small muted">derived implications</div></div>
      <div class="card"><div class="num">${nN}</div><div class="small muted">derived separations</div></div>
      <div class="card"><div class="num">${nO}</div><div class="small muted">open pairs</div></div>
      <div class="card"><div class="num">${nFolk}</div><div class="small muted"><a href="#/results">folklore results</a></div></div>
      <div class="card"><div class="num">${nAi}</div><div class="small muted">AI-derived results</div></div>
      <div class="card"><div class="num ${needs ? 'open' : ''}">${needs}</div><div class="small muted">results to check</div></div>
    </div>
    ${Z.contradictions.length || Z.errors.length ? `<div class="verdict separated">The database is inconsistent: ${Z.contradictions.length} contradiction(s), ${Z.errors.length} error(s). Run <code>npm run check</code>.</div>` : ''}
    <h2>How it works</h2>
    <p>The database only stores <b>atomic, cited facts</b>: implications, separations, and properties of statements, each over a notion of reduction.
       Everything else — equivalences, diagrams, separations obtained by preservation of properties — is derived, and every derived fact comes with a proof tree ending in citations.</p>
    <h2>Notions of reduction</h2>
    <div class="row" style="align-items:flex-start;gap:30px">${latticeSvg({})}
      <div class="grow"><p class="small muted">An implication at a reduction holds at every reduction below it; a separation at a reduction holds at every reduction above it.</p>
      <table class="grid">${Z.R.map((R) => `<tr><td><b>${esc(R.short)}</b></td><td>${esc(R.name)}<div class="small muted">${esc(R.description || '')}${R.refs ? ` (${R.refs.map(refLink).join('; ')})` : ''}</div></td></tr>`).join('')}</table></div></div>
    <h2>Properties</h2>
    <table class="grid">${Z.raw.properties.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${rich(p.description)}<div class="small muted">Preserved under ${esc(Z.R[Z.ridx.get(p.closedUnder)].name)}.</div></td></tr>`).join('')}</table>
    <h2>Inference rules</h2>
    <table class="grid">${Object.entries(RULES).map(([k, v]) => `<tr><td><code>${k}</code></td><td>${esc(v)}</td></tr>`).join('')}</table>
    <h2>Contributing</h2>
    <p>Data lives in <code>data/*.yaml</code> (statements, results, references, properties, reductions, tags). Run <code>npm run check</code> to validate and detect contradictions, and <code>npm run build</code> to regenerate the viewer data. See <code>docs/DESIGN.md</code>.</p>
    <p class="small muted">Built ${esc(Z.raw.builtAt || '')}.</p>`;
}

// ============================================================================
// router
// ============================================================================
function currentRoute() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const p = path.split('/').filter(Boolean);
  // old links "#/?q=…" and "#/?tags=…" pointed to the catalogue
  if (!p.length) return /[?&](q|tags)=/.test(location.hash) ? 'catalogue' : 'home';
  return { catalogue: 'catalogue', s: 'statement', diagram: 'diagram', compare: 'compare', results: 'results', refs: 'refs', about: 'about' }[p[0]] || 'catalogue';
}
function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  const name = currentRoute();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name || (name === 'statement' && a.dataset.route === 'catalogue')));
  main().style.padding = '';
  closeDrawer();
  if (name === 'statement') viewStatement(p[1]);
  else if (name === 'diagram') viewDiagram(params);
  else if (name === 'compare') viewCompare(params);
  else if (name === 'results') viewResults(params);
  else if (name === 'refs') viewRefs(p[1]);
  else if (name === 'about') viewAbout();
  else if (name === 'home') viewHome();
  else viewCatalogue(params);
  renderTray();
  if (name !== 'diagram' || route.last !== 'diagram') window.scrollTo(0, 0);
  route.last = name;
}
let rerenderPending = false;
function rerender() { // re-run the current view without scrolling (after selection changes)
  if (rerenderPending) return;
  rerenderPending = true;
  requestAnimationFrame(() => {
    rerenderPending = false;
    const y = window.scrollY;
    const name = currentRoute();
    if (name === 'diagram' || name === 'compare') route();
    else { $$('.sel-toggle').forEach((b) => { b.classList.toggle('on', isSel(b.dataset.sel)); b.textContent = isSel(b.dataset.sel) ? '✓ Selected' : '+ Select'; }); }
    window.scrollTo(0, y);
  });
}

// ============================================================================
// boot
// ============================================================================
async function boot() {
  while (!window.katex) await new Promise((r) => setTimeout(r, 20));
  const raw = await (await fetch('data/zoo.json', { cache: 'no-store' })).json();
  Z = buildZoo(raw);
  if (!Z.ridx.has(state.r)) state.r = 'rca0';
  state.sel = state.sel.filter((id) => idx(id) !== undefined);
  buildHaystack();
  attachSearch($('#global-search'), $('#search-pop'), (i) => { location.hash = `#/s/${S(i).id}`; });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#global-search').focus(); }
    if (e.key === 'Escape') closeDrawer();
  });
  drawer().addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => { if (currentRoute() === 'diagram') fit(); });
  route();
}
boot().catch((e) => { main().innerHTML = `<p class="no">Failed to load the zoo: ${esc(e.message)}</p>`; console.error(e); });
