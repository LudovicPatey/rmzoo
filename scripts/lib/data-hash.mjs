// A hash of the contents of data/ (every file, by relative path), written into
// site/data/zoo.json by the build (`dataHash`). Deploy compares it with the current
// data/: the build is current exactly when the hashes agree, whatever the file times
// (a git checkout or a rewrite with the same content changes the times, not the hash).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function dataHash(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue; // .DS_Store and the like
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const h = crypto.createHash('sha256');
  for (const f of files.map((p) => path.relative(dir, p).split(path.sep).join('/')).sort()) {
    h.update(f);
    h.update('\0');
    h.update(fs.readFileSync(path.join(dir, f)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
