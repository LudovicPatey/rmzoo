# Backup and restoration

GitHub holds the data (`data/`), the code, the reports and the built site. Two other
things exist only in one place, and `scripts/backup.mjs` saves and restores them.

* **This checkout's untracked files**: everything `git ls-files --others` lists,
  except `node_modules/`, `.DS_Store` and `cache/.data-lock`. It includes:
  * `cache/fulltext/`: the full texts. Some come from authors' pages or from
    uploads and are hard to find again.
  * `cache/ai/`: the AI readings, which were paid for.
  * `cache/books/`.
  * The state and settings files of the scripts: `deploy.json`, `admin-token`,
    `consolidation-state.json`, the miners' caches and others.
  * `feedback/`: the messages from the website and the drafted answers.
  * `site/api/config.php`.
  * Any other untracked file.
* **The live server's data**, outside git by design:
  * `rmzoo-data/`, next to the site's directory:
    * `endorsements.json`: people, endorsements, votes and comments.
    * `feedback/`: one file per message, with its answers.
    * `uploads/`: the PDFs shared by researchers and their index.
    * `diagrams/`: the saved diagrams.

    The PHP sessions are left out.
  * The server's `api/config.php`, which holds the ORCID secret and the admin token.

  `endorsements-sync.mjs` and `uploads-sync.mjs` copy part of this into the
  repository: the endorsements go to `data/endorsements.yaml`, the messages to
  `feedback/` and the PDFs to `cache/fulltext/`. They do not copy the diagrams, the
  raw comments or the configuration, and their copies are not in a form the server
  can read back. Only the backup restores the server as it was.

These files are private: copyrighted texts, private messages, secrets. Put the
backups on a disk you control, such as an external disk or an encrypted volume. Never
put them in a public or shared folder, and never in the repository (the script
refuses that).

## Snapshots

```
node scripts/backup.mjs                      # local files and server data
node scripts/backup.mjs --no-server          # local files only (no password asked)
node scripts/backup.mjs --keep 10            # then remove all but the 10 newest
node scripts/backup.mjs --dry-run            # what would be saved, and the sftp commands
node scripts/backup.mjs --list               # the snapshots
node scripts/backup.mjs --verify [SNAPSHOT]  # check the contents against the manifest
```

* **Destination**: `--dest DIR`, else `"dest"` in `cache/backup.json`
  (`{ "dest": "/Volumes/Backup/rmzoo" }`), else `~/Backups/rmzoo`.
* **Snapshot layout**: a snapshot is a directory `<dest>/<YYYYMMDDTHHMMSSZ>/`. It
  holds:
  * `local/<path>`;
  * `server/data/<path>`;
  * `server/config.php`;
  * `manifest.json`, which records the size and SHA-256 of each file, the commit
    of the checkout and the parts saved.
* **Incomplete snapshots**: the manifest is written last, and the directory is
  renamed from `.partial` only then. A `<stamp>.partial` directory is an interrupted
  run: it is never used and is safe to delete.
* **Hard links**: a file identical to the one in the previous snapshot is a hard
  link to it. A snapshot therefore costs only what changed, about 2 s for the
  850 MB of `cache/`, and each snapshot is still complete on its own. Never edit
  a file inside a snapshot: the edit would change every snapshot that shares it.
* **Server access**: the server is reached with OpenSSH `sftp` and the settings of
  `cache/deploy.json` (`host`, `user`, `dir`). If the server's `config.php` moves
  `data_dir`, add `"dataDir"` there. `ssh` asks the password on the terminal; with
  an SSH key installed on the host, it does not. The server part only downloads.
* **Data lock**: the script refuses to run while a script holds the data lock
  (`cache/.data-lock`), because a consolidation is rewriting the files.

A routine: run `node scripts/backup.mjs` before and after each consolidation and
each deployment, and at least weekly. With an SSH key, a weekly `launchd` or `cron`
job can do it. Keep one snapshot on a second disk too, for example by copying the
latest snapshot directory.

## Restoration

```
node scripts/backup.mjs --restore [SNAPSHOT|latest] --local [--only PATH] [--overwrite] [--dry-run]
node scripts/backup.mjs --restore [SNAPSHOT|latest] --server [--only PATH] [--config] [--dry-run]
```

Always run with `--dry-run` first: it says what would change.

**Local** (`--local`):
* **What is restored**:
  * Files missing from the checkout are restored, as copies, never as links into
    the backup.
  * Identical files are left alone.
  * Files that differ are kept, unless `--overwrite` is given. In that case, a
    snapshot of the current local files is taken first, so the overwrite can be
    undone.
  * Files absent from the snapshot are never deleted.
* **`--only`** limits the restore to a path, e.g. `--only cache/ai` or
  `--only feedback/inbox/x.json`.
* **Checks**: the files to restore are first checked against the manifest; a
  damaged snapshot is refused (use an older one). The restore is also refused
  while a script holds the data lock.

**Server** (`--server`):
* **Safety snapshot**: first, a snapshot of the server as it is now is taken (one
  sftp session). Then the snapshot's files are uploaded (a second session, so the
  password may be asked twice).
* **What is overwritten**: server files with the same name are replaced; other
  files on the server are kept, and nothing is deleted.
* **`--only`** is relative to the data directory, e.g. `--only diagrams` or
  `--only endorsements.json`.
* **`--config`**: `api/config.php` is uploaded only with this flag. A config.php
  restored from an old snapshot may hold an old admin token or ORCID secret.
* **Afterwards**: check `https://rmzoo.ludovicpatey.com/api/index.php?a=state`, then
  run `endorsements-sync.mjs`.

## From nothing (a new machine)

1. `git clone` the repository, then `npm ci`.
2. Restore the local files from the backup disk (there is no `cache/backup.json`
   yet, so give `--dest`):
   `node scripts/backup.mjs --dest /Volumes/Backup/rmzoo --restore latest --local`.
3. `npm run check && npm run build && npm test`.
4. Zotero (`~/Zotero`, read-only for this project) has its own sync; `fulltext.mjs`
   copies from it again if needed.

A new server: create the site's directory and deploy (`node scripts/deploy.mjs`), then
`node scripts/backup.mjs --restore latest --server --config`. Then follow the ORCID
redirect URI step of docs/ENDORSEMENTS.md if the address changed.

Code: `scripts/backup.mjs` (commands), `scripts/lib/backup.mjs` (snapshot, manifest,
links, plans, sftp commands), tests in `tests/backup.test.mjs`.
