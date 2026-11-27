// Backup and restoration (scripts/backup.mjs, scripts/lib/backup.mjs): end to end on
// a throwaway repository (local part only: the server part is sftp, checked through
// the commands it sends).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { localFiles, sftpBackup, sftpRestore, remoteDataDir, snapshots, readManifest, verify } from '../scripts/lib/backup.mjs';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-bk-'));
  const repo = path.join(dir, 'repo'), dest = path.join(dir, 'backups');
  fs.mkdirSync(path.join(repo, 'scripts/lib'), { recursive: true });
  for (const f of ['backup.mjs', 'lib/backup.mjs', 'lib/cli.mjs', 'lib/netrc.mjs']) fs.copyFileSync(path.join('scripts', f), path.join(repo, 'scripts', f));
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
  w('.gitignore', 'cache/\nfeedback/\nnode_modules/\nsite/api/config.php\n');
  w('data/a.yaml', 'tracked: 1\n');
  w('cache/fulltext/x.txt', 'full text of x');
  w('cache/ai/x.json', '{"facts": []}');
  w('cache/admin-token', 'secret');
  w('feedback/inbox/m1.json', '{"text": "hello"}');
  w('site/api/config.php', '<?php return [];');
  w('notes.txt', 'untracked, not ignored');
  w('node_modules/p/index.js', 'skipped');
  w('cache/.DS_Store', 'skipped');
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('add', '.gitignore', 'data', 'scripts');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const run = (...a) => spawnSync('node', ['scripts/backup.mjs', '--dest', dest, ...a], { cwd: repo, encoding: 'utf8' });
  return { dir, repo, dest, w, run, read: (f) => fs.readFileSync(path.join(repo, f), 'utf8') };
}

