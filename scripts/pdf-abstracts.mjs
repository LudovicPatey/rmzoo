// Re-extract abstracts from the papers' PDFs, keeping their formulas.
//
//   node scripts/pdf-abstracts.mjs [--only k1,k2] [--all] [--dry]
//
// For papers whose abstract in data/abstracts.yaml comes from OpenAlex (which
// drops inline formulas) or is missing, and whose PDF is available (downloaded
// in cache/fulltext/ or in the Zotero library), the first pages are read with
// `pdftohtml -xml`, which gives the position and font of every piece of text.
// Pieces in a smaller font that are raised or lowered are turned back into
// superscripts and subscripts ("RT" "2" "2" → $\mathsf{RT}^2_2$), and pieces in
// math fonts are typeset as math. Scanned (OCR) PDFs are skipped.
//
// The abstract is the text after an "Abstract" heading, up to the first
// section, keywords or classification line. When an OpenAlex abstract exists,
// the extraction is accepted only if it contains the same words (≥ 85%) and has
// a similar length; otherwise only a clearly delimited "Abstract" is accepted.
// Accepted abstracts are recorded with `source: pdf`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { acquireLock } from './lib/lock.mjs';
acquireLock('pdf-abstracts.mjs');

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const FILE = 'data/abstracts.yaml';
const abstracts = fs.existsSync(FILE) ? YAML.parse(fs.readFileSync(FILE, 'utf8')) || {} : {};
const refs = Object.assign({}, ...fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml'))
  .map((f) => YAML.parse(fs.readFileSync('data/references/' + f, 'utf8'))));
const index = fs.existsSync('cache/fulltext/index.json') ? JSON.parse(fs.readFileSync('cache/fulltext/index.json', 'utf8')) : {};
const ZOTERO = process.env.ZOTERO_DIR || path.join(os.homedir(), 'Zotero');

function pdfOf(key) {
  if (fs.existsSync(`cache/fulltext/${key}.pdf`)) return `cache/fulltext/${key}.pdf`;
  const z = index[key]?.zotero;
  if (z) {
    const dir = path.join(ZOTERO, 'storage', z);
    const f = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => x.toLowerCase().endsWith('.pdf'));
    if (f) return path.join(dir, f);
  }
  return null;
}

// ---- text spans with fonts and geometry → lines with TeX ----------------------
// `pdftohtml -xml` splits the text at every font change and gives each piece
// its position and font: scripts are the pieces in a smaller font right after
// another piece, raised (superscript) or lowered (subscript); math fonts
// (Computer Modern math italic/symbols, AMS fonts…) are typeset as math.
const ent = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const GREEK = { Σ: '\\Sigma', Π: '\\Pi', Δ: '\\Delta', Γ: '\\Gamma', Φ: '\\Phi', Ω: '\\Omega', Θ: '\\Theta', Λ: '\\Lambda', ω: '\\omega', α: '\\alpha',
  β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', ϵ: '\\epsilon', ϕ: '\\phi', φ: '\\varphi', θ: '\\theta', λ: '\\lambda', κ: '\\kappa',
  ψ: '\\psi', ξ: '\\xi', μ: '\\mu', π: '\\pi', σ: '\\sigma', τ: '\\tau', ρ: '\\rho', η: '\\eta', ζ: '\\zeta', χ: '\\chi', ν: '\\nu',
  '∀': '\\forall ', '∃': '\\exists ', '≤': '\\le ', '≥': '\\ge ', '≰': '\\not\\le ', '≡': '\\equiv ', '∞': '\\infty', '∈': '\\in ', '∉': '\\notin ',
  '⊆': '\\subseteq ', '⊂': '\\subset ', '→': '\\to ', '⇒': '\\Rightarrow ', '↔': '\\leftrightarrow ', '¬': '\\neg ', '∧': '\\wedge ', '∨': '\\vee ',
  '×': '\\times ', '·': '\\cdot ', '⊕': '\\oplus ', '∅': '\\emptyset', '′': '\\prime ', '∗': '*', '−': '-', '|': '|', '⊢': '\\vdash ', '⊬': '\\nvdash ',
  'ℕ': '\\mathbb{N}', 'ℝ': '\\mathbb{R}', '≺': '\\prec ', '≻': '\\succ ', '⊔': '\\sqcup ', '◦': '\\circ ', '∘': '\\circ ', '\u{1D7D8}': '0', '∆': '\\Delta', '∇': '\\nabla', '≈': '\\approx ', '≃': '\\simeq ', '≅': '\\cong ', '⊥': '\\perp ', '∪': '\\cup ', '∩': '\\cap ',
  '⊃': '\\supset ', '⊇': '\\supseteq ', '≠': '\\ne ', '↦': '\\mapsto ', '⇔': '\\Leftrightarrow ', '≪': '\\ll ', '≫': '\\gg ', '…': '\\dots ' };
