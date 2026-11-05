// What scripts/deploy.mjs uploads (scripts/lib/deploy.mjs): an explicit list,
// never a configuration file or anything outside the viewer, never a deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deployFiles, curlConfig, sftpBatch } from '../scripts/lib/deploy.mjs';

test('only the viewer and the server code are uploaded, never config.php or local leftovers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-site-'));
  fs.cpSync('site', dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'api', 'config.php'), '<?php return [];');
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');
  fs.writeFileSync(path.join(dir, 'js', 'notes.txt'), '');
  const remote = deployFiles(dir).map((f) => f.remote);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(remote.includes('index.html') && remote.includes('data/zoo.json') && remote.includes('api/index.php') && remote.includes('api/.htaccess'));
  assert.ok(remote.includes('.htaccess'), 'htaccess.txt is uploaded as .htaccess');
  assert.ok(!remote.some((r) => /config\.php$|DS_Store|notes/.test(r)));
  assert.ok(remote.every((r) => /^(index\.html|\.htaccess|(css|js|data|api)\/)/.test(r)));
});

test('curl and sftp instructions upload and never delete', () => {
  const files = [{ local: 'site/index.html', remote: 'index.html' }, { local: 'site/api/index.php', remote: 'api/index.php' }];
  const c = curlConfig(files, { host: 'ftp.example.org', user: 'me', password: 'p"a\\ss', dir: 'www' });
  assert.match(c, /^user = "me:p\\"a\\\\ss"$/m);
  assert.match(c, /^ssl-reqd$/m);
  assert.match(c, /^url = "ftp:\/\/ftp\.example\.org\/www\/api\/index\.php"$/m);
  assert.doesNotMatch(c, /DELE|quote|-Q/i);
  const b = sftpBatch(files, { dir: 'www' });
  assert.deepEqual(b.trim().split('\n').map((l) => l.split(' ')[0]), ['-mkdir', '-mkdir', 'put', 'put']);
  assert.doesNotMatch(b, /^-?(rm|rmdir|rename)\b/m);
});

test('the build check of deploy compares contents, not file times', async () => {
  const { dataHash } = await import('../scripts/lib/data-hash.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmzoo-hash-'));
  fs.mkdirSync(path.join(dir, 'results'));
  fs.writeFileSync(path.join(dir, 'a.yaml'), 'x: 1\n');
  fs.writeFileSync(path.join(dir, 'results', 'b.yaml'), 'y: 2\n');
  const h = dataHash(dir);
  const later = new Date(Date.now() + 60e3);
  fs.utimesSync(path.join(dir, 'a.yaml'), later, later); // touched, same content
  assert.equal(dataHash(dir), h);
  fs.writeFileSync(path.join(dir, 'results', 'b.yaml'), 'y: 3\n');
  assert.notEqual(dataHash(dir), h);
  fs.rmSync(dir, { recursive: true });
});
