// Backups of what GitHub does not hold (docs/BACKUP.md), used by scripts/backup.mjs
// and tested in tests/backup.test.mjs.
//
// A snapshot is a directory <dest>/<YYYYMMDDTHHMMSSZ>/ with
//   local/<path>          the files of the checkout that git does not track
//                         (cache/, feedback/, site/api/config.php, …)
//   server/data/<path>    the server's data directory (rmzoo-data/: endorsements,
//                         comments, messages, uploads, diagrams; not the sessions)
//   server/config.php     the server's api/config.php (ORCID secret, admin token)
//   manifest.json         {created, commit, parts, files: {path: {size, sha256}}},
//                         written last: a directory without it is incomplete.
// A file identical to the one of the previous snapshot is a hard link to it, so a
// snapshot costs only what changed (each one is nevertheless complete on its own).
// Nothing here ever deletes a file outside the backup directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// files of the checkout never backed up: regenerated (node_modules), noise, or the
// lock of a running script
export const LOCAL_SKIP = [/^node_modules\//, /(^|\/)\.DS_Store$/, /^cache\/\.data-lock$/];
// files of the server's data directory never backed up: PHP sessions, lock files
export const SERVER_SKIP = [/^sessions(\/|$)/, /(^|\/)\.lock[^/]*$/, /\.tmp$/];

export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const SNAP = /^\d{8}T\d{6}Z$/;

export function sha256(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

// all regular files under dir, as posix paths relative to it
export function walk(dir, rel = '') {
  const out = [];
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

// The local files to back up: what `git ls-files --others` lists (untracked,
// ignored included), minus LOCAL_SKIP. `others` is that list.
export function localFiles(others) {
  return others.filter((f) => f && !LOCAL_SKIP.some((re) => re.test(f))).sort();
}

// complete snapshots of dest, oldest first
export function snapshots(dest) {
  if (!fs.existsSync(dest)) return [];
  return fs.readdirSync(dest).filter((n) => SNAP.test(n) && fs.existsSync(path.join(dest, n, 'manifest.json'))).sort();
}
export const readManifest = (snapDir) => JSON.parse(fs.readFileSync(path.join(snapDir, 'manifest.json'), 'utf8'));

export function resolveSnapshot(dest, name) {
  const all = snapshots(dest);
  if (!all.length) throw new Error(`no complete snapshot in ${dest}`);
  const n = !name || name === 'latest' ? all[all.length - 1] : path.basename(name);
  if (!all.includes(n)) throw new Error(`no complete snapshot ${n} in ${dest} (have: ${all.join(', ')})`);
  return path.join(dest, n);
}

// Puts src at snapDir/rel: a hard link to prev/rel when the previous snapshot has
// the same content, a copy otherwise (times and mode kept). Returns {size, sha256, linked}.
export function storeFile(src, snapDir, rel, prev, hash = sha256(src)) {
  const st = fs.statSync(src);
  const dst = path.join(snapDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const old = prev?.manifest.files[rel];
  let linked = false;
  if (old && old.sha256 === hash && old.size === st.size) {
    try { fs.linkSync(path.join(prev.dir, rel), dst); linked = true; } catch { /* other volume, or file system without hard links */ }
  }
  if (!linked) {
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, st.mode & 0o777);
    fs.utimesSync(dst, st.atime, st.mtime);
  }
  return { size: st.size, sha256: hash, linked };
}

// Same, for a file already downloaded into the snapshot: replaced by a hard link
// to the previous snapshot's copy when identical.
export function dedupeFile(snapDir, rel, prev) {
  const file = path.join(snapDir, rel);
  const st = fs.statSync(file);
  const hash = sha256(file);
  const old = prev?.manifest.files[rel];
  let linked = false;
  if (old && old.sha256 === hash && old.size === st.size) {
    const tmp = `${file}.link`;
    try { fs.linkSync(path.join(prev.dir, rel), tmp); fs.renameSync(tmp, file); linked = true; } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* */ } }
  }
  return { size: st.size, sha256: hash, linked };
}

// Files of a snapshot whose content no longer matches the manifest (or missing).
export function verify(snapDir, { only } = {}) {
  const m = readManifest(snapDir);
  const bad = [];
  for (const [rel, f] of Object.entries(m.files)) {
    if (only && !only(rel)) continue;
    const file = path.join(snapDir, rel);
    if (!fs.existsSync(file)) bad.push({ rel, why: 'missing' });
    else if (fs.statSync(file).size !== f.size || sha256(file) !== f.sha256) bad.push({ rel, why: 'altered' });
  }
  return bad;
}

// What restoring the local files of a snapshot into root would do, file by file:
// missing (restored), same (nothing), differs (restored only with overwrite, the
// current version being saved first). Files absent from the snapshot are left alone.
export function planLocal(snapDir, root, { only } = {}) {
  const m = readManifest(snapDir);
  const plan = { missing: [], same: [], differs: [] };
  for (const [rel, f] of Object.entries(m.files)) {
    if (!rel.startsWith('local/')) continue;
    const p = rel.slice('local/'.length);
    if (only && !only(p)) continue;
    const target = path.join(root, p);
    if (!fs.existsSync(target)) plan.missing.push(p);
    else if (fs.statSync(target).size === f.size && sha256(target) === f.sha256) plan.same.push(p);
    else plan.differs.push(p);
  }
  return plan;
}

// ---- server (OpenSSH sftp, commands on stdin as in scripts/deploy.mjs) ----------
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// remote data directory: the server's default (api/../../rmzoo-data, i.e. next to
// the site's directory) unless deploy.json gives dataDir
export const remoteDataDir = (opt) => opt.dataDir || path.posix.join(path.posix.dirname(String(opt.dir ?? 'www').replace(/\/+$/, '')), 'rmzoo-data');

// downloads the data directory and api/config.php into the local directory `into`
// (into/data/, into/config.php). Only get: nothing is changed on the server.
export function sftpBackup(into, opt) {
  return [
    `get -rp ${q(remoteDataDir(opt))} ${q(path.resolve(into, 'data'))}`,
    `-get -p ${q(path.posix.join(opt.dir ?? 'www', 'api/config.php'))} ${q(path.resolve(into, 'config.php'))}`,
  ].join('\n') + '\n';
}

// restores the given files of a snapshot (paths "server/data/…", "server/config.php")
// on the server. Puts only: no rm, no rename. (scripts/backup.mjs first takes a
// snapshot of the server as it is, in a separate session.)
export function sftpRestore(snapDir, files, opt) {
  const data = remoteDataDir(opt);
  const target = (rel) => rel === 'server/config.php'
    ? path.posix.join(opt.dir ?? 'www', 'api/config.php')
    : path.posix.join(data, rel.slice('server/data/'.length));
  const lines = [];
  const dirs = new Set();
  for (const rel of files) {
    for (let d = path.posix.dirname(target(rel)); d !== '.' && d !== '/' && !dirs.has(d); d = path.posix.dirname(d)) dirs.add(d);
  }
  for (const d of [...dirs].sort((a, b) => a.length - b.length || a.localeCompare(b))) lines.push(`-mkdir ${q(d)}`);
  for (const rel of files) lines.push(`put -p ${q(path.resolve(snapDir, rel))} ${q(target(rel))}`);
  return lines.join('\n') + '\n';
}
