// Backup and restoration of what GitHub does not hold (docs/BACKUP.md): the
// untracked files of this checkout (cache/: full texts, AI readings, settings,
// admin token; feedback/; site/api/config.php) and the live server's data
// (rmzoo-data/: endorsements, comments, messages, uploaded texts, diagrams) with
// its api/config.php. Snapshots go to a directory outside the repository.
//
//   node scripts/backup.mjs [--dest DIR] [--no-local] [--no-server] [--keep N] [--dry-run]
//   node scripts/backup.mjs --list [--dest DIR]
//   node scripts/backup.mjs --verify [SNAPSHOT|latest] [--dest DIR]
//   node scripts/backup.mjs --restore [SNAPSHOT|latest] --local|--server [--only PATH]
//                           [--overwrite] [--config] [--dest DIR] [--dry-run]
//
// The destination is --dest, else "dest" in cache/backup.json, else ~/Backups/rmzoo.
// The server is reached with OpenSSH sftp and the settings of cache/deploy.json
// (host, user, dir; dataDir if the server's config.php moves the data directory);
// ssh asks the password on the terminal (an SSH key avoids it).
// Nothing is ever deleted, locally or on the server, except old snapshots with --keep.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { cli } from './lib/cli.mjs';
import {
  stamp, walk, localFiles, snapshots, readManifest, resolveSnapshot, storeFile, dedupeFile,
  verify, planLocal, sftpBackup, sftpRestore, remoteDataDir, SERVER_SKIP,
} from './lib/backup.mjs';

const USAGE = `node scripts/backup.mjs [--dest DIR] [--no-local] [--no-server] [--keep N] [--dry-run]
       node scripts/backup.mjs --list | --verify [SNAPSHOT]
       node scripts/backup.mjs --restore [SNAPSHOT] --local|--server [--only PATH] [--overwrite] [--config] [--dry-run]`;
const args = cli(USAGE, {
  '--dest': 1, '--no-local': 0, '--no-server': 0, '--keep': 1, '--dry-run': 0,
  '--list': 0, '--verify': 0, '--restore': 0, '--local': 0, '--server': 0, '--only': 1, '--overwrite': 0, '--config': 0,
});
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, 'scripts/backup.mjs'))) { console.error('Run from the root of the repository.'); process.exit(1); }
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
const expand = (p) => path.resolve(String(p).replace(/^~(?=$|\/)/, os.homedir()));
const DEST = expand(args.get('--dest', readJson('cache/backup.json').dest || '~/Backups/rmzoo'));
// compared through real paths (/var is /private/var on macOS; DEST may not exist yet)
const real = (p) => { let up = ''; while (!fs.existsSync(p)) { up = path.join(path.basename(p), up); p = path.dirname(p); } return path.join(fs.realpathSync(p), up); };
const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
if (inside(real(DEST), fs.realpathSync(ROOT))) { console.error(`The backups must be outside the repository (${DEST}).`); process.exit(1); }
const deployOpt = readJson('cache/deploy.json');
const dry = args.has('--dry-run');
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const onlyOpt = args.get('--only');
const only = onlyOpt ? (p) => p === onlyOpt.replace(/\/+$/, '') || p.startsWith(onlyOpt.replace(/\/+$/, '') + '/') : undefined;

function lockHolder() {
  try {
    const { pid, name } = JSON.parse(fs.readFileSync('cache/.data-lock', 'utf8'));
    process.kill(pid, 0);
    return `${name} (pid ${pid})`;
  } catch { return null; }
}

function sftp(cmds) {
  if (!deployOpt.host || !deployOpt.user) {
    console.error('No server settings: cache/deploy.json needs host and user (see scripts/deploy.mjs).');
    process.exit(1);
  }
  const r = spawnSync('sftp', ['-o', 'ConnectTimeout=20', `${deployOpt.user}@${deployOpt.host}`], { input: cmds + 'bye\n', stdio: ['pipe', 'inherit', 'inherit'] });
  return r.status === 0;
}

