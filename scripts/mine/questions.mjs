// Candidate open questions from the cached full texts: numbered questions,
// problems and conjectures not yet recorded in data/questions.yaml.
//   node scripts/mine/questions.mjs [--only k1,k2 | --since YYYY-MM-DD] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { raw, z, selectPapers, dict, tokRe, normalize } from './common.mjs';

const recorded = new Set((raw.questions || []).flatMap((q) => q.asked.flatMap((a) =>
  String(a.loc || '').match(/\d+(?:\.\d+)*/g)?.map((n) => `${a.ref}|${n}`) || [])));

export function mineQuestions(keys) {
  const out = [];
  for (const key of keys) {
    const text = fs.readFileSync(`cache/fulltext/${key}.txt`, 'utf8');
    const re = /\n\s*((?:Open\s+)?(?:Question|Problem|Conjecture)s?)\s+(\d+(?:\.\d+)*)\s*(\([^)]{0,80}\))?\s*[.:]?([\s\S]{0,900}?)(?=\n\s*(?:Proof|Theorem|Proposition|Corollary|Lemma|Definition|Example|Remark|Question|Problem|Conjecture|Claim|References|Bibliography|Acknowledg)|\n\s*\n\s*\n|$)/g;
    let m; const seen = new Set();
    while ((m = re.exec(text))) {
      const where = `${m[1].replace(/\s+/g, ' ')} ${m[2]}`;
      const body = normalize(m[4]).slice(0, 700).trim();
      if (seen.has(where) || body.length < 20 || /^(asks|is|was|has|of|in|and|above|below|remains|from|,)/.test(body)) continue;
      seen.add(where);
      if (recorded.has(`${key}|${m[2]}`)) continue;
      const ids = [...new Set([...body.matchAll(tokRe)].map((x) => dict.get(x[1])))].filter((x) => x && x !== 'rca0' && x !== 'rca0star');
      out.push({ ref: key, year: raw.references[key]?.year, where, statements: ids, body });
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const res = mineQuestions(selectPapers(args));
  if (args.includes('--out')) fs.writeFileSync(args[args.indexOf('--out') + 1], JSON.stringify(res, null, 1));
  else for (const c of res) console.log(`${c.ref} ${c.where} [${c.statements.join(', ')}]\n   ${c.body.slice(0, 300)}`);
  console.error(`${res.length} candidate questions`);
}
