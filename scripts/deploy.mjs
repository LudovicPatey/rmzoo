// Upload the viewer and the endorsement server to the live instance
// (rmzoo.ludovicpatey.com). Uploads only the files listed in scripts/lib/deploy.mjs
// and never deletes anything on the server: its api/config.php and the
// endorsements and comments (in rmzoo-data/, outside the web root) are untouched.
//
//   node scripts/deploy.mjs [--dry-run] [--protocol ftp|sftp] [--host H] [--user U] [--dir www] [--no-tls]
//
// Settings are read from cache/deploy.json (git-ignored), e.g.
//   { "protocol": "sftp", "host": "ftp.clusterXXX.hosting.ovh.net", "user": "LOGIN", "dir": "www" }
// sftp: OpenSSH sftp (OVH web hosting accepts it with the FTP password, which ssh
//       asks in the terminal; an SSH key works too). The default.
// ftp:  FTP with TLS through curl, for hosts that support it (OVH does not); the
//       password is asked (or RMZOO_FTP_PASSWORD), never stored.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { cli } from './lib/cli.mjs';
import { deployFiles, curlConfig, sftpBatch } from './lib/deploy.mjs';

const args = cli('node scripts/deploy.mjs [--dry-run] [--protocol ftp|sftp] [--host H] [--user U] [--dir www] [--no-tls]',
  { '--dry-run': 0, '--protocol': 1, '--host': 1, '--user': 1, '--dir': 1, '--no-tls': 0 });
const saved = fs.existsSync('cache/deploy.json') ? JSON.parse(fs.readFileSync('cache/deploy.json', 'utf8')) : {};
const opt = {
  protocol: args.get('--protocol', saved.protocol || 'sftp'),
  host: args.get('--host', saved.host),
  user: args.get('--user', saved.user),
  dir: args.get('--dir', saved.dir ?? 'www'),
  tls: !args.has('--no-tls') && saved.tls !== false,
};
const dry = args.has('--dry-run');
if (!['ftp', 'sftp'].includes(opt.protocol)) { console.error('--protocol: ftp or sftp'); process.exit(1); }
if (!dry && (!opt.host || !opt.user)) {
  console.error('No host/user: create cache/deploy.json, e.g.\n  { "protocol": "sftp", "host": "ftp.clusterXXX.hosting.ovh.net", "user": "LOGIN", "dir": "www" }\n(the FTP host and login are in the OVH control panel: Web hosting → FTP-SSH)');
  process.exit(1);
}

// ---- checks ------------------------------------------------------------------
const files = deployFiles('site');
// the built data must be newer than the sources
const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
  const p = path.join(dir, e.name);
  return Math.max(m, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
}, 0);
if (newest('data') > fs.statSync('site/data/zoo.json').mtimeMs) {
  console.error('data/ changed after the last build: run npm run check && npm run build first.');
  process.exit(1);
}
try {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'site', 'data'], { encoding: 'utf8' }).trim();
  if (dirty) console.warn(`! uncommitted changes in site/ or data/ (the live site will differ from GitHub):\n${dirty.split('\n').map((l) => '    ' + l).join('\n')}`);
} catch { /* not a git checkout */ }

const total = files.reduce((s, f) => s + fs.statSync(f.local).size, 0);
console.log(`${files.length} files, ${(total / 1e6).toFixed(1)} MB → ${opt.protocol}://${opt.user || '?'}@${opt.host || '?'}/${opt.dir}`);
for (const f of files) console.log(`  ${f.local.padEnd(28)} → ${opt.dir}/${f.remote}`);
console.log('Nothing is deleted on the server; api/config.php and rmzoo-data/ are not touched.');
if (dry) { console.log('(dry run: nothing uploaded)'); process.exit(0); }

// ---- upload --------------------------------------------------------------------
if (opt.protocol === 'ftp') {
  const password = process.env.RMZOO_FTP_PASSWORD || await askHidden(`FTP password for ${opt.user}@${opt.host}: `);
  // the configuration (with the password) goes through stdin, not the command line
  const r = spawnSync('curl', ['-K', '-'], { input: curlConfig(files, { ...opt, password }) + 'fail-early\n', stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error(`curl failed (exit ${r.status}).${opt.tls ? ' If the server does not support TLS (OVH does not), use --protocol sftp rather than --no-tls, which sends the password in clear.' : ''}`); process.exit(1); }
} else {
  // commands through stdin (not `-b`, whose batch mode forbids password prompts):
  // ssh asks the password on the terminal; the last command lists what is online
  const cmds = sftpBatch(files, opt) + `ls -l ${opt.dir}/js\nbye\n`;
  const r = spawnSync('sftp', ['-o', 'ConnectTimeout=20', `${opt.user}@${opt.host}`], { input: cmds, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error(`sftp failed (exit ${r.status}).`); process.exit(1); }
}
console.log('✓ uploaded. Check https://rmzoo.ludovicpatey.com/ (reload without cache) and api/index.php?a=state.');

function askHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { console.error('No terminal to ask the password: set RMZOO_FTP_PASSWORD.'); process.exit(1); }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let s = '';
    const on = (ch) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); resolve(s); }
      else if (ch === '\u0003') { stdout.write('\n'); process.exit(130); }
      else if (ch === '\u007f') s = s.slice(0, -1);
      else s += ch;
    };
    stdin.on('data', on);
  });
}
