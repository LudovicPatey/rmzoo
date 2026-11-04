import { buildZoo, orderView, RULES, CLASS_NAMES, questionStatus } from './engine.js';
// formula classes (data/classes.yaml): KaTeX notation, linked to their definition on the About page
const classOf = (id) => (Z.raw.classes || []).find((c) => c.id === id);
const classHtml = (id) => {
  const c = classOf(id);
  if (!c) return esc(CLASS_NAMES[id] || id);
  return `<a class="cls" href="#/about?class=${id}" title="${esc(c.name || '')}${c.aliases ? ` (also written ${esc(c.aliases.join(', '))})` : ''}">${tex(c.notation)}</a>`;
};
import { layered, verticalSpline } from './layout.js';
import { bibtex } from './bibtex.js';
import { relatedIndex, relatedStatements } from './related.js';
import { createCommunity } from './community.js';
import { KINDS, STATUS_NAMES, reviewStatus, itemResult, resultKey } from './review.js';

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
let C; // endorsements and comments (community.js)
const resultIdx = new Map(); // result key → index in Z.raw.results
const state = {
  sel: store.get('rmzoo.sel', ['rca0', 'wkl', 'aca', 'rt22', 'srt22', 'coh']),
  r: store.get('rmzoo.r', 'rca0'),
  sep: store.get('rmzoo.sep', true),
  open: store.get('rmzoo.open', false),
  mode: store.get('rmzoo.mode', ''), // '' = all reductions (data/modes.yaml)
};
const saveState = () => {
  store.set('rmzoo.sel', state.sel); store.set('rmzoo.r', state.r);
  store.set('rmzoo.sep', state.sep); store.set('rmzoo.open', state.open);
  store.set('rmzoo.mode', state.mode);
};

// ---- modes (data/modes.yaml, docs/DESIGN.md "Modes") ---------------------------------
// A mode is a lens: it keeps the statements, reductions and results of one framework.
// The inference always uses all results; only what is shown changes.
const MODE = () => (state.mode && Z.raw.modes?.find((m) => m.id === state.mode)) || null;
const inMode = (i) => !MODE() || (S(i)._modes || []).includes(MODE().id);
const rInMode = (r) => !MODE() || MODE().reductions.includes(Z.R[r].id);
const resInMode = (res) => {
  const m = MODE();
  if (!m) return true;
  if (res.type === 'property') return !!m.properties;
  if (res.type === 'conservation') return !!m.conservation;
  return [].concat(res.over || []).some((o) => m.reductions.includes(o));
};
// a question belongs to the mode when one of its formal parts does, or (without
// formal parts) when one of its statements does
const qInMode = (q) => !MODE() || (q.formal?.length ? q.formal.some((f) => MODE().reductions.includes(f.over))
  : (q.statements || []).some((id) => idx(id) !== undefined && inMode(idx(id))));