// ---- create a snapshot ---------------------------------------------------------------
function create({ local = true, server = true, label = '' } = {}) {
  const all = snapshots(DEST);
  const prev = all.length ? { dir: path.join(DEST, all[all.length - 1]) } : null;
  if (prev) prev.manifest = readManifest(prev.dir);
  let name = stamp();
  // two snapshots in the same second (a restore takes one first): wait for the next
  while (fs.existsSync(path.join(DEST, name)) || fs.existsSync(path.join(DEST, name + '.partial'))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    name = stamp();
  }
  const files = {};
  let copied = 0, linked = 0;
  const note = (rel, r) => { files[rel] = { size: r.size, sha256: r.sha256 }; if (r.linked) linked += r.size; else copied += r.size; };

  let locals = [];
  if (local) {
    const who = lockHolder();
    if (who) { console.error(`${who} is modifying the data: back up when it has finished.`); process.exit(2); }
    const others = execFileSync('git', ['ls-files', '--others', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0');
    locals = localFiles(others);
    const total = locals.reduce((s, f) => s + fs.statSync(f).size, 0);
    const top = {};
    for (const f of locals) { const k = f.includes('/') ? f.split('/').slice(0, f.startsWith('cache/') ? 2 : 1).join('/') : f; top[k] = (top[k] || 0) + 1; }
    console.log(`local: ${locals.length} files, ${mb(total)}`);
    for (const [k, n] of Object.entries(top).sort()) console.log(`  ${k.padEnd(40)} ${n}`);
  }
  if (server) console.log(`server: ${deployOpt.user || '?'}@${deployOpt.host || '?'}:${remoteDataDir(deployOpt)}/ (without sessions) and ${(deployOpt.dir ?? 'www')}/api/config.php`);
  if (dry) {
    console.log(`→ ${path.join(DEST, name)}${prev ? ` (unchanged files linked to ${path.basename(prev.dir)})` : ''}\n(dry run: nothing written)`);
    if (server) console.log('sftp commands:\n' + sftpBackup(path.join(DEST, name + '.partial', 'server'), deployOpt).replace(/^/gm, '  '));
    return null;
  }

  fs.mkdirSync(DEST, { recursive: true, mode: 0o700 });
  const tmp = path.join(DEST, name + '.partial');
  fs.mkdirSync(tmp, { mode: 0o700 });
  fs.chmodSync(tmp, 0o700);
  for (const f of locals) note(`local/${f}`, storeFile(path.join(ROOT, f), tmp, `local/${f}`, prev));

  if (server) {
    const into = path.join(tmp, 'server');
    fs.mkdirSync(into, { recursive: true });
    console.log('Downloading the server data (ssh may ask the password)…');
    const ok = sftp(sftpBackup(into, deployOpt));
    if (!ok || !fs.existsSync(path.join(into, 'data'))) {
      console.error(`✗ the server data could not be downloaded; the incomplete snapshot is left in ${tmp}.`);
      process.exit(1);
    }
    for (const rel of walk(path.join(into, 'data'))) {
      if (SERVER_SKIP.some((re) => re.test(rel))) { fs.rmSync(path.join(into, 'data', rel)); continue; }
      note(`server/data/${rel}`, dedupeFile(tmp, `server/data/${rel}`, prev));
    }
    fs.rmSync(path.join(into, 'data', 'sessions'), { recursive: true, force: true });
    if (fs.existsSync(path.join(into, 'config.php'))) note('server/config.php', dedupeFile(tmp, 'server/config.php', prev));
    else console.warn('! api/config.php was not found on the server.');
    if (!files['server/data/endorsements.json']) console.warn('! no endorsements.json in the server data: check dataDir in cache/deploy.json.');
  }

  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* */ }
  const manifest = { created: new Date().toISOString(), commit, label: label || undefined, parts: [local && 'local', server && 'server'].filter(Boolean), server: server ? { host: deployOpt.host, dir: deployOpt.dir ?? 'www', dataDir: remoteDataDir(deployOpt) } : undefined, files };
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, path.join(DEST, name));
  console.log(`✓ ${path.join(DEST, name)}: ${Object.keys(files).length} files, ${mb(copied)} copied, ${mb(linked)} linked to the previous snapshot.`);
  return path.join(DEST, name);
}

function prune(keep) {
  const all = snapshots(DEST);
  for (const n of all.slice(0, Math.max(0, all.length - keep))) {
    fs.rmSync(path.join(DEST, n), { recursive: true, force: true });
    console.log(`  removed old snapshot ${n}`);
  }
}

// ---- list, verify ----------------------------------------------------------------------
function list() {
  const all = snapshots(DEST);
  if (!all.length) { console.log(`No snapshot in ${DEST}.`); return; }
  console.log(`Snapshots in ${DEST}:`);
  for (const n of all) {
    const m = readManifest(path.join(DEST, n));
    const fl = Object.entries(m.files);
    const size = (pre) => fl.filter(([k]) => k.startsWith(pre)).reduce((s, [, f]) => s + f.size, 0);
    console.log(`  ${n}  ${m.parts.join('+').padEnd(12)} local ${mb(size('local/')).padStart(9)}  server ${mb(size('server/')).padStart(8)}  ${fl.length} files  commit ${(m.commit || '?').slice(0, 7)}${m.label ? `  (${m.label})` : ''}`);
  }
  const partial = fs.readdirSync(DEST).filter((n) => n.endsWith('.partial'));
  if (partial.length) console.log(`Incomplete (interrupted) snapshots, safe to delete: ${partial.join(', ')}`);
}

function check(snap) {
  const bad = verify(snap);
  if (bad.length) {
    console.error(`✗ ${path.basename(snap)}: ${bad.length} files missing or altered:`);
    for (const b of bad.slice(0, 30)) console.error(`  ${b.why.padEnd(8)} ${b.rel}`);
    return false;
  }
  console.log(`✓ ${path.basename(snap)}: all ${Object.keys(readManifest(snap).files).length} files match the manifest.`);
  return true;
}

