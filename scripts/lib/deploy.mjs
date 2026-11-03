// What scripts/deploy.mjs uploads to the live instance, and how. Pure functions,
// tested in tests/deploy.test.mjs.
//
// The list is explicit (never "everything in site/"): the server's own
// api/config.php, local leftovers (.DS_Store, a local config.php with dev_login)
// and the rest of the repository (data/, cache/ with copyrighted texts and the
// admin token, feedback/ with private messages) can never be uploaded.
// Nothing is ever deleted on the server.
import fs from 'node:fs';
import path from 'node:path';

// [local path relative to site/, remote path relative to the web root]
export function deployFiles(siteDir = 'site') {
  const list = (dir, ext) => fs.readdirSync(path.join(siteDir, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => [`${dir}/${f}`, `${dir}/${f}`]);
  const files = [
    ['index.html', 'index.html'],
    ['htaccess.txt', '.htaccess'], // http → https redirect
    ...list('css', '.css'),
    ...list('js', '.js'),
    ['data/zoo.json', 'data/zoo.json'],
    ['data/abstracts.json', 'data/abstracts.json'],
    ['api/index.php', 'api/index.php'],
    ['api/callback.php', 'api/callback.php'],
    ['api/lib.php', 'api/lib.php'],
    ['api/.htaccess', 'api/.htaccess'], // blocks web access to config.php and lib.php
    ['api/config.example.php', 'api/config.example.php'],
  ];
  for (const [local, remote] of files) {
    if (/config\.php$/.test(remote)) throw new Error(`refusing to upload ${remote}`);
    if (!fs.existsSync(path.join(siteDir, local))) throw new Error(`missing ${path.join(siteDir, local)} (run npm run build?)`);
  }
  return files.map(([local, remote]) => ({ local: path.join(siteDir, local), remote }));
}

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const remotePath = (dir, remote) => [dir.replace(/^\/+|\/+$/g, ''), remote].filter(Boolean).join('/');

// curl configuration (read from stdin with `curl -K -`) uploading every file over
// FTP with TLS required; curl creates missing directories and never deletes.
export function curlConfig(files, { host, user, password, dir = 'www', tls = true }) {
  const lines = [`user = ${q(`${user}:${password}`)}`, 'ftp-create-dirs', 'fail', 'silent', 'show-error'];
  if (tls) lines.push('ssl-reqd');
  for (const f of files) {
    lines.push(`upload-file = ${q(path.resolve(f.local))}`);
    lines.push(`url = ${q(`ftp://${host}/${encodeURI(remotePath(dir, f.remote))}`)}`);
  }
  return lines.join('\n') + '\n';
}

// sftp batch file (OpenSSH `sftp -b`): creates the directories (a leading "-"
// ignores "already exists"), then puts each file. No rm, no rename.
export function sftpBatch(files, { dir = 'www' }) {
  const dirs = [...new Set(files.map((f) => path.posix.dirname(remotePath(dir, f.remote))).filter((d) => d !== '.'))].sort();
  const lines = dirs.map((d) => `-mkdir ${q(d)}`);
  for (const f of files) lines.push(`put ${q(path.resolve(f.local))} ${q(remotePath(dir, f.remote))}`);
  return lines.join('\n') + '\n';
}