const toTex = (t) => [...t.replace(/\u20D7\s*([A-Za-z])/g, '\u0001$1')].map((c) => GREEK[c] ?? (c === '{' ? '\\{' : c === '}' ? '\\}' : c)).join('')
  .replace(/\u0001([A-Za-z])/g, '\\vec{$1}').replace(/\s+/g, ' ').trim();
// accents that pdftohtml leaves detached ("K ̈onig") are put back on their letter
const fixAccents = (t) => t.replace(/[\u00A8\u00B4\u0060\u02C6\u02DC\u00B8\u02C7]/g, (c) => ({ '\u00A8': '\u0308', '\u00B4': '\u0301', '`': '\u0300', '\u02C6': '\u0302', '\u02DC': '\u0303', '\u00B8': '\u0327', '\u02C7': '\u030C' })[c])
  .replace(/ ?([\u0300-\u036f]) ?([A-Za-z])/g, (m, a, c) => (c + a).normalize('NFC'));
const isMathFont = (fam) => /CMMI|CMSY|CMEX|MSAM|MSBM|EUF|EUS|RSFS|Math|Symbol|STIX|TeXGyre.*Math|Cambria Math|LucidaNewMath|txsy|txmi|pxmi|pxsy|rtxmi|MTMI|MTSY|ntxmi|ntxsy|NewTXMI/i.test(fam);
function spans(xml) {
  const fonts = new Map([...xml.matchAll(/<fontspec id="(\d+)" size="([\d.-]+)" family="([^"]*)"/g)].map(([, id, size, fam]) => [id, { size: +size, fam }]));
  return [...xml.matchAll(/<text top="([\d.-]+)" left="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" font="(\d+)">([\s\S]*?)<\/text>/g)]
    .map(([, top, left, w, h, f, t]) => ({ top: +top, left: +left, right: +left + +w, h: +h, size: fonts.get(f)?.size || +h,
      math: isMathFont(fonts.get(f)?.fam || ''), cmsy: /CMSY/i.test(fonts.get(f)?.fam || ''), t: fixAccents(ent(t.replace(/<[^>]+>/g, '')).normalize('NFKC')) }))
    // in Computer Modern symbol fonts the prime sits where "0" is: 0′ comes out as "0" "0"
    .map((x) => (x.cmsy && /^0+$/.test(x.t.trim()) ? { ...x, t: x.t.trim().replace(/0/g, '′') } : x))
    // italic words set in a math font are text, not formulas
    .map((x) => (x.math && /[a-z]{3,}/i.test(x.t.replace(/\\[a-z]+/gi, '')) && !/[=<>≤≥∈⊆→]/.test(x.t) ? { ...x, math: false } : x))
    .filter((x) => x.t.trim() || x.t === ' ');
}
// Group spans into lines: a span starts a new line when it lies well below the
// line's first span (scripts are only slightly lowered) or above it, or when it
// goes back to the left.
function toLines(sp) {
  const out = [];
  let cur = null;
  for (const x of sp) {
    const ref = cur?.[0];
    if (!cur || x.top > ref.top + 0.75 * ref.h || x.top + x.h < ref.top - 0.3 * ref.h || x.left < cur.at(-1).left - 5) { cur = [x]; out.push(cur); }
    else cur.push(x);
  }
  return out;
}
function lineTex(line) {
  const main = Math.max(...line.map((x) => x.size));
  const toks = []; // { t, math, sup:[], sub:[], right, bottom }
  for (const x of line) {
    const prev = toks.at(-1);
    const small = x.size < 0.85 * main && x.t.trim().length <= 6;
    if (small && prev && x.left - prev.right < 0.35 * main) {
      const bottom = x.top + x.h;
      (bottom < prev.bottom - 0.12 * main ? prev.sup : prev.sub).push(toTex(x.t));
      prev.right = Math.max(prev.right, x.right);
      continue;
    }
    toks.push({ t: x.t, math: x.math, sup: [], sub: [], left: x.left, right: x.right, bottom: x.top + x.h, gap: prev ? x.left - prev.right : 0 });
  }
  // render; adjacent math tokens share one $…$
  let s = '', inMath = false;
  const sc = (xs) => { const j = xs.join(''); return j.length === 1 ? j : `{${j}}`; };
  toks.forEach((k, i) => {
    const scripted = k.sup.length || k.sub.length;
    let text = k.t, lead = '', trail = '';
    if (scripted && !k.math) { // text word carrying scripts: "RT", "WKL", "Σ": keep its last word as the base
      const m = text.match(/^(.*?)(\S+?)([.,;:)]*)$/s);
      if (m) { lead = m[1]; text = m[2]; trail = m[3]; }
    }
    const space = i > 0 && k.gap > 0.15 * main ? ' ' : '';
    if (scripted || k.math) {
      let core = toTex(text);
      if (!k.math && /^[A-Z][A-Z]+$/.test(core)) core = `\\mathsf{${core}}`;
      const body = core + (k.sup.length ? '^' + sc(k.sup) : '') + (k.sub.length ? '_' + sc(k.sub) : '');
      if (lead) { if (inMath) { s += '$'; inMath = false; } s += space + lead; }
      if (inMath) s += (space || (/\\[a-zA-Z]+$/.test(s) && /^[a-zA-Z]/.test(body)) ? ' ' : '') + body;
      else { s += (lead ? '' : space) + '$' + body; inMath = true; }
      if (trail) { s += '$' + trail; inMath = false; }
    } else {
      if (inMath) { s += '$'; inMath = false; }
      s += space + text;
    }
  });
  if (inMath) s += '$';
  return s.replace(/\$\s*\$/g, '').replace(/\s+/g, ' ').trim();
}

