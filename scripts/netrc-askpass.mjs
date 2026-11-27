#!/usr/bin/env node
// The password prompt of ssh and sftp, answered from ~/.netrc, so that `node scripts/deploy.mjs` and `scripts/backup.mjs` need no typing. ssh runs it as SSH_ASKPASS
// with the text of its prompt; NETRC_HOST and NETRC_LOGIN name the entry to use. It answers a password prompt only: a question such
// as "Are you sure you want to continue connecting?" for an unknown host key gets no answer, so ssh stops rather than trust a new
// host. The password goes to ssh through a pipe: never on a command line, in the environment or in a log.
import { netrcEntry, readNetrc } from './lib/netrc.mjs';

const prompt = process.argv[2] || '';
if (prompt === '--help') {
  console.log('usage: SSH_ASKPASS=scripts/netrc-askpass.mjs NETRC_HOST=H NETRC_LOGIN=L ssh … (run by ssh with its prompt; see scripts/lib/netrc.mjs)');
  process.exit(0);
}
if (!/password/i.test(prompt) || !process.env.NETRC_HOST) process.exit(1);
let text;
try { text = readNetrc(); } catch { process.exit(1); }
const entry = text && netrcEntry(text, process.env.NETRC_HOST, process.env.NETRC_LOGIN);
if (!entry) process.exit(1);
process.stdout.write(entry.password + '\n');
