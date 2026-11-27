// Credentials from a netrc file (~/.netrc, mode 600), so that `node scripts/deploy.mjs` and `scripts/backup.mjs` need no typing. Without dependency, to be tested.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The entries of a netrc file: `machine H login L password P`, and `default`. Comments start with #. */
export function parseNetrc(text) {
  const tokens = String(text || '').replace(/#.*$/gm, '').split(/\s+/).filter(Boolean);
  const entries = []; let current = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'machine') { current = { machine: tokens[++i] }; entries.push(current); }
    else if (t === 'default') { current = { machine: null }; entries.push(current); }
    else if (current && ['login', 'password', 'account'].includes(t)) current[t] = tokens[++i];
    else if (t === 'macdef') break; // macros end the part we read
  }
  return entries;
}

/**
 * The entry for a host: the one naming it, else one with the same login (OVH answers one server under two names, such as
 * ftp.cluster015.ovh.net and ftp.cluster015.hosting.ovh.net), else `default`. Only entries with a password count.
 */
export function netrcEntry(text, host, login) {
  const all = parseNetrc(text).filter((e) => e.password);
  return all.find((e) => e.machine === host) || (login ? all.find((e) => e.machine && e.login === login) : null) || all.find((e) => e.machine === null) || null;
}

/**
 * What ssh and sftp need to take the password of ~/.netrc for this host or login, through scripts/netrc-askpass.mjs: the environment,
 * and one try only, so that a wrong password is not sent three times. Without an entry, ssh asks in the terminal as before.
 * @return {{env: object, args: string[], machine: ?string}}
 */
export function sshPassword(host, login) {
  const entry = netrcEntry(readNetrc() || '', host, login);
  if (!entry) return { env: process.env, args: [], machine: undefined };
  const askpass = path.resolve(import.meta.dirname, '..', 'netrc-askpass.mjs');
  return { env: { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', NETRC_HOST: host, NETRC_LOGIN: login },
    args: ['-o', 'NumberOfPasswordPrompts=1'], machine: entry.machine ?? 'default' };
}

/** ~/.netrc, or null when there is none. A file others can read is refused, as ftp and curl do. */
export function readNetrc(file = path.join(os.homedir(), '.netrc')) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error(`${file} can be read by others: run chmod 600 ${file}`);
  return fs.readFileSync(file, 'utf8');
}
