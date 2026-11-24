// One-off import (kept for provenance): proofs written by AI agents in
// cache/proofs/<area>.md (2026-11-23) become review items of kind `proof`
// (docs/REVIEW.md), with their structured proof (site/js/proofdoc.js).
//
//   node scripts/import/agent-proofs.mjs spec.json [--dry-run]
//
// spec.json: [{ id, file, sections: [number or title prefix, …], title?, results?,
// preamble?: true }]. Without `results`, the facts are read from the "Fact" lines.
// The sections of one item are joined (a lemma of one section used by another).
import fs from 'node:fs';
import YAML from 'yaml';
import { cli } from '../lib/cli.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { addToQueue } from '../lib/review-queue.mjs';
import { checkProof, proofSize } from '../../site/js/proofdoc.js';

const args = cli('node scripts/import/agent-proofs.mjs spec.json [--dry-run] [--dump out.json]', { '--dry-run': 0, '--dump': 1 });
const specFile = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dry = args.has('--dry-run');
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const refs = Object.assign({}, ...fs.readdirSync('data/references').filter((f) => f.endsWith('.yaml')).map((f) => YAML.parse(fs.readFileSync(`data/references/${f}`, 'utf8')) || {}));
const ids = new Set(JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8')).statements.map((s) => s.id));

// sections of a file: preamble and "## n. title" blocks
function sections(file) {
  const text = fs.readFileSync(file, 'utf8');
  const parts = text.split(/^## /m);
  const pre = parts.shift();
  return { pre, list: parts.map((p) => { const nl = p.indexOf('\n'); return { head: p.slice(0, nl).trim(), body: p.slice(nl + 1) }; }) };
}
// paper keys in the text become citations
const cite = (t) => t.replace(/\[([a-z][a-z-]*\d{4}[a-z]?)\]/g, (m, k) => (refs[k] ? `[@${k}]` : m))
  .replace(/(?<![@\w[])([a-z][a-z]+\d{4}[a-z]?)(?![\w\]])/g, (m, k) => (refs[k] ? `[@${k}]` : m))
  .replace(/`([^`]+)`/g, (m, k) => (ids.has(k) ? `[[${k}]]` : k));
const clean = (t) => cite(t.replace(/\s+/g, ' ').trim());

// metadata bullets of a section and the rest (the proof)
const META = /^- (Facts?|Status|Definitions checked|Dependencies|Referee check|Confidence|Consequences?)\b[^:]*:\s*(.*)$/;
function split(body) {
  const meta = {}, rest = [];
  let cur = null;
  for (const line of body.split('\n')) {
    const m = line.match(META);
    if (m) { cur = m[1].replace(/s$/, '').toLowerCase(); meta[cur] = (meta[cur] ? meta[cur] + ' ' : '') + m[2]; continue; }
    if (cur && /^\s+\S/.test(line) && !/^\s*(\*\*|Proof\b)/.test(line.trim()) && meta[cur] !== undefined) { meta[cur] += ' ' + line.trim(); continue; }
    if (/^- /.test(line) || !line.trim() || /^\S/.test(line)) cur = null;
    rest.push(line.replace(/^- (Proof)/, '$1'));
  }
  return { meta, rest };
}

// the proof text → blocks
const ENV = { theorem: 'theorem', lemma: 'lemma', corollary: 'corollary', corollaries: 'corollary', proposition: 'proposition', claim: 'claim', definition: 'definition', characterization: 'proposition', construction: 'construction', notation: 'notation', remark: 'remark' };
function blocks(lines, used) {
  const top = [];
  let env = null, body = top, part = null, para = null, steps = null, inStmt = false;
  const flushPara = () => { if (para) { const t = clean(para); if (t) body.push(t); para = null; } };
  const closeSteps = () => { steps = null; };
  const newEnv = (kind, label, text) => {
    flushPara(); closeSteps(); part = null;
    let l = label.replace(/[.:]\s*$/, '').trim();
    while (used.has(l)) l += '′';
    used.add(l);
    env = { env: kind, label: l, ...(text ? { text: clean(text) } : {}) };
    inStmt = !!text;
    top.push(env);
    body = env.text ? top : (env.proof = []);
    if (!env.text) body = env.proof;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); if (inStmt && env && !env.proof) { env.proof = []; body = env.proof; } inStmt = false; continue; }
    if (inStmt && !/^(\*\*|Proof\b|\d+\.\s|#)/.test(line)) { env.text += ' ' + clean(line.replace(/∎\s*$/, '')); continue; }
    if (inStmt && env && !env.proof && /^\d+\.\s/.test(line)) { env.proof = []; body = env.proof; }
    inStmt = false;
    if (/^#{1,6}\s/.test(line)) { flushPara(); closeSteps(); env = null; part = null; body = top; body.push(clean(line.replace(/^#+\s*/, ''))); continue; }
    const h = line.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
    if (h) {
      const w = h[1].replace(/^\(([^)]*)\)\s*/, '').split(/[\s.(]/)[0].toLowerCase();
      if (ENV[w]) { newEnv(ENV[w], h[1], h[2]); continue; }
      // a bold part heading inside a proof: (a) …, Proof for C_I…
      flushPara(); closeSteps();
      part = { env: 'part', label: clean(h[1].replace(/[.:]\s*$/, '')), proof: [] };
      (env ? (env.proof ||= []) : top).push(part);
      body = part.proof;
      if (h[2]) body.push(clean(h[2]));
      continue;
    }
    if (/^Proof\b/.test(line) && !/^Proof\b[^.]*\bfor\b/i.test(line)) {
      flushPara(); closeSteps();
      const rest = line.replace(/^Proof[^.:]*[.:]\s*/, '');
      if (env && !env.proof?.length && env.text) { env.proof = []; part = null; body = env.proof; }
      else { part = { env: 'part', label: clean(line.replace(/[.:].*$/, '')), proof: [] }; (env ? (env.proof ||= []) : top).push(part); body = part.proof; }
      if (rest && rest !== '∎') para = rest.replace(/∎\s*$/, '');
      if (/∎\s*$/.test(line)) { flushPara(); env = null; part = null; body = top; }
      continue;
    }
    const st = line.match(/^(\d+)\.\s+(.*)$/);
    if (st) {
      flushPara();
      if (!steps) { steps = { steps: [] }; body.push(steps); }
      steps.steps.push(clean(st[2].replace(/∎\s*$/, '')));
      if (/∎\s*$/.test(line)) { closeSteps(); env = null; part = null; body = top; }
      continue;
    }
    const pm = line.match(/^\(([^()]{1,48})\)\s+(.*)$/);
    if (pm && (env || part || top.length)) {
      flushPara(); closeSteps();
      part = { env: 'part', label: `(${clean(pm[1])})`, proof: [] };
      (env ? (env.proof ||= []) : top).push(part);
      body = part.proof;
      if (pm[2]) body.push(clean(pm[2]));
      continue;
    }
    if (steps && !/^[*-]\s/.test(line)) { // continuation of a step
      steps.steps[steps.steps.length - 1] += ' ' + clean(line.replace(/∎\s*$/, ''));
      if (/∎\s*$/.test(line)) { closeSteps(); env = null; part = null; body = top; }
      continue;
    }
    if (/^[*-]\s/.test(line)) { flushPara(); closeSteps(); body.push(clean(line.replace(/^[*-]\s+/, '• '))); continue; }
    para = (para ? para + ' ' : '') + line.replace(/∎\s*$/, '');
    if (/∎\s*$/.test(line)) { flushPara(); env = null; part = null; body = top; }
  }
  flushPara();
  // empty containers out
  const prune = (b) => b.filter((n) => typeof n === 'string' ? n.trim() : n.steps ? n.steps.length : true).map((n) => {
    if (typeof n === 'object' && n.proof) { n.proof = prune(n.proof); if (!n.proof.length) delete n.proof; }
    return n;
  }).filter((n) => typeof n === 'string' || n.steps || n.text || n.proof);
  return prune(top);
}

// facts written {type: …, from: …} in the Fact lines
function facts(text) {
  const out = [];
  for (const m of String(text).matchAll(/\{(?:type: )?(implication|separation|equivalence|property|conservation)\b([^}]*)\}/g)) {
    const o = { type: m[1] };
    for (const [, k, v] of m[2].matchAll(/(from|to|over|statement|property|value|base|class):\s*([^,}]+)/g)) o[k] = v.trim();
    if ('value' in o) o.value = o.value === 'true' || o.value === 'yes';
    out.push(o);
  }
  return out;
}

// mentions of a named block of the same proof ("by Lemma D", "Corollary E") become references [#Lemma D]
function linkLabels(blocks) {
  const labels = [];
  const collect = (n) => { if (Array.isArray(n)) n.forEach(collect); else if (n && typeof n === 'object') {
    if (n.env && n.env !== 'part' && n.label && /^(Lemma|Corollary|Claim|Theorem|Proposition|Definition)\s+\S/.test(n.label)) labels.push(n.label);
    for (const k of ['proof', 'steps', 'body', 'cases']) if (n[k]) collect(n[k]); } };
  collect(blocks);
  if (!labels.length) return blocks;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w#\\[])(${labels.sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\w′])`, 'g');
  const fix = (t) => t.replace(re, '[#$1]');
  const walk = (n, own) => {
    if (typeof n === 'string') return fix(n);
    if (Array.isArray(n)) return n.map((x) => walk(x, own));
    if (!n || typeof n !== 'object') return n;
    const o = { ...n };
    if (o.text) o.text = fix(o.text);
    if (o.title) o.title = fix(o.title);
    for (const k of ['proof', 'steps', 'body']) if (o[k]) o[k] = walk(o[k]);
    if (o.cases) o.cases = o.cases.map((c) => ({ ...c, body: walk(c.body) }));
    return o;
  };
  return walk(blocks);
}