function setMode(id) {
  state.mode = id || '';
  const m = MODE();
  if (m && !m.reductions.includes(state.r)) state.r = m.default;
  saveState();
  renderModeSwitch();
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}
function renderModeSwitch() {
  const m = MODE();
  const sw = $('#mode-switch');
  if (sw) sw.innerHTML = `<select id="mode-select" aria-label="Mode" title="Show only one framework: its statements, reductions and results">
      <option value="">All frameworks</option>${(Z.raw.modes || []).map((x) => `<option value="${x.id}" ${m?.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  const bar = $('#mode-bar');
  if (!bar) return;
  bar.hidden = !m;
  if (!m) { bar.innerHTML = ''; return; }
  const principle = (s) => !s.conjunction && !s.op && !s.minor && !s.formulationOf; // as counted on the front page
  const n = Z.S.filter((s, i) => inMode(i) && principle(s)).length;
  bar.innerHTML = `<b>${esc(m.name)}</b> <span class="muted">· ${m.reductions.map((r) => esc(Z.R[Z.ridx.get(r)].short)).join(', ')}
    · ${n} of ${Z.S.filter(principle).length} principles</span>
    <span class="grow"></span><span class="small muted mode-desc">${esc(m.description || '')}</span>
    <button class="btn small" id="mode-off">Show all frameworks</button>`;
}
document.addEventListener('change', (e) => { if (e.target.id === 'mode-select') setMode(e.target.value); });
document.addEventListener('click', (e) => { if (e.target.id === 'mode-off') setMode(''); });

const S = (i) => Z.S[i];
const idx = (id) => Z.sidx.get(id);
const rIdx = () => {
  const r = Z.ridx.get(state.r) ?? 0;
  return rInMode(r) ? r : Z.ridx.get(MODE().default);
};
function labelOf(i, r = rIdx()) {
  const s = S(i);
  return s.label;
}
const L = (i, r) => tex(labelOf(i, r));
const sLink = (i, r) => `<a href="#/s/${S(i).id}">${L(i, r)}</a>`;
// what kind of statement: a problem (instances and solutions, compared also by
// Weihrauch-style reductions) or a second-order sentence (theories and ω-models only)
const kindBadge = (s) => (s.conjunction ? ''
  : s.kind === 'problem' ? '<span class="badge kind-problem" title="A problem: instances and solutions. Compared over theories and ω-models, and by computable and Weihrauch reductions">problem</span>'
  : '<span class="badge kind-sentence" title="A second-order sentence: compared over theories and ω-models only, not by computable or Weihrauch reductions">second-order</span>');
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
    if (s.minor) score -= 3;
    if (s.formulationOf) score -= 2;
    if (!inMode(i)) score -= 20; // outside the current mode: after its members
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
      <span>${L(i)}</span><span class="muted">${esc(S(i).name)}</span>${inMode(i) ? '' : '<span class="badge other-mode" title="Not studied in the current mode">other framework</span>'}</div>`).join('');
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
      ${pts.map((p, r) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.2" fill="${color[opts.status(r)]}"${rInMode(r) ? '' : ' class="off"'}><title>${esc(Z.R[r].short)}</title></circle>`).join('')}
    </svg>`;
  }
  const w = g.width + 2 * pad, h = g.height + 2 * pad;
  return `<svg class="lattice" width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}">
    ${g.edgeList.map(([a, b]) => `<path class="edge" d="${verticalSpline([[g.nodes[a].x, g.nodes[a].y + 11], [g.nodes[b].x, g.nodes[b].y - 11]])}"/>`).join('')}
    ${g.nodes.map((nd, r) => {
      const cls = ['node'];
      if (opts.pick && rInMode(r)) cls.push('pick');
      if (!rInMode(r)) cls.push('off');
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
    if (!g || !rInMode(+g.dataset.r)) return;
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
  return `<div class="cite">${endorseMark(ri)}${refs}${res.folklore ? ' <span class="badge folk">folklore</span>' : ''}
    ${res.provenance === 'ai' ? ' <span class="badge ai" title="Not taken from the literature: derived by an AI assistant and to be checked">AI-derived</span>' : ''}
    ${j?.by === 'ai' && res.provenance !== 'ai' ? ' <span class="badge ai" title="The justification below was written by an AI assistant">argument by AI</span>' : ''}
    ${res.status === 'needs-check' ? ' <span class="badge warn">needs check</span>' : ''}
    ${res._review ? ` <a class="badge yes" href="#/review/${esc(res._review)}" title="Proposed by the AI reader and validated on the review page; not yet committed to the database">validated on the review page</a>` : ''}</div>
    ${j ? `<div class="note"><b>${esc(JUSTIFICATION_KINDS[j.kind] || j.kind)}.</b> ${richCite(j.text)}</div>` : ''}
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
    <p class="small muted">${prop.closedUnder ? `Preserved downwards under ${esc(Z.R[Z.ridx.get(prop.closedUnder)].name)}:
      if a statement has it, so does every statement it implies; if A has it and B does not, A does not imply B.`
      : 'Preserved by no reduction (it cannot be iterated to build models): it is only related to the other properties.'}</p>
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

// ---- open questions -------------------------------------------------------------
const QSTATUS = { open: ['open', 'warn'], partial: ['partially answered', 'partial'], resolved: ['resolved', 'ok'] };
const qInfo = (q) => (q._st ||= questionStatus(Z, q));
const questionCounts = () => {
  const c = { open: 0, partial: 0, resolved: 0 };
  for (const q of Z.raw.questions || []) if (qInMode(q)) c[qInfo(q).status]++;
  return c;
};
const firstAsked = (q) => Math.min(...q.asked.map((a) => Z.raw.references[a.ref]?.year || 9999));
// statements a question is about: listed ones and those of its formal parts
const qStatements = (q) => [...new Set([...(q.statements || []), ...(q.formal || []).flatMap((f) => [f.from, f.to])])].filter((id) => idx(id) !== undefined);
// the papers that answered it: given by hand, or the papers cited by the database's proofs that appeared after it was asked
function qSolvers(q) {
  if (q.resolvedBy?.length) return q.resolvedBy;
  const y = firstAsked(q);
  const refs = new Map();
  for (const ri of qInfo(q).results) {
    const res = Z.raw.results[ri];
    if (res.provenance === 'ai') continue;
    for (const r of res.refs || []) if ((Z.raw.references[r.ref]?.year || 0) >= y && !refs.has(r.ref)) refs.set(r.ref, r);
  }
  return [...refs.values()].sort((a, b) => (Z.raw.references[a.ref]?.year || 0) - (Z.raw.references[b.ref]?.year || 0));
}
const qBadge = (q) => { const [label, cls] = QSTATUS[qInfo(q).status]; return `<span class="badge q-${cls}">${label}</span>`; };
const qAskedShort = (q) => q.asked.map((a) => `<a href="#/refs/${a.ref}">${esc(refShort(a.ref))}</a>`).join(', ');
function questionRow(q) {
  return `<div class="card q-row">
    <div class="row" style="align-items:baseline;gap:8px">${qBadge(q)}${q.kind === 'conjecture' ? '<span class="badge folk">conjecture</span>' : ''}
      <a class="q-text grow" href="#/questions/${q.id}">${rich(q.question)}</a></div>
    <div class="small muted" style="margin-top:4px">Asked in ${qAskedShort(q)}
      ${qInfo(q).status !== 'open' ? ` · answered in ${qSolvers(q).map((r) => `<a href="#/refs/${r.ref}">${esc(refShort(r.ref))}</a>`).join(', ') || 'the database'}` : ''}</div>
  </div>`;
}

function viewQuestions(params, id) {
  const m = main();
  m.className = '';
  const all = (Z.raw.questions || []).slice().sort((a, b) => firstAsked(a) - firstAsked(b) || a.id.localeCompare(b.id));
  const listed = all.filter(qInMode); // the list follows the mode; a question's own page is always shown
  if (id) {
    const q = all.find((x) => x.id === id);
    if (!q) { m.innerHTML = '<h1>Unknown question</h1><p><a href="#/questions">All questions</a></p>'; return; }
    const st = qInfo(q);
    const solvers = st.status !== 'open' ? qSolvers(q) : [];
    const stm = qStatements(q);
    const over = q.formal?.[0]?.over || 'rca0';
    m.innerHTML = `<p><a href="#/questions">← Open questions</a></p>
      <div class="row" style="gap:8px;align-items:center">${qBadge(q)}${q.kind === 'conjecture' ? '<span class="badge folk">conjecture</span>' : ''}</div>
      <h1 class="q-title">${rich(q.question)}</h1>
      <p><b>${q.asked.length > 1 ? 'Asked in' : 'Asked in'}</b> ${q.asked.map((a) => `<a href="#/refs/${a.ref}">${esc(refShort(a.ref))}</a>${a.loc ? `, ${esc(a.loc)}` : ''}`).join('; ')}.</p>
      ${st.status !== 'open' ? `<div class="verdict ${st.status === 'resolved' ? 'implies' : 'open'}">
        <b>${st.status === 'resolved' ? 'Resolved' : 'Partially answered'}</b>${q.answer ? ` — ${esc(q.answer)}` : ''}
        ${solvers.length ? `<div class="small" style="margin-top:4px">Answered in ${solvers.map((r) => `<a href="#/refs/${r.ref}">${esc(refShort(r.ref))}</a>${r.loc ? `, ${esc(r.loc)}` : ''}`).join('; ')}.</div>` : ''}</div>`
        : `<div class="verdict open"><b>Open.</b> ${q.formal ? 'None of its parts is settled by the results of the database.' : 'No answer is recorded.'}</div>`}
      ${q.context ? `<h2>Context</h2><div class="context">${richCite(q.context)}</div>` : ''}
      ${st.parts.length ? `<h2>In the database</h2>
        <p class="small muted">The question as comparisons of the zoo. Click a row for the proof or the current state of knowledge.</p>
        <table class="grid q-parts">${st.parts.map((p) => {
          const R = Z.R[p.r];
          const v = { implies: ['yes', 'yes'], separated: ['no', 'no'], open: ['open', 'open'] }[p.status] || [p.status, 'na'];
          return `<tr data-pair="${p.a},${p.b},${p.r}" style="cursor:pointer"><td>Does ${sLink(p.a, p.r)} imply ${sLink(p.b, p.r)} over ${esc(R.short)}?</td>
            <td class="c ${v[1]}"><b>${v[0]}</b></td></tr>`;
        }).join('')}</table>` : ''}
      ${stm.length ? `<h2>Statements</h2><div class="rel-list">${stm.map((s) => `<a class="chip" href="#/s/${s}" style="color:var(--ink)">${L(idx(s))}</a>`).join('')}</div>
        <p><a class="btn small" href="#/diagram?s=${stm.join(',')}&r=${over}&sep=1&open=1">Diagram of these statements</a></p>` : ''}`;
    m.onclick = (e) => {
      const t = e.target.closest('[data-pair]');
      if (t && !e.target.closest('a')) { const [a, b, r] = t.dataset.pair.split(',').map(Number); pairPanel(a, b, r); }
    };
    return;
  }
  const c = questionCounts();
  m.innerHTML = `<h1>Open questions</h1>
    <p class="muted">Questions and conjectures stated explicitly in the literature, with their status. When a question can be phrased as comparisons of the zoo,
      its status is derived from the database, so it becomes resolved as soon as the answering result is entered.</p>
    <div class="filters">
      <input class="text" id="q-q" placeholder="Search…" value="${esc(params.get('q') || '')}" style="width:220px">
      <select id="q-status"><option value="">All (${listed.length})</option><option value="open">Open (${c.open})</option>
        <option value="partial">Partially answered (${c.partial})</option><option value="resolved">Resolved (${c.resolved})</option></select>
      <select id="q-sort"><option value="asc">Oldest first</option><option value="desc">Newest first</option></select>
    </div>
    <div id="q-count" class="small muted"></div><div id="q-list"></div>`;
  if (params.get('status')) $('#q-status').value = params.get('status');
  const sid = params.get('s');
  const draw = () => {
    const text = $('#q-q').value.trim().toLowerCase(), stv = $('#q-status').value, dir = $('#q-sort').value === 'desc' ? -1 : 1;
    const hit = (q) => !text || [q.question, q.context, q.id, ...q.asked.map((a) => refShort(a.ref)), ...qStatements(q).map((s) => S(idx(s)).name + ' ' + hay[idx(s)].ascii)]
      .join(' ').toLowerCase().includes(text);
    const list = listed.filter((q) => (!stv || qInfo(q).status === stv) && (!sid || qStatements(q).includes(sid)) && hit(q))
      .sort((a, b) => dir * (firstAsked(a) - firstAsked(b)));
    $('#q-count').textContent = `${list.length} question${list.length === 1 ? '' : 's'}${sid ? ` about ${S(idx(sid))?.name || sid}` : ''}`;
    $('#q-list').innerHTML = lazy(list, questionRow, { size: 30, noun: 'questions', empty: '<p class="muted">No question matches.</p>' });
  };
  ['#q-q', '#q-status', '#q-sort'].forEach((x) => $(x).addEventListener('input', draw));
  draw();
}

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
  const mains = Z.S.filter((s, i) => !s.conjunction && !s.op && !s.formulationOf && !s.minor && inMode(i)).length;
  const refs = Object.values(Z.raw.references);
  const parsed = refs.filter((r) => /^pdf/.test(r.read || '')).length;
  const modeResults = Z.raw.results.filter(resInMode);
  const cited = new Set(modeResults.flatMap((r) => (r.refs || []).map((x) => x.ref))).size;
  const lastDate = Z.raw.results.concat(Z.raw.statements).reduce((d, x) => (x._date > d ? x._date : d), '');
  const N = 6;
  const recentRefs = newest(Object.entries(Z.raw.references)).slice(0, N);
  const recentStmts = newest(Z.S.map((s, i) => [i, Z.raw.statements.find((x) => x.id === s.id) || s])).filter(([i]) => !S(i).conjunction && !S(i).minor && inMode(i)).slice(0, N);
  const recentRes = newest(Z.raw.results.map((res, ri) => [ri, res]).filter(([, res]) => resInMode(res))).slice(0, N);
  const stat = (num, label, href, title = '') => `<a class="card stat" href="${href}" title="${esc(title)}"><div class="num">${num}</div><div class="small muted">${label}</div></a>`;
  m.innerHTML = `
    <section class="hero">
      <h1>The Reverse Mathematics Zoo</h1>
      <p class="muted">Principles of reverse mathematics and the Weihrauch lattice, how they compare under ${Z.R.length} notions of reduction, and where each fact was proved.</p>
      <div class="search big"><input id="home-q" type="search" placeholder="Search a statement — RT22, WKL, Ramsey, induction, LPO…" autocomplete="off" autofocus>
        <div id="home-pop" class="popover" hidden></div></div>
      <div class="chips hero-tags">${Z.raw.tags.map((t) => `<a class="chip" href="#/catalogue?tags=${t.id}">${esc(t.name)}</a>`).join('')}</div>
      <div class="hero-modes"><span class="small muted">Frameworks:</span>
        <a class="chip ${!MODE() ? 'on' : ''}" href="#/?mode=" title="Every reduction">All</a>
        ${(Z.raw.modes || []).map((x) => `<a class="chip ${MODE()?.id === x.id ? 'on' : ''}" href="#/?mode=${x.id}" title="${esc(x.description || '')}">${esc(x.name)}</a>`).join('')}</div>
    </section>

    <div class="stats">
      ${stat(fmt(mains), 'principles', '#/catalogue', `${Z.S.length} statements counting all formulations and combinations`)}
      ${stat(fmt(modeResults.length), 'cited results', '#/results')}
      ${stat(fmt(cited), 'papers cited', '#/refs', `${refs.length} papers in the bibliography`)}
      ${stat(fmt(parsed), 'papers read in full', '#/refs', 'Papers whose full text was parsed when building the database')}
      ${(() => { const c = questionCounts(); return stat(fmt(c.open), 'open questions', '#/questions?status=open',
        `Questions stated explicitly in the literature and still unanswered (${c.partial} more are partially answered, ${c.resolved} resolved)`); })()}
      ${Z.raw.review?.open ? stat(fmt(Z.raw.review.open), 'proposals to review', '#/review', 'Results, statements and leads proposed by the AI reader and the consolidation, not yet in the database') : ''}
    </div>

    <h2>Predefined zoos</h2>
    <p class="small muted">Each opens the diagram of a classical selection of statements (it replaces your current selection).</p>
    <div class="presets">${(Z.raw.zoos || []).filter((z) => rInMode(Z.ridx.get(z.reduction))).map((z) => {
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
}

// ---- catalogue ------------------------------------------------------------
function viewCatalogue(params) {
  const q = params.get('q') || '';
  const tags = new Set((params.get('tags') || '').split(',').filter(Boolean));
  const over = new Set((params.get('over') || '').split(',').filter(Boolean));
  const showForms = params.get('forms') !== '0';
  let showConj = params.get('conj') === '1';
  let showOps = params.get('ops') === '1';
  let showMinor = params.get('minor') === '1';
  const m = main();
  m.className = '';
  const setParams = (next) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.tags.size) p.set('tags', [...next.tags].join(','));
    if (next.over.size) p.set('over', [...next.over].join(','));
    history.replaceState(null, '', '#/catalogue?' + p.toString());
    draw(next);
  };
  m.innerHTML = `
    <div class="cat-layout">
      <aside class="facets">
        <input class="text" id="cat-q" type="search" placeholder="Filter…" value="${esc(q)}">
        <h3>Studied over</h3><div class="chips" id="over-chips"></div>
        <h3>Categories</h3><div class="chips" id="tag-chips"></div>
        <h3>Show</h3>
        <label class="toggle"><input type="checkbox" id="cat-conj" ${showConj ? 'checked' : ''}> Combinations (A + B)</label>
        <label class="toggle" title="Jumps, parallelizations, products and compositional products of problems (Weihrauch algebra)"><input type="checkbox" id="cat-ops" ${showOps ? 'checked' : ''}> Weihrauch operations (P′, P̂, P*, P × Q, P ⋆ Q)</label>
        <label class="toggle" title="Statements studied in a single paper or of secondary interest, such as classical theorems equivalent to a Big Five system; they are listed on the pages of the statements equivalent to them"><input type="checkbox" id="cat-minor" ${showMinor ? 'checked' : ''}> Minor statements (${Z.S.filter((s) => s.minor).length})</label>
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
  const cur = { q, tags, over };
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
  $('#cat-ops').addEventListener('change', (e) => { showOps = e.target.checked; draw(cur); });
  $('#cat-minor').addEventListener('change', (e) => { showMinor = e.target.checked; draw(cur); });
  function draw(c) {
    let ids = c.q ? search(c.q, 1000)
      : Z.S.map((_, i) => i).sort((x, y) => (S(y).base ? 1 : 0) - (S(x).base ? 1 : 0) || hay[x].ascii.localeCompare(hay[y].ascii, 'en', { numeric: true }));
    ids = ids.filter(inMode);
    const matchesTags = (i) => [...c.tags].every((t) => (S(i).tags || []).includes(t));
    const tagCounts = new Map();
    ids.forEach((i) => (S(i).tags || []).forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
    const overCounts = new Map();
    ids.filter(matchesTags).forEach((i) => FRAMES.forEach(([f]) => S(i).studied?.[f] && overCounts.set(f, (overCounts.get(f) || 0) + 1)));
    ids = ids.filter(matchesTags).filter((i) => [...c.over].every((f) => S(i).studied?.[f])).filter((i) => (showConj || !S(i).conjunction) && (showOps || !S(i).op) && (showMinor || !S(i).minor));
    $('#over-chips').innerHTML = FRAMES.map(([f, label, what]) => `<span class="chip ${c.over.has(f) ? 'on' : ''}" data-over="${f}"
      title="Statements studied with ${what} in at least one paper">${label} <span class="count">${overCounts.get(f) || 0}</span></span>`).join('');
    $('#over-chips').onclick = (e) => {
      const t = e.target.closest('[data-over]');
      if (!t) return;
      c.over.has(t.dataset.over) ? c.over.delete(t.dataset.over) : c.over.add(t.dataset.over);
      setParams(c);
    };
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
    mains.sort((x, y) => (!!S(x).conjunction - !!S(y).conjunction) || (!!S(x).op - !!S(y).op));
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

// frameworks in which a statement has been studied in the literature (computed by the build)
const FRAMES = [['rca0', 'Over RCA₀', 'provability over RCA₀'], ['rca0star', 'Over RCA₀*', 'provability over RCA₀*'],
  ['weihrauch', 'Weihrauch', '(strong) Weihrauch reducibility']];
const frameBadges = (s, link = true) => FRAMES.filter(([f]) => s.studied?.[f]).map(([f, label, what]) => {
  const n = s.studied[f].length;
  const t = `Studied with ${what} in ${n} paper${n === 1 ? '' : 's'}`;
  return link ? `<a class="badge frame frame-${f}" href="#/catalogue?over=${f}" title="${t}">${label}</a>` : `<span class="badge frame frame-${f}" title="${t}">${label}</span>`;
}).join('');

function card(i, shown) {
  const s = S(i);
  const forms = Z.S.map((t, j) => [t, j]).filter(([t]) => t.formulationOf === s.id);
  const def = s.conjunction ? `Conjunction of ${s.conjunction.map((c) => sLink(idx(c))).join(' and ')}.` : rich(s.definition);
  return `<article class="card stmt-card">
    <div class="label">${sLink(i)}</div>
    <div>
      <div class="name"><a href="#/s/${s.id}" style="color:inherit">${esc(s.name)}</a>
        ${kindBadge(s)}
        ${s.todo ? '<span class="badge warn" title="The precise definition should be checked against the source">to check</span>' : ''}
        ${cautionBadge(s)}
        ${frameBadges(s)}</div>
      <div class="def">${def}</div>
      ${forms.length ? `<div class="forms">Other formulations: ${forms.map(([t, j]) =>
        `<a href="#/s/${t.id}" style="${shown.has(j) ? '' : 'opacity:.5'}">${L(j)}</a>`).join('')}</div>` : ''}
      <div class="tags">${(s.tags || []).map((t) => `<a class="chip" href="#/catalogue?tags=${t}">${esc(tagName(t))}</a>`).join('')}</div>
    </div>
    <button class="btn small sel-toggle ${isSel(s.id) ? 'on' : ''}" data-sel="${s.id}">${isSel(s.id) ? '✓ Selected' : '+ Select'}</button>
  </article>`;
}

// ---- statement page ---------------------------------------------------------
// tabs of the statement page: [id, label]; the tab is kept in the URL (?tab=…)
const STMT_TABS = [['overview', 'Overview'], ['position', 'Position'], ['properties', 'Properties'],
  ['literature', 'Literature'], ['questions', 'Questions'], ['results', 'Results']];
let relIndex; // computed once per zoo
function relatedHtml(i) {
  const rel = relatedStatements(Z, i, { index: (relIndex ||= relatedIndex(Z)), limit: 30 }).filter((x) => inMode(x.j)).slice(0, 12);
  if (!rel.length) return '';
  const why = (x) => x.papers.length
    ? `<span title="${esc(x.papers.map(refShort).join('; '))}">${x.papers.length} paper${x.papers.length === 1 ? '' : 's'} in common</span>`
    : `same area: ${x.tags.map((t) => esc(tagName(t))).join(', ')}`;
  const top = [S(i).id, ...rel.slice(0, 5).map((x) => S(x.j).id)];
  return `<div class="row h2row"><h2 class="grow">Related statements</h2>
      <a class="btn small" href="#/compare?s=${top.join(',')}" title="Replaces the current selection">Compare with the first five</a></div>
    <p class="small muted">Statements studied in the same papers (papers about many statements count less), then in the same area.</p>
    <table class="grid related">${rel.map((x) => `<tr><td>${sLink(x.j)}</td><td>${esc(S(x.j).name)}</td><td class="small muted">${why(x)}</td>
      <td class="c"><button class="btn small sel-toggle ${isSel(S(x.j).id) ? 'on' : ''}" data-sel="${S(x.j).id}">${isSel(S(x.j).id) ? '✓ Selected' : '+ Select'}</button></td></tr>`).join('')}</table>`;
}

function viewStatement(id, params = new URLSearchParams()) {
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
  const allResults = Z.raw.results.map((res, ri) => [res, ri]).filter(([res]) =>
    [res.from, res.to, res.statement, res.base].includes(s.id));
  const directResults = allResults.filter(([res]) => resInMode(res));
  const hiddenResults = allResults.length - directResults.length;
  const qs = (Z.raw.questions || []).filter((q) => qStatements(q).includes(s.id) && qInMode(q));
  const count = { literature: refsOf.length, questions: qs.length, results: directResults.length };
  const tabs = STMT_TABS.filter(([t]) => (t !== 'questions' || qs.length) && (t !== 'properties' || !MODE() || MODE().properties));
  const tab = tabs.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overview';
  const panel = (t) => `<section class="tab-panel" data-panel="${t}"${t === tab ? '' : ' hidden'}>`;

  m.innerHTML = `
    <div class="stmt-head">
      <span class="label">${L(i)}</span>
      <h1 style="margin:0" class="grow">${esc(s.name)}</h1>
      ${C.live ? `<button class="btn" data-feedback="comment|statement|${s.id}" title="Comment or report an error (signed in with ORCID)">Comment</button>` : ''}
      <button class="btn sel-toggle ${isSel(s.id) ? 'on' : ''}" data-sel="${s.id}">${isSel(s.id) ? '✓ Selected' : '+ Select'}</button>
    </div>
    <div class="row" style="margin:6px 0 14px">
      ${kindBadge(s)}
      ${(s.tags || []).map((t) => `<a class="chip" href="#/catalogue?tags=${t}">${esc(tagName(t))}</a>`).join('')}
      ${frameBadges(s)}
      ${s.aliases ? `<span class="small muted">Also: ${s.aliases.map(esc).join(', ')}</span>` : ''}
    </div>
    ${s.caution ? `<div class="caution-box"><b>⚠ Beware of the name.</b> ${richLinks(s.caution)}</div>` : ''}
    ${!inMode(i) ? `<p class="mode-note">${MODE().reductions.every((x) => !Z.inDomain(Z.ridx.get(x), i))
      ? `${L(i)} is a second-order sentence: the reductions of <b>${esc(MODE().name)}</b> compare problems only and do not apply to it.`
      : `${L(i)} is not studied in <b>${esc(MODE().name)}</b>: no cited result about it uses
      ${MODE().reductions.map((x) => esc(Z.R[Z.ridx.get(x)].short)).join(', ')}. Its relations there are those the database derives.`}
      <button class="btn small" id="mode-off">Show all frameworks</button></p>` : ''}
    <nav class="tabs" role="tablist">${tabs.map(([t, label]) => `<button role="tab" data-tab="${t}" aria-selected="${t === tab}">${label}${count[t] ? ` <span class="count">${count[t]}</span>` : ''}</button>`).join('')}</nav>

    ${panel('overview')}
    ${s.formulationOf ? `<p>A formulation of ${sLink(mainI)} (the main formulation of this principle).</p>` : ''}
    ${s.minor ? `<p class="small muted">A minor statement: studied in few papers or of secondary interest, it is hidden from the catalogue by default and listed on the pages of the statements equivalent to it.</p>` : ''}
    ${s.op ? `<p class="small">Weihrauch operation — ${{ jump: 'jump', par: 'parallelization', fin: 'finite parallelization', diamond: 'diamond (closure under compositional product)', product: 'product', compose: 'compositional product' }[s.op]} of
      ${(s.args || []).map((x) => (idx(x) !== undefined ? sLink(idx(x)) : esc(x))).join(' and ')}. Such statements are hidden in the catalogue unless "Weihrauch operations" is checked.</p>` : ''}
    ${s.todo ? `<p><span class="badge warn">definition to be checked</span> <span class="small muted">The precise statement should be checked against the source paper.</span></p>` : ''}
    ${s.form || s.firstOrder ? `<p class="small muted">Syntactic form: ${classHtml(s.form || 'arith')} (used by conservation results).</p>` : ''}
    <div class="card def-box">${s.conjunction ? `Conjunction of ${s.conjunction.map((c) => sLink(idx(c))).join(' and ')}.` : rich(s.definition)}</div>
    ${s.kind === 'problem' && s.instance ? `<div class="io">
      <div class="card"><h3>Instances</h3>${rich(s.instance)}</div>
      <div class="card"><h3>Solutions</h3>${rich(s.solution)}</div></div>`
      : s.kind === 'sentence' && !s.conjunction ? `<p class="small muted">A second-order sentence, not a problem: compared only over theories and ω-models.</p>` : ''}

    ${!s.conjunction ? `<h2>Context</h2>
      ${s.context ? `<div class="context">${richCite(s.context)}</div>` : ''}
      ${glance(i, directResults)}` : ''}
    ${relatedHtml(i)}
    </section>

    ${panel('position')}
    ${family.length > 1 ? `<h2>Formulations</h2>
      <p class="small muted">How each formulation compares with the main one, ${L(mainI)}, at each notion of reduction.
      ≡ equivalent · &gt; main is strictly stronger · &lt; strictly weaker · | incomparable · ? unknown · – not applicable. Click a cell for proofs.</p>
      <div style="overflow-x:auto"><table class="grid" id="forms"><tr><th></th>${Z.R.filter((_, rr) => rInMode(rr)).map((R) => `<th class="c">${esc(R.short)}</th>`).join('')}</tr>
      ${family.filter((j) => j !== mainI).map((j) => `<tr><td>${sLink(j)}</td>${Z.R.map((_, rr) => rr).filter(rInMode).map((rr) => {
        const [sy, cls] = compareSym(Z.status(rr, mainI, j), Z.status(rr, j, mainI));
        return `<td class="c ${cls}" style="cursor:pointer" data-pair="${mainI},${j},${rr}">${sy}</td>`;
      }).join('')}</tr>`).join('')}</table></div>` : ''}

    <h2>Position in the zoo</h2>
    <div class="row" style="align-items:flex-start;gap:24px">
      <div id="rpick"></div>
      <div class="grow" id="rels"></div>
    </div>
    </section>

    ${panel('properties')}
    ${(() => {
      // properties of problems do not apply to sentences not formulated as problems.
      // Listed: the extremal known ones and the open ones (Z.salientProps); the
      // others follow through the implications between properties and are hidden
      // behind a toggle. Members of infinite families (low₂, Σ⁰₂…) appear only
      // where something is known about them or around them.
      const salient = new Set(Z.salientProps(i));
      const rest = Z.raw.properties.map((p, pi) => pi).filter((pi) => !salient.has(pi) && Z.prop(pi, i));
      const shown = Z.raw.properties.map((p, pi) => [p, pi]).filter(([, pi]) => salient.has(pi) || rest.includes(pi));
      const note = Z.raw.properties.some((p, pi) => !Z.propIn(pi, i))
        ? `<p class="muted small">${L(i)} is not formulated as a problem (instances and solutions), so the computability-theoretic properties do not apply to it.</p>` : '';
      const toggle = rest.length ? `<p class="small muted">Only the strongest properties ${L(i)} has, the weakest it fails and the open ones are listed; the rest follows from the
        implications between properties. <button class="btn small" id="props-all">Show ${rest.length} more</button></p>` : '';
      return note + (shown.length ? `${toggle}<table class="grid" id="props"><tr><th>Property</th><th class="c">Status</th><th>Preserved under</th></tr>
      ${shown.map(([p, pi]) => {
        const e = Z.prop(pi, i);
        const st = e ? (e.v ? '<span class="yes">✓ has</span>' : '<span class="no">✗ fails</span>') : '<span class="open">?</span>';
        const hid = !salient.has(pi);
        return `<tr data-prop="${pi}" style="cursor:pointer${hid ? ';display:none' : ''}"${hid ? ' class="implied"' : ''}><td>${esc(p.name)}${hid ? ' <span class="small muted">(follows)</span>' : ''}</td><td class="c">${st}</td><td class="small muted">${(p.closedUnder ? esc(Z.R[Z.ridx.get(p.closedUnder)].short) : '—')}</td></tr>`;
      }).join('')}</table>` : '<p class="muted">No property recorded.</p>');
    })()}
    </section>

    ${panel('literature')}
    <div class="row h2row"><h2 class="grow">Literature</h2>${refsOf.length || directResults.length ? bibButton('bib-stmt', 'BibTeX (literature + cited in results)') : ''}</div>
    ${refsOf.length ? `<ul class="reflist">${refsOf.map((rf) => `<li><span class="role">${esc(rf.role || '')}</span>${refFull(rf.ref)}${rf.loc ? ` — ${esc(rf.loc)}` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">No reference recorded.</p>'}
    </section>

    ${qs.length ? `${panel('questions')}<p class="small muted">Open questions from the literature that mention ${L(i)}.</p>${qs.map(questionRow).join('')}</section>` : ''}

    ${panel('results')}
    <p class="small muted">Results of the database that mention ${L(i)} (the others are derived from them).${hiddenResults
      ? ` ${hiddenResults} more concern other frameworks (<button class="linkish" id="mode-off">show all frameworks</button>).` : ''}</p>
    ${resultGroups(directResults)}
    </section>
  `;
  // reduction picker + relations
  const drawRels = () => {
    $('#rpick').replaceChildren(reductionPicker(() => drawRels()));
    $('#rels').innerHTML = relations(i, rIdx());
  };
  drawRels();
  $('#bib-stmt')?.addEventListener('click', () => downloadBib(sortKeys([...refsOf.map((x) => x.ref), ...citedKeys(directResults)]), s.id));
  m.onclick = (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { // switch tab without re-rendering; the URL keeps it for links and reloads
      const t = tb.dataset.tab;
      m.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === tb));
      m.querySelectorAll('[data-panel]').forEach((x) => { x.hidden = x.dataset.panel !== t; });
      history.replaceState(null, '', `#/s/${s.id}${t === 'overview' ? '' : `?tab=${t}`}`);
      return;
    }
    const b = e.target.closest('[data-sel]');
    if (b) { toggleSel(b.dataset.sel); b.classList.toggle('on'); b.textContent = isSel(b.dataset.sel) ? '✓ Selected' : '+ Select'; return; }
    const pc = e.target.closest('[data-pair]');
    if (pc) { const [a, b2, rr] = pc.dataset.pair.split(',').map(Number); pairPanel(a, b2, rr); return; }
    if (e.target.id === 'props-all') {
      const on = e.target.dataset.on !== '1';
      e.target.dataset.on = on ? '1' : '';
      m.querySelectorAll('#props tr.implied').forEach((tr) => { tr.style.display = on ? '' : 'none'; });
      e.target.textContent = on ? 'Show fewer' : `Show ${m.querySelectorAll('#props tr.implied').length} more`;
      return;
    }
    const pr = e.target.closest('[data-prop]');
    if (pr) propertyPanel(+pr.dataset.prop, i);
  };
}

// ---- statement context ----------------------------------------------------------
// Prose with $math$ and [@key] citations.
const richCite = (text) => String(text ?? '').split(/(\[@[^\]]+\])/g).map((p) => {
  const m = p.match(/^\[@([^\]]+)\]$/);
  return m ? `<a class="cite" href="#/refs/${m[1]}" title="${esc(Z.raw.references[m[1]]?.title || '')}">[${esc(refShort(m[1]))}]</a>` : rich(p);
}).join('');
// text of a caution: [@ref] citations and [[id]] links to statements
const richLinks = (text) => String(text ?? '').split(/(\[\[[^\]]+\]\])/g).map((p) => {
  const m = p.match(/^\[\[([^\]]+)\]\]$/);
  return m ? (idx(m[1]) !== undefined ? sLink(idx(m[1])) : esc(m[1])) : richCite(p);
}).join('');
// the caution of a statement as plain text (titles, tooltips)
const cautionText = (s) => String(s.caution || '').replace(/\s*\(\[\[[^\]]+\]\]\)/g, '').replace(/\[\[([^\]]+)\]\]/g, (_, k) => (idx(k) !== undefined ? plain(S(idx(k)).label) : k))
  .replace(/\s*\[@[^\]]+\]/g, '').replace(/\$([^$]+)\$/g, (_, x) => plain(x));
