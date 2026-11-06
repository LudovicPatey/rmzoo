// The data model (scripts/lib/schema.mjs) and the code that depends on it must
// stay in step. These tests fail when a field or an operation is added or
// changed in one place and not in the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCHEMA, FILES, OPERATIONS, unknownFields } from '../scripts/lib/schema.mjs';

const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));

test('every file listed in usedBy still reads the field', () => {
  const stale = [];
  for (const [entity, fields] of Object.entries(SCHEMA))
    for (const [field, spec] of Object.entries(fields))
      for (const u of spec.usedBy) {
        assert.ok(src[u] !== undefined, `${entity}.${field}: unknown file key ${u}`);
        if (!new RegExp(`\\.${field}\\b|['"\`]${field}['"\`]|\\b${field}\\s*:|\\{[^}]*\\b${field}\\b[^}]*\\}\\s*=`).test(src[u])) stale.push(`${entity}.${field} in ${FILES[u]}`);
      }
  assert.deepEqual(stale, [], 'usedBy entries whose file no longer mentions the field (update scripts/lib/schema.mjs)');
});

test('every field is documented', () => {
  for (const [entity, fields] of Object.entries(SCHEMA))
    for (const [field, spec] of Object.entries(fields)) {
      assert.ok(spec.doc, `${entity}.${field} has no doc`);
      assert.ok(Array.isArray(spec.usedBy), `${entity}.${field} has no usedBy`);
      if (spec.items) assert.ok(SCHEMA[spec.items], `${entity}.${field}: unknown item entity ${spec.items}`);
    }
});

test('unknown fields are reported, including in citations', () => {
  assert.equal(unknownFields({ id: 'x', kind: 'problem', label: 'X' }, 'statement', 's').length, 0);
  assert.equal(unknownFields({ id: 'x', defintion: 'typo' }, 'statement', 's').length, 1);
  // what YAML makes of { ref: a, loc: Section 1, (5) }
  assert.equal(unknownFields({ id: 'x', refs: [{ ref: 'a', loc: 'Section 1', '(5)': null }] }, 'statement', 's').length, 1);
  assert.equal(unknownFields({ _file: 'f', _date: 'd', id: 'x' }, 'statement', 's').length, 0);
});

test('every operation is handled by the build, the engine, the viewer and the miner', () => {
  for (const [op, o] of Object.entries(OPERATIONS)) {
    // build: label, name and definition
    for (const part of ['label', 'name', 'definition'])
      assert.match(src.build, new RegExp(`\\b${op}: \\(\\) =>`), `build: no ${part} for ${op}`);
    // engine: the laws mention every operation
    assert.match(src.engine, new RegExp(`'${op}'`), `engine: ${op} not handled`);
    // viewer: the "Weihrauch operation — …" line
    assert.match(src.viewer, new RegExp(`\\b${op}: '`), `viewer: no description of ${op}`);
    // miner: textual forms (par may map to none: its hat is lost in extracted text)
    assert.match(src.mineCommon, new RegExp(`\\b${op}: \\(\\) =>`), `miner: no textual form for ${op}`);
    assert.ok(o.arity === 1 || o.arity === 2);
  }
});

test('a dotted id never duplicates an explicit operator statement (wkl.jump is wkl-j)', () => {
  const zoo = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  const seen = new Map();
  for (const s of zoo.statements.filter((x) => x.op)) {
    const k = `${s.op}|${(s.args || []).join('|')}`;
    assert.ok(!seen.has(k), `${s.id} and ${seen.get(k)} are the same operator statement`);
    seen.set(k, s.id);
  }
});

test('modes: valid reductions, and membership follows the cited results', () => {
  const zoo = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  const st = (id) => zoo.statements.find((s) => s.id === id);
  const rids = new Set(zoo.reductions.map((r) => r.id));
  for (const m of zoo.modes) {
    assert.ok(m.reductions.every((r) => rids.has(r)) && m.reductions.includes(m.default), m.id);
  }
  assert.ok(st('rca0')._modes.includes('rm'), 'a base system belongs to the modes of its reductions');
  assert.ok(st('lim')._modes.includes('weihrauch'));
  assert.ok(!(st('atr')._modes || []).includes('weihrauch'), 'a sentence has no Weihrauch results');
  assert.ok(st('lrt22')._modes.includes('wrm'));
});

test('concepts (data/concepts.yaml) have a source and are used by some statement', () => {
  const zoo = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  const used = new Set(zoo.statements.flatMap((s) => s._concepts || []));
  for (const c of zoo.concepts || []) {
    assert.ok((c.refs || []).length, `concept ${c.id} has no source`);
    assert.ok(used.has(c.id), `concept ${c.id} matches no statement (check its match patterns)`);
  }
  // a word with another meaning is skipped: RSAT's homogeneous sets of atoms are not Ramsey's
  assert.ok(!(zoo.statements.find((s) => s.id === 'rsat')?._concepts || []).includes('homogeneous'));
  assert.ok((zoo.statements.find((s) => s.id === 'rt22')?._concepts || []).includes('homogeneous'));
});

test('levels of hyperimmunity preservation: a chain, and pages show the optimal level', async () => {
  const { buildZoo } = await import('../site/js/engine.js');
  const raw = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  const chain = ['hyperimmunity-preservation', 'hyperimmunities-k-preservation', 'hyperimmunities-3-preservation', 'hyperimmunities-2-preservation', 'hyperimmunities-1-preservation'];
  chain.slice(0, -1).forEach((p, i) => assert.deepEqual(raw.properties.find((x) => x.id === p).implies, [chain[i + 1]], p));
  const z = buildZoo(raw);
  const shown = (id) => z.salientProps(z.sidx.get(id)).map((p) => raw.properties[p].id).filter((p) => chain.includes(p));
  // RT²₂ preserves one hyperimmunity but not two: both levels, nothing else of the chain
  assert.deepEqual(shown('rt22').sort(), ['hyperimmunities-1-preservation', 'hyperimmunities-2-preservation']);
  // COH preserves countably many: only the top level is listed
  assert.deepEqual(shown('coh'), ['hyperimmunity-preservation']);
});

test('errata (data/errata.yaml): known papers, kinds, shown on paper pages', () => {
  const zoo = JSON.parse(fs.readFileSync('site/data/zoo.json', 'utf8'));
  assert.ok(zoo.errata.length > 0);
  for (const x of zoo.errata) {
    assert.ok(zoo.references[x.ref], x.ref);
    assert.ok(['misprint', 'error', 'gap'].includes(x.kind), `${x.ref} ${x.loc}`);
    for (const r of x.refs || []) assert.ok(zoo.references[r.ref], r.ref);
  }
  assert.match(fs.readFileSync('site/js/app.js', 'utf8'), /erratumHtml\(key\)/);
});

test('conservation properties over different bases do not imply each other', async () => {
  // RCA₀ + P may be Π¹₁-conservative over RCA₀ while T + P is not over T (T = BΣ⁰₂, IΣ⁰₂),
  // and conversely: no `implies` between properties read from conservation over different bases
  const { default: YAML } = await import('yaml');
  const props = YAML.parse(fs.readFileSync('data/properties.yaml', 'utf8'));
  const byId = new Map(props.map((p) => [p.id, p]));
  const bad = [];
  for (const p of props) for (const q of p.implies || []) {
    const a = p.fromConservation, b = byId.get(q)?.fromConservation;
    if (a && b && a.base !== b.base) bad.push(`${p.id} → ${q}`);
  }
  assert.deepEqual(bad, []);
});
