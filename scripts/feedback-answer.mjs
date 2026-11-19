// Send the answers to the messages of the live instance (comments, error reports,
// suggestions: docs/ENDORSEMENTS.md, "Answers"). Each message downloaded by
// scripts/endorsements-sync.mjs is a file feedback/{inbox,done}/<id>.json (git-ignored);
// an answer is drafted in it as
//   "reply": { "text": "…", "by": "ai" | "maintainer" }
// (by: ai when an AI assistant wrote it; the maintainer reads it before sending).
// This script posts every drafted reply not sent yet (not among the file's `answers`: to
// answer again, replace `reply`), records "replied": <date> and the answers in the
// file, and the author sees the answer under the message on their profile (the bell
// signals it). --dry-run lists what would be sent; --only <id> sends one.
//
//   RMZOO_ADMIN_TOKEN=… node scripts/feedback-answer.mjs [--url URL] [--dry-run] [--only id]
//
// The token is the admin_token of the server's api/config.php; it can also be kept in
// cache/admin-token (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { cli } from './lib/cli.mjs';

const args = cli('RMZOO_ADMIN_TOKEN=… node scripts/feedback-answer.mjs [--url https://rmzoo.ludovicpatey.com] [--dry-run] [--only <message id>]',
  { '--url': 1, '--dry-run': 0, '--only': 1 });
const url = args.get('--url', process.env.RMZOO_URL || 'https://rmzoo.ludovicpatey.com').replace(/\/$/, '');
const dry = args.has('--dry-run');
const only = args.get('--only', '');

const files = ['feedback/inbox', 'feedback/done'].filter((d) => fs.existsSync(d))
  .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => path.join(d, f)));
const todo = [];
for (const f of files) {
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  // a reply not yet among the message's answers (a later answer replaces `reply`)
  if (!m.reply?.text || (m.answers || []).some((a) => a.text === m.reply.text) || (only && m.id !== only)) continue;
  if (!['ai', 'maintainer'].includes(m.reply.by || 'maintainer')) { console.error(`${f}: reply.by must be ai or maintainer`); process.exit(1); }
  todo.push({ f, m });
}
if (!todo.length) { console.log('No answer to send.'); process.exit(0); }

for (const { m } of todo) {
  console.log(`— to ${m.author?.name} (${m.kind} of ${String(m.date).slice(0, 10)}, ${m.id})${m.reply.by === 'ai' ? ' [drafted by AI]' : ''}`);
  console.log(`  ${m.reply.text.replace(/\n/g, '\n  ')}`);
}
if (dry) { console.log(`\n${todo.length} answer(s) would be sent (dry run).`); process.exit(0); }

const token = process.env.RMZOO_ADMIN_TOKEN || (fs.existsSync('cache/admin-token') ? fs.readFileSync('cache/admin-token', 'utf8').trim() : '');
if (!token) { console.error('No admin token: set RMZOO_ADMIN_TOKEN or write it to cache/admin-token.'); process.exit(1); }
let sent = 0;
for (const { f, m } of todo) {
  const res = await fetch(`${url}/api/index.php?a=answer`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: m.id, text: m.reply.text, by: m.reply.by || 'maintainer' }),
  });
  if (!res.ok) { console.error(`${m.id}: ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const j = await res.json();
  m.replied = new Date().toISOString();
  m.answers = j.answers;
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n');
  sent++;
}
console.log(`\n${sent} of ${todo.length} answer(s) sent.`);
if (sent < todo.length) process.exit(1);
