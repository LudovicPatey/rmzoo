// `node scripts/deploy.mjs` (and the backups) take the FTP password from ~/.netrc: the entry of the host, else of the same login, else the default one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { netrcEntry, parseNetrc, readNetrc } from '../scripts/lib/netrc.mjs';

const TEXT = `# deployment
machine ftp.cluster015.ovh.net login alice password s3cret
machine other.example.org
  login bob
  password b0b
default login anon password guest`;

test('a netrc file is read entry by entry, comments and line breaks aside', () => {
  assert.deepEqual(parseNetrc(TEXT).map((e) => e.machine), ['ftp.cluster015.ovh.net', 'other.example.org', null]);
  assert.equal(netrcEntry(TEXT, 'other.example.org', 'bob').password, 'b0b', 'the entry of the host');
  assert.equal(netrcEntry(TEXT, 'ftp.cluster015.hosting.ovh.net', 'alice').password, 's3cret', 'another name of the same server: the same login');
  assert.equal(netrcEntry(TEXT, 'unknown.org', 'carol').login, 'anon', 'else the default entry');
  assert.equal(netrcEntry('machine a login x', 'a', 'x'), null, 'an entry without a password is no answer');
});

test('a netrc file others can read is refused, and the helper answers only a password prompt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrc-'));
  const file = path.join(dir, '.netrc');
  fs.writeFileSync(file, TEXT, { mode: 0o644 });
  if (process.platform !== 'win32') assert.throws(() => readNetrc(file), /chmod 600/);
  fs.chmodSync(file, 0o600);
  assert.equal(readNetrc(file), TEXT);
  assert.equal(readNetrc(path.join(dir, 'none')), null);
  const ask = (prompt) => spawnSync(process.execPath, ['scripts/netrc-askpass.mjs', prompt], { env: { ...process.env, HOME: dir, NETRC_HOST: 'other.example.org', NETRC_LOGIN: 'bob' }, encoding: 'utf8' });
  assert.equal(ask("bob@other.example.org's password: ").stdout, 'b0b\n');
  const hostKey = ask('Are you sure you want to continue connecting (yes/no/[fingerprint])?');
  assert.equal(hostKey.stdout, ''); assert.notEqual(hostKey.status, 0, 'an unknown host key is never accepted on the user\'s behalf');
  fs.rmSync(dir, { recursive: true, force: true });
});