test('a local snapshot holds the untracked files, links unchanged ones, restores without overwriting', () => {
  const s = sandbox();
  try {
    let r = s.run('--no-server');
    assert.equal(r.status, 0, r.stderr);
    let snaps = snapshots(s.dest);
    assert.equal(snaps.length, 1);
    const first = path.join(s.dest, snaps[0]);
    const m = readManifest(first);
    const files = Object.keys(m.files).sort();
    assert.deepEqual(files, ['local/cache/admin-token', 'local/cache/ai/x.json', 'local/cache/fulltext/x.txt', 'local/feedback/inbox/m1.json', 'local/notes.txt', 'local/site/api/config.php']);
    assert.deepEqual(m.parts, ['local']);
    assert.equal(fs.statSync(first).mode & 0o777, 0o700, 'snapshots are private');

    // second snapshot: the unchanged file is a hard link, the changed one a copy
    s.w('cache/ai/x.json', '{"facts": [1]}');
    r = s.run('--no-server');
    assert.equal(r.status, 0, r.stderr);
    snaps = snapshots(s.dest);
    assert.equal(snaps.length, 2);
    const second = path.join(s.dest, snaps[1]);
    const ino = (snap, f) => fs.statSync(path.join(snap, 'local', f)).ino;
    assert.equal(ino(first, 'cache/fulltext/x.txt'), ino(second, 'cache/fulltext/x.txt'));
    assert.notEqual(ino(first, 'cache/ai/x.json'), ino(second, 'cache/ai/x.json'));
    assert.deepEqual(verify(second), []);

    // lose a file, change another: restore brings back the lost one, keeps the changed one
    fs.rmSync(path.join(s.repo, 'cache/fulltext/x.txt'));
    s.w('feedback/inbox/m1.json', '{"text": "edited"}');
    r = s.run('--restore', snaps[0], '--local', '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(s.repo, 'cache/fulltext/x.txt')), 'dry run writes nothing');
    r = s.run('--restore', snaps[0], '--local');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.read('cache/fulltext/x.txt'), 'full text of x');
    assert.equal(s.read('feedback/inbox/m1.json'), '{"text": "edited"}');
    assert.equal(s.read('cache/ai/x.json'), '{"facts": [1]}');
    assert.notEqual(fs.statSync(path.join(s.repo, 'cache/fulltext/x.txt')).ino, ino(first, 'cache/fulltext/x.txt'), 'restored as a copy, not a link into the backup');
    assert.equal(snapshots(s.dest).length, 2, 'no snapshot taken when nothing is overwritten');

    // --overwrite (with --only) replaces, after a snapshot of the current files
    r = s.run('--restore', snaps[0], '--local', '--overwrite', '--only', 'feedback');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.read('feedback/inbox/m1.json'), '{"text": "hello"}');
    assert.equal(s.read('cache/ai/x.json'), '{"facts": [1]}', '--only leaves the rest');
    const all = snapshots(s.dest);
    assert.equal(all.length, 3);
    const pre = readManifest(path.join(s.dest, all[2]));
    assert.match(pre.label, /before restoring/);
    assert.equal(fs.readFileSync(path.join(s.dest, all[2], 'local/feedback/inbox/m1.json'), 'utf8'), '{"text": "edited"}');

    // a damaged snapshot is detected and refused
    fs.rmSync(path.join(first, 'local/cache/admin-token'));
    fs.writeFileSync(path.join(first, 'local/notes.txt'), 'altered');
    r = s.run('--verify', snaps[0]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing.*admin-token/);
    assert.match(r.stderr, /altered.*notes\.txt/);
    fs.rmSync(path.join(s.repo, 'notes.txt'));
    r = s.run('--restore', snaps[0], '--local');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /damaged/);

    // --keep removes the oldest snapshots only
    r = s.run('--no-server', '--keep', '2');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(snapshots(s.dest), all.slice(2).concat(snapshots(s.dest).slice(-1)));
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('backups refuse a destination inside the repository and a running data script', () => {
  const s = sandbox();
  try {
    let r = spawnSync('node', ['scripts/backup.mjs', '--no-server', '--dest', path.join(s.repo, 'bk')], { cwd: s.repo, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /outside the repository/);
    s.w('cache/.data-lock', JSON.stringify({ pid: process.pid, name: 'consolidate' }));
    r = s.run('--no-server');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /consolidate/);
    r = s.run('--restore', '--local');
    assert.match(r.stderr, /no complete snapshot/);
    r = s.run('--restore');
    assert.match(r.stderr, /--local, --server/);
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('local files: untracked ones, without node_modules, .DS_Store and the lock', () => {
  assert.deepEqual(localFiles(['cache/a', 'node_modules/x/y.js', 'cache/.DS_Store', 'cache/.data-lock', 'feedback/m.json', '']), ['cache/a', 'feedback/m.json']);
});

test('sftp: the backup only downloads, the restore only uploads the chosen files', () => {
  const opt = { host: 'h', user: 'u', dir: 'rmzoo' };
  assert.equal(remoteDataDir(opt), 'rmzoo-data');
  assert.equal(remoteDataDir({ dir: 'www/' }), 'rmzoo-data');
  assert.equal(remoteDataDir({ dir: 'sites/zoo' }), 'sites/rmzoo-data');
  assert.equal(remoteDataDir({ dir: 'www', dataDir: '/home/u/data' }), '/home/u/data');
  const b = sftpBackup('/bk/s/server', opt);
  assert.deepEqual(b.trim().split('\n').map((l) => l.split(' ')[0]), ['get', '-get']);
  assert.match(b, /^get -rp "rmzoo-data" "\/bk\/s\/server\/data"$/m);
  assert.match(b, /^-get -p "rmzoo\/api\/config\.php" "\/bk\/s\/server\/config\.php"$/m);
  const r = sftpRestore('/bk/s', ['server/data/feedback/a.json', 'server/data/endorsements.json', 'server/config.php'], opt);
  const lines = r.trim().split('\n');
  assert.ok(lines.every((l) => /^(-mkdir|put -p) /.test(l)), r);
  assert.ok(lines.includes('put -p "/bk/s/server/data/feedback/a.json" "rmzoo-data/feedback/a.json"'));
  assert.ok(lines.includes('put -p "/bk/s/server/config.php" "rmzoo/api/config.php"'));
  assert.ok(lines.indexOf('-mkdir "rmzoo-data"') < lines.indexOf('-mkdir "rmzoo-data/feedback"'));
  assert.doesNotMatch(r, /^-?(rm|rmdir|rename)\b/m);
});