const cautionBadge = (s) => (s.caution ? `<span class="badge caution" title="${esc(cautionText(s))}">⚠ name</span>` : '');
const BIG5 = ['rca0', 'wwkl', 'wkl', 'aca', 'atr', 'pi11ca'];
const listL = (js, r) => js.map((j) => sLink(j, r)).join(', ');
// A computed summary: literature, position among the Big Five, and counts at RCA₀ and W.
function glance(i, directResults) {
  const s = S(i), out = [];
  const byRole = (role) => (s.refs || []).filter((x) => x.role === role).map((x) => `<a href="#/refs/${x.ref}">${esc(refShort(x.ref))}</a>`);
  const origin = byRole('origin'), rm = byRole('rm');
  if (origin.length) out.push(`<b>Introduced</b> in ${origin.join(', ')}${rm.length ? `; first analysed in reverse mathematics or computability theory in ${rm.join(', ')}` : ''}.`);
  else if (rm.length) out.push(`<b>Analysed</b> in ${rm.join(', ')}.`);
  const papers = [...new Set(directResults.flatMap(([res]) => (res.refs || []).map((x) => x.ref)))].filter((k) => Z.raw.references[k]);
  if (papers.length) {
    const ys = papers.map((k) => Z.raw.references[k].year).filter(Boolean).sort();
    out.push(`<b>Literature:</b> ${directResults.length} result${directResults.length === 1 ? '' : 's'} of the database mention it, from ${papers.length} paper${papers.length === 1 ? '' : 's'}${ys.length ? ` (${ys[0]}${ys.at(-1) !== ys[0] ? `–${ys.at(-1)}` : ''})` : ''}.`);
  }
  // the framework lines are shown where the statement has been studied (all of them if nowhere yet)
  const studiedAny = !!s.studied && Object.keys(s.studied).length > 0;
  const shown = (f) => !studiedAny || !!s.studied[f];
  const r0 = Z.ridx.get('rca0');
  if (r0 !== undefined && rInMode(r0) && (MODE() || shown('rca0')) && Z.inDomain(r0, i) && !(s.base || []).includes('rca0')) {
    const b5 = BIG5.map(idx).filter((j) => j !== undefined && j !== i);
    const eq = b5.filter((j) => Z.status(r0, i, j) === 'implies' && Z.status(r0, j, i) === 'implies');
    if (BIG5.includes(s.id)) out.push('<b>Big Five:</b> it is one of them.');
    else if (eq.length) out.push(`<b>Big Five:</b> equivalent to ${listL(eq, r0)} over RCA₀.`);
    else {
      const above = b5.find((j) => Z.status(r0, j, i) === 'implies');
      const below = [...b5].reverse().find((j) => Z.status(r0, i, j) === 'implies' && !(S(j).base || []).includes('rca0'));
      const notAbove = above !== undefined && Z.status(r0, i, above) === 'separated';
      const parts = [];
      if (above !== undefined) parts.push(notAbove ? `implied by ${sLink(above, r0)}, but does not imply it` : `the weakest of them known to imply it is ${sLink(above, r0)}`);
      if (below !== undefined) parts.push(`it implies ${sLink(below, r0)}`);
      else if (Z.status(r0, idx('rca0'), i) === 'separated') parts.push('it is not provable in RCA₀');
      if (parts.length) out.push(`<b>Big Five:</b> ${parts.join('; ')}.`);
    }
  }
  const counts = (r) => {
    let imp = 0, by = 0, open = 0;
    const eq = [], minorEq = [];
    for (let j = 0; j < Z.n; j++) {
      if (j === i || S(j).conjunction || !Z.inDomain(r, j) || !inMode(j)) continue;
      const ab = Z.status(r, i, j), ba = Z.status(r, j, i);
      if (ab === 'implies' && ba === 'implies') { (S(j).minor ? minorEq : eq).push(j); continue; }
      if (S(j).minor) continue; // minor statements are not counted
      if (ab === 'implies') imp++;
      if (ba === 'implies') by++;
      if (ab === 'open' || ba === 'open') open++;
    }
    const R = Z.R[r];
    return `<b>Over ${esc(R.short)}:</b> ${eq.length ? `equivalent to ${listL(eq.slice(0, 6), r)}${eq.length > 6 ? ` and ${eq.length - 6} more` : ''}; ` : ''}implies ${imp} and is implied by ${by} of the zoo's statements; ${open} comparison${open === 1 ? '' : 's'} open.`
      + (minorEq.length ? `<div class="minor-eq"><b>Equivalent statements</b> (minor, not in the catalogue by default): ${minorEq.map((j) => sLink(j, r)).join(' · ')}</div>` : '');
  };
  const frames = MODE() ? MODE().reductions.map((rid) => [rid, null]) : [['rca0', 'rca0'], ['rca0star', 'rca0star'], ['w', 'weihrauch']];
  for (const [rid, f] of frames) {
    const r = Z.ridx.get(rid);
    if (r === undefined || !Z.inDomain(r, i) || (s.base || []).includes(rid)) continue;
    if (!f || (rid === 'rca0star' ? s.studied?.rca0star : shown(f))) out.push(counts(r));
  }
  return out.length ? `<ul class="glance">${out.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
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
    if (j === i || !Z.inDomain(r, j) || !inMode(j)) continue;
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
let abstractsP;
const loadAbstracts = () => (abstractsP ||= fetch('data/abstracts.json').then((r) => r.json()));

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
    const cls = classHtml(res.class);
    // "RCA₀ + X", or just "RCA₀" when X is RCA₀ itself (or another base statement over RCA₀)
    const sys = (id) => (S(idx(id)).base || []).includes('rca0') ? sLink(idx(id), Z.ridx.get('rca0')) : `RCA₀ + ${sLink(idx(id), Z.ridx.get('rca0'))}`;
    return `${sys(res.statement)} is ${res.value === false ? '<b class="no">not</b> ' : ''}<b>${cls}</b>-conservative over ${sys(res.base)}`;
  }
  const arrow = { implication: '<span class="yes">⇒</span>', equivalence: '<span class="yes">⇔</span>', separation: '<span class="no">⇏</span>' }[res.type];
  return `<span class="res-stmt">${sLink(idx(res.from), r0)} ${arrow} ${sLink(idx(res.to), r0)}</span> <span class="muted small">over ${over}</span>`;
}
// results of one statement, by kind: implications and equivalences, separations,
// properties, conservation (one table each, in the same tab)
const RESULT_GROUPS = [
  ['Implications and equivalences', (r) => r.type === 'implication' || r.type === 'equivalence'],
  ['Separations', (r) => r.type === 'separation'],
  ['Computability-theoretic properties', (r) => r.type === 'property'],
  ['Conservation', (r) => r.type === 'conservation'],
];
function resultGroups(list) {
  if (!list.length) return '<p class="muted">None.</p>';
  return RESULT_GROUPS.map(([title, test]) => {
    const part = list.filter(([res]) => test(res));
    return part.length ? `<h3 class="res-group">${title} <span class="count">${part.length}</span></h3>${resultsTable(part)}` : '';
  }).join('');
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
    Z.S.forEach((s, i) => { if ((s.tags || []).includes(t) && !s.conjunction && !s.minor && inMode(i) && !isSel(s.id)) state.sel.push(s.id); });
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
  // property columns: those listed on the page of some selected statement (its
  // extremal known properties and open ones, Z.salientProps)
  const salient = new Set(ids.flatMap((i) => Z.salientProps(i)));
  const pcols = Z.raw.properties.map((p, pi) => [p, pi]).filter(([, pi]) => salient.has(pi));
  m.innerHTML = `
    <h1>Compare</h1>
    <p class="muted">Row <i>A</i>, column <i>B</i>: does <i>A</i> imply <i>B</i>? Each cell is the lattice of reductions below,
      coloured <span class="yes">implies</span> / <span class="no">does not imply</span> / <span class="open">open</span> / <span class="na">not applicable</span>.</p>
    <div class="row" style="align-items:flex-start;gap:32px">
      <div style="overflow-x:auto"><table class="matrix" id="mx">
        <tr><th></th>${ids.map((b) => `<th class="col">${L(b)}</th>`).join('')}</tr>
        ${ids.map((a) => `<tr><th style="text-align:right">${L(a)}</th>${ids.map((b) => a === b ? '<td class="diag"></td>'
          : `<td><span class="cell" data-pair="${a},${b}" title="${esc(plain(S(a).label))} ⇒ ${esc(plain(S(b).label))}: ${Z.R.map((R, rr) => [R, rr]).filter(([, rr]) => rInMode(rr)).map(([R, rr]) => `${R.short} ${sym(Z.status(rr, a, b))}`).join(', ')}">${latticeSvg({ small: true, status: (rr) => Z.status(rr, a, b) })}</span></td>`).join('')}</tr>`).join('')}
      </table></div>
      <div class="card"><h3>Key</h3>${latticeSvg({ pick: false })}<p class="small muted" style="max-width:${g.width + 10}px">Finer reductions are higher.</p></div>
    </div>

    ${MODE() && !MODE().properties ? '' : `<h2>Properties</h2>
    <p class="muted small">✓ has · ✗ fails · ? unknown. Columns where every selected statement agrees are highlighted. Click a cell for the proof.</p>
    <div style="overflow-x:auto"><table class="grid pmatrix"><tr><th></th>${pcols.map(([p, pi]) => {
      const vals = ids.filter((i) => Z.propIn(pi, i)).map((i) => Z.prop(pi, i)?.v);
      const common = vals.length && vals.every((x) => x === true) ? 'yes' : vals.length && vals.every((x) => x === false) ? 'no' : '';
      return `<th class="c" title="${esc(p.description)}">${esc(p.name)}${common ? ` <span class="${common}">●</span>` : ''}</th>`;
    }).join('')}</tr>
    ${ids.map((i) => `<tr><td>${sLink(i)}</td>${pcols.map(([p, pi]) => {
      if (!Z.propIn(pi, i)) return '<td class="c muted" title="Not formulated as a problem">–</td>';
      const e = Z.prop(pi, i);
      return `<td class="c ${e ? (e.v ? 'yes' : 'no') : 'open'}" data-prop="${pi},${i}">${e ? (e.v ? '✓' : '✗') : '?'}</td>`;
    }).join('')}</tr>`).join('')}</table></div>`}
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
      <select id="f-r"><option value="">${MODE() ? `All reductions of the mode` : 'All reductions'}</option>${Z.R.filter((_, r) => rInMode(r)).map((R) => `<option value="${R.id}">${esc(R.name)}</option>`).join('')}</select>
      <select id="f-prov"><option value="">Any provenance</option><option value="lit">From the literature</option>
        <option value="folk">Folklore</option><option value="ai">AI-derived</option><option value="aiarg">Argument by AI</option>
        <option value="endorsed">Endorsed by a reader</option><option value="endorsed2">Endorsed by several readers</option></select>
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
      || (prov === 'aiarg' && res.justification?.by === 'ai')
      || (prov === 'endorsed' && C.endorsers(res._key).length >= 1)
      || (prov === 'endorsed2' && C.endorsers(res._key).length >= 2);
    const list = Z.raw.results.map((res, ri) => [res, ri]).filter(([res]) => resInMode(res) &&
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
  const uses = (k) => Z.raw.results.map((res, ri) => [res, ri]).filter(([res]) => resInMode(res) && (res.refs || []).some((r) => r.ref === k));
  const intro = (k) => Z.S.map((s, i) => [s, i]).filter(([s, i]) => inMode(i) && (s.refs || []).some((r) => r.ref === k));
  if (key) {
    const r = Z.raw.references[key];
    if (!r) { m.innerHTML = '<h1>Unknown reference</h1>'; return; }
    const st = intro(key);
    m.innerHTML = `<p><a href="#/refs">← Literature</a></p>
      <h1>${rich(r.title)}</h1><p>${esc(r.authors.join(', '))} — ${esc(r.venue)}, ${r.year}
      ${r.doi ? ` · <a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener">doi:${esc(r.doi)}</a>` : ''}
      ${r.arxiv ? ` · <a href="https://arxiv.org/abs/${esc(r.arxiv)}" target="_blank" rel="noopener">arXiv:${esc(r.arxiv)}</a>` : ''}
      · ${readBadge(r)}${C.live ? ` · <a href="#" data-feedback="comment|reference|${key}">Comment or report an error</a>` : ''}</p>
      ${r.hasAbstract ? '<h2>Abstract</h2><div class="abstract" id="abstract"><span class="muted small">Loading…</span></div>' : ''}
      <details class="bib"><summary>BibTeX</summary><pre id="bib-one">${esc(bibtex(Z.raw.references, [key]))}</pre>
        <div class="row">${bibButton('bib-ref', 'Download')}<button class="btn small" id="bib-copy">Copy</button></div></details>
      ${st.length ? `<h2>Statements</h2><div class="rel-list">${st.map(([s, i]) => {
        const role = s.refs.find((x) => x.ref === key).role;
        return `<a class="chip" href="#/s/${s.id}" style="color:var(--ink)">${L(i)} <span class="muted">${esc(role || '')}</span></a>`;
      }).join('')}</div>` : ''}
      ${(() => {
        const asked = (Z.raw.questions || []).filter((q) => qInMode(q) && q.asked.some((a) => a.ref === key));
        const answered = (Z.raw.questions || []).filter((q) => qInMode(q) && qInfo(q).status !== 'open' && qSolvers(q).some((a) => a.ref === key));
        return (asked.length ? `<h2>Questions asked</h2>${asked.map(questionRow).join('')}` : '')
          + (answered.length ? `<h2>Questions answered</h2>${answered.map(questionRow).join('')}` : '');
      })()}
      <h2>Results</h2>${(() => {
        const other = Z.raw.results.filter((res) => !resInMode(res) && (res.refs || []).some((x) => x.ref === key)).length;
        return other ? `<p class="small muted">${other} more result${other === 1 ? '' : 's'} of this paper concern other frameworks (<button class="linkish" id="mode-off">show all frameworks</button>).</p>` : '';
      })()}${resultsTable(uses(key))}`;
    $('#bib-ref').addEventListener('click', () => downloadBib([key], key));
    if (r.hasAbstract) loadAbstracts().then((a) => {
      const el = $('#abstract');
      if (!el) return;
      const x = a[key];
      const src = x?.source === 'arxiv' ? `<a href="https://arxiv.org/abs/${esc(x.arxiv || r.arxiv)}" target="_blank" rel="noopener">arXiv</a>`
        : x?.source === 'pdf' ? 'the paper itself (extracted from the PDF; formulas were reconstructed automatically from the typesetting)'
        : 'OpenAlex — inline formulas are sometimes missing from abstracts taken from there';
      el.innerHTML = x ? `${rich(x.text)}<div class="small muted" style="margin-top:6px">Source: ${src}</div>` : '<span class="muted small">Not available.</span>';
    }).catch(() => { const el = $('#abstract'); if (el) el.innerHTML = '<span class="muted small">Could not load the abstract.</span>'; });
    $('#bib-copy').addEventListener('click', (e) => navigator.clipboard?.writeText($('#bib-one').textContent).then(() => { e.target.textContent = 'Copied'; }));
    return;
  }
  const nUse = new Map();
  Z.raw.results.forEach((res) => resInMode(res) && (res.refs || []).forEach((r) => nUse.set(r.ref, (nUse.get(r.ref) || 0) + 1)));
  m.innerHTML = `<h1>Literature</h1>
    <p class="muted">${refs.length} papers. Papers with extracted results feed the zoo; the others come from Brattka's Bibliography on Weihrauch Complexity and sweeps of zbMATH Open and arXiv, and are waiting for their results to be entered.</p>
    <div class="filters"><input class="text" id="rq" placeholder="Author, title, year…" style="width:280px">
      <select id="rsrc"><option value="results">${MODE() ? `With results in ${esc(MODE().name)}` : 'With results in the zoo'}</option><option value="">All papers</option>
        <option value="weihrauch-bibliography">Weihrauch bibliography only</option><option value="arxiv">arXiv sweep only</option><option value="zbmath">zbMATH sweep only</option></select>
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
function viewAbout(params) {
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
    <table class="grid">${Z.raw.properties.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${rich(p.description)}<div class="small muted">${p.closedUnder ? `Preserved under ${esc(Z.R[Z.ridx.get(p.closedUnder)].name)}` : 'Preserved by no reduction'}${p.domain === 'problems' ? '; applies to statements formulated as problems' : ''}.</div></td></tr>`).join('')}</table>
    <h2 id="classes">Formula classes</h2>
    <p class="small muted">Used by conservation results: <i>T</i> is Γ-conservative over <i>S</i> when every Γ sentence provable in <i>T</i> is provable in <i>S</i>.
      A conservation result for a class also applies to the classes it contains.</p>
    <table class="grid">${(Z.raw.classes || []).map((c) => {
      const members = (Z.classMembers?.[c.id] || []).filter((d) => d !== c.id);
      return `<tr id="class-${c.id}"><td style="white-space:nowrap"><b>${tex(c.notation)}</b>${c.aliases ? `<div class="small muted">formerly ${c.aliases.map(tex).join(', ')}</div>` : ''}</td>
        <td>${c.name ? `<b>${esc(c.name)}.</b> ` : ''}${rich(c.definition)}
        ${members.length ? `<div class="small muted">Contains: ${members.map((d) => tex(classOf(d)?.notation || d)).join(', ')}</div>` : ''}</td></tr>`;
    }).join('')}</table>
    <h2>Inference rules</h2>
    <table class="grid">${Object.entries(RULES).map(([k, v]) => `<tr><td><code>${k}</code></td><td>${esc(v)}</td></tr>`).join('')}</table>
    <h2 id="endorsements">Endorsements</h2>
    <p>Researchers signed in with <a href="https://orcid.org" target="_blank" rel="noopener">ORCID</a> on the live instance can
      <b>endorse</b> a result, stating: “${ENDORSE_TEXT}” A result endorsed by one person carries a
      <span class="endorse e-one static">✓</span> green check, by several a <span class="endorse e-several static">✓<span>2</span></span> bronze one with their number;
      click a check to see who endorsed it. Endorsers are listed on their profile page with their name and ORCID iD, and can withdraw an
      endorsement at any time. Signed-in readers can also report an error or comment on a result, a statement or a paper: messages go to the
      maintainer and are not published. Endorsements are periodically committed to the database
      (<code>data/endorsements.yaml</code>) with the rest of the data.</p>
    ${C.live ? '' : liveNote()}
    <h2>Frameworks</h2>
    <p>The zoo gathers several frameworks. The switch in the header (or the chips on the front page) restricts the viewer to one of them:
      the catalogue, the diagrams, the results, the literature and the questions then show only the statements studied there, the reductions
      of the framework and the results stated with them. The inference itself always uses every result. A link with <code>?mode=…</code>
      opens the viewer in a framework.</p>
    <table class="grid"><tr><th>Framework</th><th>Reductions</th><th>Also shown</th></tr>${(Z.raw.modes || []).map((x) => `<tr><td><a href="#/?mode=${x.id}">${esc(x.name)}</a><div class="small muted">${esc(x.description || '')}</div></td>
      <td>${x.reductions.map((r) => esc(Z.R[Z.ridx.get(r)].name)).join(', ')}</td>
      <td class="small">${[x.properties && 'computability-theoretic properties', x.conservation && 'conservation results'].filter(Boolean).join(', ') || '—'}</td></tr>`).join('')}</table>
    <p class="small muted">A statement belongs to a framework when a cited result about it is stated there, or when it is the base system of one of its reductions.</p>
    <h2>Review</h2>
    <p>The <a href="#/review">review page</a> lists proposals that are not part of the database: results and missing statements found
      by an AI reader of the full texts that did not pass its automatic checks, and candidates of the regular consolidation (theorems
      that may settle open relations, numbered questions, passages that may answer a recorded question, papers to add). Signed-in
      researchers validate or invalidate each one and comment; votes and comments are public. A proposed result validated by someone
      (and invalidated by no one) is shown in the database at once, marked “validated on the review page”, until the maintainer commits
      it; disputes and the other kinds are settled by the maintainer.</p>
    <h2>Contributing</h2>
    <p>Data lives in <code>data/*.yaml</code> (statements, results, references, properties, reductions, tags). Run <code>npm run check</code> to validate and detect contradictions, and <code>npm run build</code> to regenerate the viewer data. See <code>docs/DESIGN.md</code>.</p>
    <p class="small muted">Built ${esc(Z.raw.builtAt || '')}.</p>`;
}


// ============================================================================
// endorsements and comments (community.js, docs/ENDORSEMENTS.md)
// ============================================================================
// The mark of a result: green check when one person endorsed it, bronze with the
// count when several did; on the live instance an empty outline invites to
// endorse or report. Clicking opens the result panel.
function endorseMark(ri) {
  if (Z.raw.results[ri]._review) return '';
  const key = Z.raw.results[ri]._key;
  const ends = C.endorsers(key);
  if (!ends.length && !C.live) return '';
  const who = ends.map((e) => C.name(e.orcid)).join(', ');
  const title = ends.length
    ? `Endorsed by ${who}: read the proof and believe it is correct. Click for details.`
    : 'Not endorsed yet. Click to endorse, report an error or comment.';
  const cls = ends.length >= 2 ? 'e-several' : ends.length ? 'e-one' : 'e-none';
  return `<button class="endorse ${cls}" data-result="${ri}" title="${esc(title)}" aria-label="${esc(title)}">✓${ends.length >= 2 ? `<span>${ends.length}</span>` : ''}</button>`;
}
const personLink = (orcid) => `<a href="#/u/${orcid}">${esc(C.name(orcid))}</a>`;
const ENDORSE_TEXT = 'I have read the proof of this result and believe it is correct.';
const liveNote = () => `<p class="small muted">Endorsements and comments are collected on the live instance,
  <a href="https://rmzoo.ludovicpatey.com/" target="_blank" rel="noopener">rmzoo.ludovicpatey.com</a>, by researchers signed in with ORCID.</p>`;
const signInPrompt = (what) => `<p><a class="btn primary" href="${C.loginUrl()}">Sign in with ORCID</a> <span class="small muted">to ${what}.</span></p>`;

function resultPanel(ri) {
  const res = Z.raw.results[ri];
  const key = res._key;
  const ends = C.endorsers(key);
  const mine = C.endorsedByMe(key);
  openDrawer(`<h2 style="margin-top:0">Result</h2>
    <p>${resultFact(res)}</p>
    ${resultCite(ri)}
    <h3>Endorsements</h3>
    ${ends.length ? `<ul class="endorsers">${ends.map((e) => `<li>${personLink(e.orcid)} <span class="small muted">${esc(e.date)}</span></li>`).join('')}</ul>`
      : '<p class="muted small">No one has endorsed this result yet.</p>'}
    ${!C.live ? liveNote()
      : !C.user ? signInPrompt('endorse this result, report an error or comment')
      : `<div class="endorse-box">${mine
          ? `<p class="small">You endorsed this result.</p><button class="btn" data-endorse="${ri}" data-on="0">Withdraw my endorsement</button>`
          : `<button class="btn primary" data-endorse="${ri}" data-on="1">Endorse</button>
             <p class="small muted">By endorsing, you state: “${ENDORSE_TEXT}” Your name and ORCID iD are shown with the result and on your profile.</p>`}
        </div>
        <div class="row" style="margin-top:12px"><button class="btn" data-feedback="error|result|${esc(key)}">Report an error</button>
          <button class="btn" data-feedback="comment|result|${esc(key)}">Comment</button></div>`}
    <div id="endorse-msg" class="small"></div>`);
}

const TARGET_NAME = { result: 'this result', statement: 'this statement', reference: 'this paper', question: 'this question', general: 'the zoo' };
function feedbackPanel(kind, type, id) {
  if (!C.user) { openDrawer(`<h2 style="margin-top:0">${kind === 'error' ? 'Report an error' : 'Comment'}</h2>${signInPrompt('send a message')}`); return; }
  const about = type === 'result' ? `<p>${resultFact(Z.raw.results[resultIdx.get(id)])}</p>`
    : type === 'statement' ? `<p>${L(idx(id))} — ${esc(S(idx(id)).name)}</p>`
    : type === 'reference' ? `<p>${refFull(id)}</p>` : '';
  openDrawer(`<h2 style="margin-top:0">${kind === 'error' ? 'Report an error' : 'Comment'} on ${TARGET_NAME[type]}</h2>
    ${about}
    <form id="fb-form" class="fb-form">
      <div class="row"><label class="toggle"><input type="radio" name="kind" value="error" ${kind === 'error' ? 'checked' : ''}> Error</label>
        <label class="toggle"><input type="radio" name="kind" value="comment" ${kind !== 'error' ? 'checked' : ''}> Comment</label></div>
      <textarea id="fb-text" rows="8" maxlength="10000" required placeholder="${kind === 'error'
        ? 'What is wrong (statement, direction, reduction, citation, theorem number…), and the correct version with its source if you know it.'
        : 'Your comment.'}"></textarea>
      <p class="small muted">Sent to the maintainer of the zoo with your name and ORCID iD (${esc(C.user.name)}); not published.</p>
      <div class="row"><button class="btn primary" type="submit">Send</button><span id="fb-msg" class="small"></span></div>
    </form>`);
  $('#fb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await C.sendFeedback(new FormData(e.target).get('kind'), { type, id }, $('#fb-text').value);
      e.target.outerHTML = '<div class="verdict yes">Thank you: your message was recorded.</div>';
    } catch (err) {
      $('#fb-msg').textContent = err.message;
      btn.disabled = false;
    }
  });
}
document.addEventListener('click', async (e) => {
  const r = e.target.closest('[data-result]');
  if (r) { e.preventDefault(); e.stopPropagation(); resultPanel(+r.dataset.result); return; }
  const f = e.target.closest('[data-feedback]');
  if (f) { e.preventDefault(); const [kind, type, ...id] = f.dataset.feedback.split('|'); feedbackPanel(kind, type, id.join('|')); return; }
  const en = e.target.closest('[data-endorse]');
  if (en) {
    const ri = +en.dataset.endorse;
    en.disabled = true;
    try {
      await C.setEndorsement(Z.raw.results[ri]._key, en.dataset.on === '1');
      resultPanel(ri);
      refreshMarks();
    } catch (err) { $('#endorse-msg').textContent = err.message; en.disabled = false; }
  }
}, true);
// update the marks on the page after an endorsement (without re-rendering it)
function refreshMarks() {
  $$('#main .endorse[data-result]').forEach((b) => { b.outerHTML = endorseMark(+b.dataset.result); });
}
function renderAccount() {
  const a = $('#account');
  if (!C.live) { a.innerHTML = ''; return; }
  a.innerHTML = C.user
    ? `<a class="btn small" href="#/u/${C.user.orcid}" title="Your profile and endorsements"><span class="orcid-dot"></span>${esc(C.user.name)}</a>`
    : `<a class="btn small" id="signin" href="${C.loginUrl()}"><span class="orcid-dot"></span>Sign in</a>`;
}
// the sign-in link returns to the page being viewed
window.addEventListener('hashchange', () => { const s = $('#signin'); if (s) s.href = C.loginUrl(); });

function viewProfile(orcid) {
  const m = main();
  m.className = '';
  if (orcid === 'me') {
    if (C.user) { location.replace(`#/u/${C.user.orcid}`); return; }
    m.innerHTML = `<h1>Your profile</h1>${C.live ? signInPrompt('see your endorsements') : liveNote()}`;
    return;
  }
  const own = C.user?.orcid === orcid;
  const mine = (C.byPerson.get(orcid) || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const list = mine.map((e) => [Z.raw.results[resultIdx.get(e.result)], resultIdx.get(e.result), e.date]).filter(([res]) => res);
  const gone = mine.length - list.length;
  m.innerHTML = `<h1>${esc(own ? C.user.name : C.name(orcid))}</h1>
    <p><a href="https://orcid.org/${esc(orcid)}" target="_blank" rel="noopener"><span class="orcid-dot"></span>orcid.org/${esc(orcid)}</a>
      ${own ? ` · <a href="${C.logoutUrl()}">Sign out</a>` : ''}</p>
    <h2>Endorsed results <span class="muted small">${list.length}</span></h2>
    <p class="small muted">Results whose proof ${own ? 'you have' : 'this researcher has'} read and believe${own ? '' : 's'} correct.${own ? ' Open a result to withdraw your endorsement.' : ''}</p>
    ${lazy(list, ([res, ri, date]) => `<tr><td>${resultFact(res)}</td><td>${resultCite(ri)}</td><td class="small muted">${esc(date)}</td></tr>`,
      { size: 50, wrap: 'table', head: '<thead><tr><th>Result</th><th>Source</th><th>Endorsed</th></tr></thead>', noun: 'results',
        empty: `<p class="muted">${own ? 'You have not endorsed any result yet: open a result (its ✓ mark) to endorse it.' : 'No endorsement.'}</p>` })}
    ${gone ? `<p class="small muted">${gone} endorsed result${gone === 1 ? ' has' : 's have'} since been changed in the database.</p>` : ''}`;
}

// ============================================================================
// review page (docs/REVIEW.md, site/js/review.js): proposals not in the database
// ============================================================================
// The queue (site/data/review.json) is loaded on demand: by the review page, and
// at boot to add the validated results to the database shown (live, before the
// maintainer commits them).
let Q = null;
const loadQueue = () => (Q ||= fetch('data/review.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [] }))
  .then((j) => { j.byId = new Map(j.items.map((it) => [it.id, it])); return j; }).catch(() => ({ items: [], byId: new Map() })));

// The validated `result` items joined to the database: the zoo is rebuilt with them,
// leaving out any that would contradict it (the maintainer settles those).
let RAW0 = null, merged = [];
async function mergeValidated() {
  // nothing to load when no vote can validate a result (live: the server's votes;
  // static: the count of committed validations, from the build)
  const any = C.byItem ? [...C.byItem.values()].some((x) => x.votes.some((v) => v.verdict === 'valid')) : Z.raw.review?.validated > 0;
  if (!any && !merged.length) return false;
  const q = await loadQueue();
  const known = (r) => [r.from, r.to, r.statement, r.base].filter(Boolean).every((id) => idx(id) !== undefined)
    && (!r.property || Z.pidx.has(r.property)) && [].concat(r.over || []).every((o) => Z.ridx.has(o));
  const want = q.items.filter((it) => it.kind === 'result' && reviewStatus(C.votes(it)) === 'validated')
    .map((it) => ({ ...itemResult(it), _review: it.id, _date: it.date, _key: `review|${it.id}` }))
    .filter((r) => known(r) && !(RAW0 || Z.raw).results.some((x) => x._key === resultKey(r))); // already in the database
  const ids = want.map((r) => r._review).join(',');
  if (ids === merged.map((r) => r._review).join(',')) return false;
  RAW0 ||= Z.raw;
  const build = (extra) => buildZoo({ ...RAW0, results: [...RAW0.results, ...extra] });
  const base = RAW0.contradictions ?? (RAW0.contradictions = Z.contradictions.length);
  let z = build(want), keep = want;
  if (z.contradictions.length > base) { // add them one by one
    keep = [];
    for (const r of want) { const t = build([...keep, r]); if (t.contradictions.length <= base) { keep.push(r); z = t; } }
    z = build(keep);
  }
  Z = z;
  merged = keep;
  resultIdx.clear();
  Z.raw.results.forEach((r, ri) => resultIdx.set(r._key, ri));
  return true;
}

const ORIGINS = { stated: 'stated in the paper', cited: 'attributed by the paper to another work', 'special-case': 'special case of a result of the paper', deduced: 'deduced from the paper (not stated)' };
const STATUS_CLS = { open: '', validated: 'yes', invalidated: 'no', disputed: 'warn' };
// a proposed result: rendered like a result of the database when its ids are known
function reviewFact(r) {
  const ok = [r.from, r.to, r.statement, r.base].filter(Boolean).every((id) => idx(id) !== undefined)
    && (!r.property || Z.pidx.has(r.property)) && [].concat(r.over || []).every((o) => Z.ridx.has(o)) && (r.type !== 'conservation' || classOf(r.class));
  if (ok) return resultFact(r);
  const id = (x) => `<code>${esc(x)}</code>`;
  const arrow = { implication: '⇒', equivalence: '⇔', separation: '⇏' }[r.type];
  return r.type === 'property' ? `${id(r.statement)} ${r.value ? 'has' : 'fails'} ${id(r.property)}`
    : r.type === 'conservation' ? `${id(r.statement)} is ${r.value === false ? 'not ' : ''}${id(r.class)}-conservative over ${id(r.base)}`
    : `${id(r.from)} ${arrow} ${id(r.to)} <span class="muted small">over ${esc([].concat(r.over).join(', '))}</span>`;
}
const passage = (t) => `<blockquote class="rv-quote">${esc(t)}</blockquote>`;
function reviewBody(it) {
  const S0 = it.statement;
  switch (it.kind) {
    case 'result': return `<p class="rv-fact">${reviewFact(it.result)}</p>
      <p class="small">${it.ref ? refLink({ ref: it.ref, loc: it.loc }) : ''} · ${esc(ORIGINS[it.origin] || it.origin)}${it.citedFrom ? ` (${esc(it.citedFrom)})` : ''}
        ${it.paperNotation ? ` · paper's notation: ${esc(it.paperNotation)}` : ''}${it.part ? ` · part ${esc(it.part)} of the text` : ''}</p>
      ${it.quote ? passage(it.quote) : ''}
      ${it.argument ? `<p class="small"><b>Argument.</b> ${esc(it.argument)}</p>` : ''}
      ${it.concerns ? `<p class="small"><b>To check.</b> ${esc(it.concerns)}</p>` : ''}
      <p class="small muted">AI reader: confidence ${esc(it.confidence)}${it.verifier ? `; verifier: ${esc(it.verifier.verdict)} (${esc(it.verifier.reason)})` : ''}.
        Not published because: ${esc((it.reasons || []).join('; '))}.</p>`;
    case 'statement': return `<p class="rv-fact"><b>${esc(S0.notation)}</b> — ${esc(S0.name)}</p>
      <p class="small">${it.ref ? refLink({ ref: it.ref, loc: S0.loc }) : ''}</p>
      <p><b>Definition.</b> ${esc(S0.definition)}</p>
      ${S0.facts ? `<p class="small"><b>Facts in the paper.</b> ${esc(S0.facts)}</p>` : ''}`;
    case 'lead': return `<p class="small">${refLink({ ref: it.ref, loc: it.loc })}${it.over ? ` · about ${esc(it.over)}` : ''}</p>
      ${passage(it.text)}
      <p class="small muted">Open in the database between the statements it names: ${esc((it.open || []).join(', '))}.</p>`;
    case 'question': return `<p class="small">${refLink({ ref: it.ref, loc: it.loc })}${it.statements?.length ? ` · names ${esc(it.statements.join(', '))}` : ''}</p>${passage(it.text)}`;
    case 'answer': {
      const q = (Z.raw.questions || []).find((x) => x.id === it.question);
      return `<p>Does ${refLink({ ref: it.ref })} answer <a href="#/questions/${esc(it.question)}">${q ? rich(q.title || q.text || it.question) : esc(it.question)}</a>?</p>${passage(it.text)}`;
    }
    case 'paper': {
      const p = it.paper;
      return `<p class="rv-fact"><i>${esc(p.title)}</i></p><p class="small">${esc((p.authors || []).join(', '))}. ${esc(p.venue || '')}, ${esc(p.year)}.
        ${p.doi ? `<a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">doi</a>` : ''}
        ${p.arxiv ? `<a href="https://arxiv.org/abs/${esc(p.arxiv)}" target="_blank" rel="noopener">arXiv</a>` : ''}</p>`;
    }
  }
  return '';
}
function reviewCard(it) {
  const votes = C.votes(it), comments = C.comments(it);
  const st = reviewStatus(votes);
  const mine = C.myVote(it);
  const K = KINDS[it.kind];
  const who = (v) => `<span class="${v.verdict === 'valid' ? 'yes' : 'no'}">${v.verdict === 'valid' ? '✓' : '✗'}</span> ${personLink(v.orcid)}`;
  const actions = !C.live ? '' : !C.user ? `<p class="small"><a href="${C.loginUrl()}">Sign in with ORCID</a> to vote or comment.</p>`
    : `<div class="row rv-actions">
        <button class="btn small ${mine === 'valid' ? 'on' : ''}" data-vote="${esc(it.id)}|${mine === 'valid' ? '' : 'valid'}" title="${esc(K.valid)}">${mine === 'valid' ? '✓ Validated · withdraw' : '✓ Validate'}</button>
        <button class="btn small ${mine === 'invalid' ? 'on' : ''}" data-vote="${esc(it.id)}|${mine === 'invalid' ? '' : 'invalid'}" title="${esc(K.invalid)}">${mine === 'invalid' ? '✗ Invalidated · withdraw' : '✗ Invalidate'}</button>
        <button class="btn small" data-rcomment="${esc(it.id)}">Comment</button>
        <span class="small muted grow">Validate: “${esc(K.valid)}”</span></div>
      <div class="rv-msg small"></div>`;
  return `<article class="card rv-card" id="rv-${esc(it.id)}">
    <div class="row small"><span class="badge">${esc(K.one)}</span><span class="badge ${STATUS_CLS[st]}">${esc(STATUS_NAMES[st])}</span>
      <span class="grow"></span><a class="muted" href="#/review/${esc(it.id)}" title="Link to this item">${esc(it.date || '')}</a></div>
    ${reviewBody(it)}
    ${votes.length ? `<p class="small rv-votes">${votes.map(who).join(' · ')}</p>` : ''}
    ${comments.length ? `<ul class="rv-comments">${comments.map((c) => `<li><span class="small">${personLink(c.orcid)} <span class="muted">${esc(c.date)}</span>
      ${C.user?.orcid === c.orcid && C.live ? ` <button class="linkish small" data-delc="${esc(c.id)}|${esc(it.id)}">delete</button>` : ''}</span><div>${esc(c.text)}</div></li>`).join('')}</ul>` : ''}
    ${actions}
  </article>`;
}

async function viewReview(params, id) {
  const m = main();
  m.className = '';
  m.innerHTML = '<h1>Review</h1><p class="muted">Loading…</p>';
  const q = await loadQueue();
  if (currentRoute() !== 'review') return;
  const intro = `<h1>Review</h1>
    <p class="muted">Proposals that are <b>not part of the database</b>: results and missing statements found by the AI reader of the
    full texts, and candidates of the regular consolidation (theorems that may settle open relations, questions to record, passages
    that may answer a recorded question, papers to add). Each stays on this page until it is validated.
    One validation and no invalidation publishes a result at once; the maintainer then commits it to the database, settles disputes,
    and enters the other kinds by hand. Votes and comments are public, with your name and ORCID iD.</p>
    ${C.live ? '' : liveNote()}`;
  if (id) {
    const it = q.byId.get(id);
    m.innerHTML = `${intro}<p><a href="#/review">← all items</a></p>${it ? reviewCard(it)
      : '<p class="muted">This item is no longer open for review: it was accepted into the database, rejected, or treated by hand.</p>'}`;
    return;
  }
  const kind = params.get('kind') || '', status = params.get('status') || 'open', paper = params.get('ref') || '';
  const mineOnly = params.get('mine') === '1';
  const withStatus = q.items.map((it) => [it, reviewStatus(C.votes(it))]);
  const count = (k) => withStatus.filter(([it, st]) => (!k || it.kind === k) && (status === 'all' || st === status)).length;
  const list = withStatus.filter(([it, st]) => (!kind || it.kind === kind) && (status === 'all' || st === status) && (!paper || it.ref === paper)
    && (!mineOnly || !C.myVote(it))).map(([it]) => it)
    .sort((a, b) => (C.votes(b).length + C.comments(b).length > 0) - (C.votes(a).length + C.comments(a).length > 0) || (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
  const link = (p) => { const u = new URLSearchParams({ ...(kind ? { kind } : {}), ...(status !== 'open' ? { status } : {}), ...(paper ? { ref: paper } : {}), ...(mineOnly ? { mine: '1' } : {}), ...p }); [...u].forEach(([k, v]) => { if (!v) u.delete(k); }); return `#/review${[...u].length ? `?${u}` : ''}`; };
  const papers = [...new Set(q.items.filter((it) => !kind || it.kind === kind).map((it) => it.ref).filter(Boolean))].sort((a, b) => refShort(a).localeCompare(refShort(b)));
  m.innerHTML = `${intro}
    <div class="chips rv-kinds"><a class="chip ${!kind ? 'on' : ''}" href="${link({ kind: '' })}">All <span class="count">${count('')}</span></a>
      ${Object.entries(KINDS).filter(([k]) => q.items.some((it) => it.kind === k)).map(([k, K]) =>
        `<a class="chip ${kind === k ? 'on' : ''}" href="${link({ kind: k })}">${esc(K.name)} <span class="count">${count(k)}</span></a>`).join('')}</div>
    <div class="row rv-filters">
      <label class="small">Status <select id="rv-status">${['open', 'validated', 'invalidated', 'disputed', 'all'].map((s) =>
        `<option value="${s}" ${s === status ? 'selected' : ''}>${s === 'all' ? 'all' : esc(STATUS_NAMES[s])}</option>`).join('')}</select></label>
      <label class="small">Paper <select id="rv-ref"><option value="">all papers</option>${papers.map((k) =>
        `<option value="${esc(k)}" ${k === paper ? 'selected' : ''}>${esc(refShort(k))}</option>`).join('')}</select></label>
      ${C.user ? `<label class="toggle small"><input type="checkbox" id="rv-mine" ${mineOnly ? 'checked' : ''}> not voted by me</label>` : ''}
      <span class="grow"></span><span class="small muted">${list.length} item${list.length === 1 ? '' : 's'}</span></div>
    ${lazy(list, reviewCard, { size: 20, noun: 'items', empty: '<p class="muted">Nothing to review here.</p>' })}`;
  $('#rv-status').addEventListener('change', (e) => { location.hash = link({ status: e.target.value === 'open' ? '' : e.target.value }); });
  $('#rv-ref').addEventListener('change', (e) => { location.hash = link({ ref: e.target.value }); });
  $('#rv-mine')?.addEventListener('change', (e) => { location.hash = link({ mine: e.target.checked ? '1' : '' }); });
}
// votes and comments: the card is redrawn in place; a validated result joins the database
async function afterVote(it) {
  const card = document.getElementById(`rv-${it.id}`);
  if (card) card.outerHTML = reviewCard(it);
  if (it.kind === 'result' && await mergeValidated()) refreshMarks();
}
document.addEventListener('click', async (e) => {
  const v = e.target.closest('[data-vote]');
  const cm = e.target.closest('[data-rcomment]');
  const del = e.target.closest('[data-delc]');
  if (!v && !cm && !del) return;
  e.preventDefault();
  const q = await loadQueue();
  const card = e.target.closest('.rv-card');
  const msg = (t) => { const el = card?.querySelector('.rv-msg'); if (el) el.textContent = t; };
  try {
    if (v) {
      const [id, verdict] = v.dataset.vote.split('|');
      v.disabled = true;
      await C.setVote(id, verdict || null);
      await afterVote(q.byId.get(id));
    } else if (del) {
      const [cid, id] = del.dataset.delc.split('|');
      await C.deleteComment(cid);
      await afterVote(q.byId.get(id));
    } else {
      const id = cm.dataset.rcomment;
      if (card.querySelector('.rv-form')) return;
      card.insertAdjacentHTML('beforeend', `<form class="rv-form fb-form"><textarea rows="4" maxlength="5000" required
        placeholder="Your comment (public, with your name): what is right or wrong, where the paper says it, which result to enter…"></textarea>
        <div class="row"><button class="btn primary small" type="submit">Post</button><button class="btn small" type="button" data-cancel>Cancel</button></div></form>`);
      const f = card.querySelector('.rv-form');
      f.querySelector('textarea').focus();
      f.querySelector('[data-cancel]').addEventListener('click', () => f.remove());
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        f.querySelector('button[type=submit]').disabled = true;
        try { await C.addComment(id, f.querySelector('textarea').value); await afterVote(q.byId.get(id)); }
        catch (err) { msg(err.message); f.querySelector('button[type=submit]').disabled = false; }
      });
    }
  } catch (err) { msg(err.message); if (v) v.disabled = false; }
});

// ============================================================================
// hover cards: a statement link shows its definition, a paper link the full reference
// ============================================================================
// Only with a mouse (devices that can hover); the card stays open while the pointer
// is on it, so that its links can be clicked.
function peekHtml(a) {
  const h = a.getAttribute('href') || '';
  let m = h.match(/^#\/s\/([^?/]+)/);
  if (m) {
    const i = idx(decodeURIComponent(m[1]));
    if (i === undefined) return '';
    const s = S(i);
    const def = s.conjunction ? `Conjunction of ${s.conjunction.map((c) => L(idx(c))).join(' and ')}.` : rich(s.definition || '');
    return `<div class="peek-head">${L(i)}${s.name ? ` <span class="muted">${esc(s.name)}</span>` : ''} ${kindBadge(s)}</div>
      <div class="peek-body">${def || '<span class="muted">No definition recorded.</span>'}</div>
      ${s.caution ? `<div class="peek-caution small">⚠ ${esc(cautionText(s))}</div>` : ''}
      ${s.kind === 'problem' && s.instance ? `<div class="peek-io small"><b>Instances.</b> ${rich(s.instance)}<br><b>Solutions.</b> ${rich(s.solution)}</div>` : ''}`;
  }
  m = h.match(/^#\/refs\/([^?/]+)/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    return Z.raw.references[key] ? `<div class="peek-body">${refFull(key)}</div>` : '';
  }
  return '';
}
{
  let el = null, showT = 0, hideT = 0, cur = null;
  const hide = () => { clearTimeout(showT); el?.remove(); el = null; cur = null; };
  const place = (a) => {
    const r = a.getBoundingClientRect(), w = Math.min(440, window.innerWidth - 24);
    el.style.width = `${w}px`;
    el.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + window.scrollX}px`;
    const below = r.bottom + 8, h = el.offsetHeight;
    el.style.top = `${(below + h > window.innerHeight && r.top - h - 8 > 0 ? r.top - h - 8 : below) + window.scrollY}px`;
  };
  if (matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', (e) => {
      if (el && el.contains(e.target)) { clearTimeout(hideT); return; }
      const a = e.target.closest('a[href^="#/s/"], a[href^="#/refs/"]');
      if (!a || a.closest('nav') || a === cur) return;
      clearTimeout(showT);
      showT = setTimeout(() => {
        const html = peekHtml(a);
        if (!html || !a.isConnected) return;
        hide();
        cur = a;
        el = document.createElement('div');
        el.className = 'peek';
        el.innerHTML = html;
        document.body.appendChild(el);
        place(a);
      }, 350);
    });
    document.addEventListener('mouseout', (e) => {
      const a = e.target.closest('a[href^="#/s/"], a[href^="#/refs/"]');
      if (a && !a.contains(e.relatedTarget)) clearTimeout(showT);
      if (el && (a === cur || el.contains(e.target)) && !(el.contains(e.relatedTarget) || cur?.contains(e.relatedTarget))) {
        clearTimeout(hideT);
        hideT = setTimeout(hide, 200);
      }
    });
    window.addEventListener('hashchange', hide);
    window.addEventListener('scroll', () => { if (el && !el.matches(':hover')) hide(); }, { passive: true });
  }
}

// ============================================================================
// router
// ============================================================================
function currentRoute() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const p = path.split('/').filter(Boolean);
  // old links "#/?q=…" and "#/?tags=…" pointed to the catalogue
  if (!p.length) return /[?&](q|tags)=/.test(location.hash) ? 'catalogue' : 'home';
  return { catalogue: 'catalogue', questions: 'questions', s: 'statement', diagram: 'diagram', compare: 'compare', results: 'results', refs: 'refs', about: 'about', u: 'profile', review: 'review' }[p[0]] || 'catalogue';
}
function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  const name = currentRoute();
  if (params.has('mode')) {
    const v = params.get('mode');
    if (v !== state.mode && (v === '' || (Z.raw.modes || []).some((m) => m.id === v))) {
      state.mode = v;
      if (MODE() && !MODE().reductions.includes(state.r)) state.r = MODE().default;
      saveState();
      renderModeSwitch();
    }
    // the mode is applied once: later switches must not be undone by the URL
    params.delete('mode');
    const rest = params.toString();
    history.replaceState(null, '', `#${path}${rest ? `?${rest}` : ''}`);
  }
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name || (name === 'statement' && a.dataset.route === 'catalogue')));
  main().style.padding = '';
  closeDrawer();
  if (name === 'statement') viewStatement(p[1], params);
  else if (name === 'diagram') viewDiagram(params);
  else if (name === 'compare') viewCompare(params);
  else if (name === 'results') viewResults(params);
  else if (name === 'refs') viewRefs(p[1]);
  else if (name === 'about') { viewAbout(params); const c = params.get('class'); if (c) setTimeout(() => { const el = document.getElementById('class-' + c); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }, 50); }
  else if (name === 'home') viewHome();
  else if (name === 'questions') viewQuestions(params, p[1]);
  else if (name === 'profile') viewProfile(p[1] || 'me');
  else if (name === 'review') viewReview(params, p[1] && decodeURIComponent(p[1]));
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
  Z.raw.results.forEach((r, ri) => resultIdx.set(r._key, ri));
  if (state.mode && !MODE()) state.mode = ''; // a mode that no longer exists
  renderModeSwitch();
  C = createCommunity(Z);
  // the live state (server) may differ from the committed endorsements and votes: redraw
  // once known, with the validated proposals of the review page joined to the database
  C.ready.then(async () => {
    renderAccount();
    const added = await mergeValidated();
    if (C.live || added) { const y = window.scrollY; route(); window.scrollTo(0, y); }
  });
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