const items = [];
for (const it of spec) {
  const { pre, list } = sections(it.file);
  const chosen = it.sections.map((s) => list.find((x) => (typeof s === 'number' ? x.head.startsWith(`${s}.`) : x.head.startsWith(s))));
  if (chosen.some((x) => !x)) throw new Error(`${it.id}: section not found among ${list.map((x) => x.head.slice(0, 30)).join(' | ')}`);
  const used = new Set();
  const all = [];
  const meta = { fact: [], status: [], 'definitions checked': [], dependencie: [], 'referee check': [], confidence: [] };
  if (it.preamble) {
    const p = pre.split('\n').filter((l) => !/^#\s/.test(l));
    const cut = p.findIndex((l) => /^Summary of /.test(l));
    if (cut >= 0) p.length = cut;
    all.push({ env: 'notation', label: 'Conventions', proof: blocks(p, used) });
  }
  for (const sec of chosen) {
    const { meta: m, rest } = split(sec.body);
    for (const k of Object.keys(meta)) if (m[k]) meta[k].push(m[k]);
    const b = blocks(rest.filter((l) => !/^## /.test(l)), used);
    if (chosen.length > 1) all.push({ env: 'part', label: clean(sec.head.replace(/^\d+\.\s*/, '')), proof: b });
    else all.push(...b);
  }
  const results = it.results || meta.fact.flatMap(facts);
  const unknown = results.flatMap((r) => [r.from, r.to, r.statement].filter((x) => x && !ids.has(x) && !/\./.test(x)));
  const title = it.title || chosen.map((s) => s.head.replace(/^\d+\.\s*/, '')).join('; ');
  const proof = { blocks: linkLabels(all) };
  const item = {
    id: it.id, kind: 'proof', status: 'pending', date: '2026-11-24',
    title: clean(title), summary: clean(it.summary || title),
    results, proof,
    ...(meta.dependencie.length ? { dependencies: clean(meta.dependencie.join(' ')) } : {}),
    ...(meta.status.length ? { novelty: clean(meta.status.join(' ')) } : {}),
    ...(meta['referee check'].length ? { concerns: clean(meta['referee check'].join(' ')) } : {}),
    confidence: it.confidence || (meta.confidence.join(' ').match(/medium/) ? 'medium' : 'high'),
    model: 'claude-fable-5-2 (agent), refereed by claude-opus-5-5',
    reasons: [it.reason || 'AI proof not yet refereed by a person'],
  };
  const errs = checkProof(proof, item.id);
  const size = proofSize(proof);
  console.log(`${item.id}: ${results.length} result(s), ${size.blocks} blocks, ${size.steps} steps${unknown.length ? `; unknown ids ${unknown.join(' ')}` : ''}${errs.length ? `\n  ${errs.join('\n  ')}` : ''}`);
  for (const r of results) console.log(`   ${JSON.stringify(r)}`);
  items.push(item);
}
if (args.has("--dump")) fs.writeFileSync(args.get("--dump"), JSON.stringify(items));
if (!dry) {
  acquireLock('agent-proofs.mjs');
  // a new import replaces the pending items of the same ids (not those already voted on or commented)
  const mine = new Set(items.map((x) => x.id));
  console.log(`${addToQueue(items, { replace: (n) => mine.has(n.get('id')) })} items added to data/review.yaml`);
}
