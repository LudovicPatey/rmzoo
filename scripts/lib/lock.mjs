// One writer at a time: scripts that rewrite data/ files take this lock, so that
// two of them cannot overwrite each other's changes. A run of consolidate.mjs
// holds it for its whole duration and passes it on to the scripts it calls.
import fs from 'node:fs';

const LOCK = 'cache/.data-lock';
export function acquireLock(name) {
  if (process.env.RMZOO_LOCK_HELD === '1') return;
  fs.mkdirSync('cache', { recursive: true });
  if (fs.existsSync(LOCK)) {
    const { pid, name: who } = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* stale lock */ }
    if (alive) { console.error(`${who} (pid ${pid}) is modifying the data; wait for it to finish.`); process.exit(2); }
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, name, since: new Date().toISOString() }));
  const release = () => { try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.rmSync(LOCK); } catch { /* gone */ } };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { release(); process.exit(130); });
  process.env.RMZOO_LOCK_HELD = '1'; // inherited by child processes
}
