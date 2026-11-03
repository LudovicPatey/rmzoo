// Add results to the database without creating duplicates.
//
//   node scripts/add-results.mjs spec.json
//
// spec.json: { "<refkey>": [ result, ... ], ... } where each result is as in
// data/results/*.yaml but without `refs`; an optional `loc` gives the theorem
// number. If the same fact already exists (same type, statements, reduction),
// the citation is merged into the existing entry (and a missing `loc` is
// filled in); otherwise the result is appended to
// data/results/literature/<refkey>.yaml. The logic is in scripts/lib/results.mjs.
import fs from 'node:fs';
import { acquireLock } from './lib/lock.mjs';
import { cli } from './lib/cli.mjs';
import { addResults } from './lib/results.mjs';
cli('node scripts/add-results.mjs spec.json', {});
acquireLock('add-results.mjs');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { added, merged } = addResults(spec);
console.log(`${added} results added, ${merged} citations merged into existing results`);