// ---- restore ---------------------------------------------------------------------------
function restoreLocal(snap) {
  const who = lockHolder();
  if (who) { console.error(`${who} is modifying the data: restore when it has finished.`); process.exit(2); }
  const plan = planLocal(snap, ROOT, { only });
  console.log(`local, from ${path.basename(snap)}${onlyOpt ? ` (only ${onlyOpt})` : ''}: ${plan.missing.length} missing here (restored), ${plan.same.length} identical, ${plan.differs.length} different here (${args.has('--overwrite') ? 'replaced, after a snapshot of the current files' : 'kept: --overwrite replaces them'}).`);
  for (const p of plan.differs.slice(0, 20)) console.log(`  differs: ${p}`);
  if (plan.differs.length > 20) console.log(`  … and ${plan.differs.length - 20} more`);
  const todo = [...plan.missing, ...(args.has('--overwrite') ? plan.differs : [])];
  if (dry) { for (const p of plan.missing.slice(0, 20)) console.log(`  missing: ${p}`); console.log('(dry run: nothing written)'); return; }
  if (!todo.length) { console.log('Nothing to restore.'); return; }
  const want = new Set(todo.map((p) => `local/${p}`));
  const bad = verify(snap, { only: (rel) => want.has(rel) });
  if (bad.length) { console.error(`✗ the snapshot is damaged (${bad.length} files, e.g. ${bad[0].rel}): try an older one.`); process.exit(1); }
  if (args.has('--overwrite') && plan.differs.length) {
    console.log('Snapshot of the current local files first:');
    create({ local: true, server: false, label: `before restoring ${path.basename(snap)}` });
  }
  for (const p of todo) {
    const src = path.join(snap, 'local', p), dst = path.join(ROOT, p);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const st = fs.statSync(src);
    fs.copyFileSync(src, dst); // a copy, never a link into the backup
    fs.chmodSync(dst, st.mode & 0o777);
    fs.utimesSync(dst, st.atime, st.mtime);
  }
  console.log(`✓ ${todo.length} files restored. Then: npm ci (node_modules), npm run build.`);
}

function restoreServer(snap) {
  const m = readManifest(snap);
  if (!m.parts.includes('server')) { console.error(`${path.basename(snap)} has no server data.`); process.exit(1); }
  const files = Object.keys(m.files).filter((rel) => (rel.startsWith('server/data/') && (!only || only(rel.slice('server/data/'.length)))) || (rel === 'server/config.php' && args.has('--config')));
  if (!files.length) { console.error('Nothing to restore (check --only).'); process.exit(1); }
  const cmds = sftpRestore(snap, files, deployOpt);
  console.log(`server, from ${path.basename(snap)}${onlyOpt ? ` (only ${onlyOpt})` : ''}: ${files.length} files to ${deployOpt.user || '?'}@${deployOpt.host || '?'}:${remoteDataDir(deployOpt)}/${args.has('--config') ? ' and api/config.php' : ' (api/config.php only with --config)'}.`);
  console.log('Server files with the same name are replaced; other files on the server are kept.');
  if (dry) { console.log('sftp commands:\n' + cmds.replace(/^/gm, '  ') + '(dry run: nothing sent)'); return; }
  const want = new Set(files);
  const bad = verify(snap, { only: (rel) => want.has(rel) });
  if (bad.length) { console.error(`✗ the snapshot is damaged (${bad.length} files, e.g. ${bad[0].rel}): try an older one.`); process.exit(1); }
  console.log('Snapshot of the server as it is now, first:');
  create({ local: false, server: true, label: `before restoring ${path.basename(snap)} on the server` });
  console.log('Uploading (ssh may ask the password again)…');
  if (!sftp(cmds)) { console.error('✗ sftp failed: the server may be partly restored; run the same command again.'); process.exit(1); }
  console.log('✓ restored. Check https://rmzoo.ludovicpatey.com/api/index.php?a=state, then run endorsements-sync.mjs.');
}

// ---- main --------------------------------------------------------------------------------
if (args.has('--list')) list();
else if (args.has('--verify')) process.exit(check(resolveSnapshot(DEST, args.rest[0])) ? 0 : 1);
else if (args.has('--restore')) {
  if (!args.has('--local') && !args.has('--server')) { console.error('--restore needs --local, --server or both.'); process.exit(1); }
  const snap = resolveSnapshot(DEST, args.rest[0]);
  if (args.has('--local')) restoreLocal(snap);
  if (args.has('--server')) restoreServer(snap);
} else {
  if (args.rest.length) { console.error(`unexpected argument ${args.rest[0]}\nusage: ${USAGE}`); process.exit(1); }
  const keep = args.has('--keep') ? Number(args.get('--keep')) : null;
  if (keep !== null && !(Number.isInteger(keep) && keep >= 1)) { console.error('--keep: a number ≥ 1'); process.exit(1); }
  const snap = create({ local: !args.has('--no-local'), server: !args.has('--no-server') });
  if (snap && keep) prune(keep);
}
