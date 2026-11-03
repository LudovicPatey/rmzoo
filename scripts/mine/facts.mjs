// Candidate facts from the cached full texts: numbered theorems mentioning
// statements of the zoo whose relation is still open in the database.
// These are leads for a human (or AI) reader, never added automatically.
//   node scripts/mine/facts.mjs [--only k1,k2 | --since YYYY-MM-DD] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/cli.mjs';
import { raw, z, selectPapers, dict, tokRe, normalize, relation, screened } from './common.mjs';

export function mineFacts(keys) {
  const out = [];
  for (const key of keys) {
    const text = fs.readFileSync(`cache/fulltext/${key}.txt`, 'utf8');
    const re = /\n\s*(Theorem|Proposition|Corollary|Lemma|Claim|Fact)\s+(\d+(?:\.\d+)*)\.?\s*(\([^)]{0,90}\))?\.?([\s\S]{0,700}?)(?=\n\s*(?:Proof|Theorem|Proposition|Corollary|Lemma|Definition|Example|Remark|Question|Claim)\b|$)/g;
    let m; const seen = new Set();
    while ((m = re.exec(text))) {
      if (screened.facts.has(`${key}|${m[1]} ${m[2]}`)) continue;
      const body = normalize(m[4]).slice(0, 500);
      if (body.length < 15) continue;
      const ids = [...new Set([...body.matchAll(tokRe)].map((x) => dict.get(x[1])))].filter((x) => x && x !== 'rca0' && x !== 'rca0star');
      if (ids.length < 2 || ids.length > 5) continue;
      const { neg, over } = relation(body);
      const r = z.ridx.get(over);
      const open = [];
      for (const a of ids) for (const b of ids) if (a !== b && z.status(r, z.sidx.get(a), z.sidx.get(b)) === 'open') open.push(`${a}${neg ? '⇏' : '⇒'}${b}`);
      if (!open.length || seen.has(body.slice(0, 120))) continue;
      seen.add(body.slice(0, 120));
      out.push({ ref: key, year: raw.references[key]?.year, where: `${m[1]} ${m[2]}`, over, open, body });
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cli('node scripts/mine/facts.mjs [--only k1,k2 | --since YYYY-MM-DD] [--out file.json]', { '--only': 1, '--since': 1, '--out': 1 });
  const args = process.argv.slice(2);
  const res = mineFacts(selectPapers(args));
  if (args.includes('--out')) fs.writeFileSync(args[args.indexOf('--out') + 1], JSON.stringify(res, null, 1));
  else for (const c of res) console.log(`${c.ref} ${c.where} [${c.over}] ${c.open.join(' ')}\n   ${c.body.slice(0, 300)}`);
  console.error(`${res.length} candidate facts`);
}