// ---- abstract boundaries -------------------------------------------------------
const START = /^(abstract|summary)\b[.:—–-]?\s*/i;
const STOP = /^(§\s*1\b|1\.?\s+introduction|introduction\b|keywords|key words|(19|20)\d\d\s+mathematics subject|mathematics subject classification|ams subject|msc|received\b|\d+\s*(introduction|preliminaries))/i;
function extract(text) {
  const ls = text.split('\n').map((l) => l.trim());
  const i = ls.findIndex((l) => START.test(l) && l.length < 1500);
  if (i < 0) return null;
  const body = [ls[i].replace(START, '')];
  for (let j = i + 1; j < ls.length && j < i + 60; j++) {
    if (STOP.test(ls[j])) break;
    if (!ls[j] && body.join(' ').length > 400) break;
    body.push(ls[j]);
  }
  return body.join('\n').replace(/([a-z])[-‐]\s*\n\s*([a-z])/g, '$1$2').replace(/\s*\[\d+(?:[,–-]\s*\d+)*\]/g, '')
    .replace(/ ?([\u0300-\u036f]) ?([A-Za-z])/g, (m, ac, c) => (c + ac).normalize('NFC')).replace(/\u20D7\s*\$?\s*([A-Za-z])/g, '\\vec{$1}').replace(/\s*\n\s*/g, ' ').replace(/\$\s*\$/g, '').replace(/\s+/g, ' ').trim();
}
// words of four letters or more, ignoring formulas and TeX commands
const plainWords = (t) => String(t).replace(/\$[^$]*\$/g, ' ').replace(/\\[a-zA-Z]+/g, ' ').toLowerCase().match(/[a-z]{4,}/g) || [];
function agrees(pdf, ref) {
  const a = plainWords(pdf), b = plainWords(ref), A = new Set(a);
  if (!b.length) return false;
  const hit = b.filter((w) => A.has(w)).length / b.length;
  const ratio = a.length / b.length;
  return hit >= 0.85 && ratio > 0.75 && ratio < 1.6;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-abs-'));
const counts = { replaced: 0, added: 0, rejected: 0, notFound: 0, noPdf: 0, scanned: 0 };
for (const [k] of Object.entries(refs)) {
  if (only && !only.has(k)) continue;
  const cur = abstracts[k];
  if (cur && cur.source !== 'openalex' && !(args.includes('--all') && cur.source === 'pdf')) continue;
  const pdf = pdfOf(k);
  if (!pdf) { counts.noPdf++; continue; }
  let xml;
  try {
    const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8', timeout: 30000 });
    if (/^(Producer|Creator):.*(FineReader|ABBYY|OCR|Paper Capture|Tesseract|scan)/im.test(info)) { counts.scanned++; continue; }
    xml = execFileSync('pdftohtml', ['-xml', '-i', '-q', '-f', '1', '-l', '3', '-stdout', pdf], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
  } catch { counts.notFound++; continue; }
  const text = xml.split(/<\/page>/).map((pg) => toLines(spans(pg)).map(lineTex).join('\n')).join('\n');
  const abs = extract(text);
  if (!abs || abs.length < 150) { counts.notFound++; continue; }
  if (cur?.text && !agrees(abs, cur.text)) { counts.rejected++; if (args.includes('--dry')) console.log('REJECT', k, '|', abs.slice(0, 160)); continue; }
  if (!cur && abs.length > 3000) { counts.rejected++; continue; }
  if (args.includes('--dry')) console.log('OK', k, '|', abs.slice(0, 300));
  abstracts[k] = { source: 'pdf', text: abs };
  cur ? counts.replaced++ : counts.added++;
}
fs.rmSync(tmp, { recursive: true });
if (!args.includes('--dry'))
  fs.writeFileSync(FILE, '# Abstracts of the papers in data/references, fetched by scripts/abstracts.mjs.\n'
    + YAML.stringify(Object.fromEntries(Object.entries(abstracts).sort(([a], [b]) => a.localeCompare(b))), { lineWidth: 0 }));
console.log(counts);
