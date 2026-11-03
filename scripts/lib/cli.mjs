// Command-line arguments shared by all scripts: `--help` prints the usage and
// exits; an unknown flag is an error (so a typo never starts a real run).
//
//   const args = cli('node scripts/x.mjs [--since YYYY-MM-DD] [--apply]', { '--since': 1, '--apply': 0 });
//   args.get('--since', default)  args.has('--apply')  args.rest (non-flag arguments)
//
// `flags` maps each accepted flag to the number of values it takes (0 or 1).
export function cli(usage, flags) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(`usage: ${usage}`); process.exit(0); }
  const values = new Map(), rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    if (!(a in flags)) { console.error(`unknown option ${a}\nusage: ${usage}`); process.exit(1); }
    if (flags[a]) {
      if (i + 1 >= argv.length) { console.error(`option ${a} needs a value\nusage: ${usage}`); process.exit(1); }
      values.set(a, argv[++i]);
    } else values.set(a, true);
  }
  return { has: (k) => values.has(k), get: (k, d) => (values.has(k) ? values.get(k) : d), rest, argv };
}
