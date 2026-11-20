# Endorsements and comments

Researchers sign in on the live instance (rmzoo.ludovicpatey.com) with their
ORCID iD. Once signed in they can:

* **endorse** a result: “I have read the proof of this result and believe it is
  correct”. A result endorsed by one person shows a green ✓, by several a bronze
  ✓ with the count; clicking it lists the endorsers. Endorsements can be
  withdrawn at any time;
* endorse the results a proof relies on **from the diagram**: the panel of a pair
  (click an edge, or answer a query) lists the results used, each with an
  Endorse button. An arrow whose proof uses only endorsed results carries a check
  at its middle (green: each endorsed, bronze: each by several readers);
* **report an error** or **comment** on a result, a statement or a paper. Each
  message becomes one JSON file for the maintainer (not published);
* **contribute facts** (“+ Facts” in the header, “Contribute facts” on a
  statement page, the link of an open pair, “Answer with facts” on an open
  question): a modal box where facts are typed in the query language of the
  search field (`RT22 ≤c BRT32`, `SRT22 ⇏ COH over ω-models`, `Does RT12 admit
  cone avoidance?`), stacked in a list with the database's current status of
  each, and given a source (a paper of the references and where in it, or a
  citation) and/or a justification. The draft is kept in the browser until it is
  sent. The suggestion is a private message to the maintainer; after the sync each
  fact becomes a pending `result` item of the review page (origin `contributed`,
  docs/REVIEW.md), where researchers check it publicly;
* **discuss an open question** on its page: public comments, with name and ORCID
  iD, that anyone can read (the author can delete them);
* see their **profile** page `#/u/<ORCID iD>`, with a side menu of sections:
  Endorsements and Public comments (questions, review page) on every profile
  (every profile is public; `#/u/me` goes to one's own); on one's own profile
  also an Overview (what waits: new answers, papers without a full text),
  Messages, Diagrams and Full texts (docs/UPLOADS.md), all private. Messages is a
  mail box: one conversation per message (the message, the maintainer's answers
  and one's replies, oldest first; a contributed fact shows what the database
  now knows of it), folders All / Unread / Awaiting answer / Answered, a filter
  by kind, a search, a composer under each conversation and “New message” for a
  message about the zoo in general. Read state is kept per conversation in the
  browser (`rmzoo.threadsSeen`). Sections and conversations have their own
  links: `?tab=messages&thread=<message id>` (`?tab=contributions`, the former
  name, still works);
* **validate, invalidate and comment** the proposals of the review page (public
  votes and comments, docs/REVIEW.md);
* **save diagrams** (“My diagrams” on the diagram page): the current diagram
  under a name, to reopen or delete later, also listed on the Diagrams tab of
  their own profile. Saved diagrams are private (below).

The static copy of the zoo (GitHub, `scripts/serve.mjs`) shows the endorsements
committed in `data/endorsements.yaml` and offers no sign-in.

## How it works

| part | file |
|------|------|
| server (PHP 7.4+, no dependencies, runs on OVH shared hosting) | `site/api/index.php` (actions), `callback.php` (ORCID redirect), `lib.php` |
| server configuration (on the server only, never committed) | `site/api/config.php`, from `config.example.php` |
| viewer: state, marks, result panel, comment form, profile | `site/js/community.js`, `site/js/app.js` (section "endorsements and comments") |
| saved diagrams: viewer | `site/js/community.js` (`listDiagrams`, `saveDiagram`, `deleteDiagram`), `site/js/app.js` (“My diagrams”, after `viewDiagram`; the Diagrams tab of `viewProfile`) |
| committed endorsements | `data/endorsements.yaml` (validated by the build, copied into `zoo.json`) |
| download from the server | `scripts/endorsements-sync.mjs` |
| answers to messages | `scripts/feedback-answer.mjs` (server: `?a=answer`; viewer: `myThreads`, `mailHtml`, `threadHtml` in `site/js/app.js`, the bell of `renderAccount`) |
| tests | `tests/api.test.mjs` (runs the PHP server locally) |

* **Identity of a result**: endorsements refer to `resultKey` (type, statements,
  reduction or class, value; `scripts/lib/schema.mjs`), stored by the build as
  `_key` in `zoo.json`. Merging a citation into a result keeps its key. Changing
  what a result says (direction, reduction, value) changes its key: the
  endorsements of the old form are not carried over, since the endorsers read a
  proof of a different claim. The build lists them as warnings and profiles
  mention them.
* **The server is authoritative for endorsements.** On its first start it
  copies the committed ones (from `zoo.json`); afterwards it keeps its own state
  in `<data_dir>/endorsements.json`. `endorsements-sync.mjs` replaces
  `data/endorsements.yaml` by that state.
* **Privacy**: the server records a person (ORCID iD and the name public on
  their ORCID record) only when they endorse a result, vote or comment on the
  review page, and forgets them when they withdraw the last of these. Comments are stored with the author's
  iD and name and never published.
* **Security**: sign-in uses ORCID's OAuth (`/authenticate` scope: only the iD
  and name). The session cookie is HttpOnly and SameSite=Lax; every write also
  needs the CSRF token of the session (header `X-CSRF-Token`). Comments are
  limited to 10,000 characters and 30 per person and day (`feedback_per_day`).
  The export of all data needs the admin token. `<data_dir>` must be outside the
  web root (the default is two levels above `api/`).

## Saved diagrams

A saved diagram is exactly what the diagram's link holds: the statements in
the order of the selection, the reduction and the two toggles (separations,
open questions); not the zoom, nor the bases selected in the header. The server keeps
them in `<data_dir>/diagrams/<ORCID iD>.json`
(`[{id, name, s, r, sep, open, date, updated?}]`, `with_diagrams` in
`lib.php`), one file per person, deleted with their last diagram.

* `GET ?a=diagrams` lists one's own, newest first; `POST ?a=diagram`
  `{name, s, r, sep, open}` saves the current one (a diagram with the same name,
  ignoring case, is replaced and keeps its id; the viewer asks first), and
  `{delete: id}` removes one. Both answer the new list. Writes need the session
  and its CSRF token, as for endorsements.
* The statements and the reduction must exist in `zoo.json` (a page older than
  the last deploy is told to reload); names have at most 100 characters, a
  diagram at most 500 statements, a person at most 200 diagrams
  (`diagrams_max` in the configuration).
* **Private**: only their owner lists them; they are not in `?a=state` nor in
  the admin export, and `endorsements-sync.mjs` does not download them. A
  diagram is shared by its link (“Copy link”). Saving one does not record the
  person among the endorsers.
* A statement later removed from the database is skipped when the diagram is
  opened (the list says how many are no longer in the zoo).

## Setting up the live instance

1. **HTTPS.** Enable the free SSL certificate of the OVH hosting
   (Hébergement → Multisite → SSL) and redirect http to https: the sign-in
   cookie must not travel in clear.
2. **Register an ORCID client.** Sign in at orcid.org → *Developer tools* →
   register a public API client, with the redirect URI
   `https://rmzoo.ludovicpatey.com/api/callback.php`. Note the client id and
   secret. (To try first, ORCID's sandbox, sandbox.orcid.org, works the same
   way: set `orcid_base` in the configuration.)
3. **Deploy** with `node scripts/deploy.mjs` (below), which uploads the
   viewer and `api/` (with its `.htaccess`).
4. **Configure** on the server: copy `api/config.example.php` to
   `api/config.php` and fill in the client id and secret and an admin token
   (`php -r 'echo bin2hex(random_bytes(24)), "\n";'`). Keep `data_dir` outside
   `www/` (the default `../../rmzoo-data` relative to `api/` is next to `www/`).
   Never upload a `config.php` with `dev_login`.
5. **Check**: `https://rmzoo.ludovicpatey.com/api/index.php?a=state` returns
   JSON; the header of the site shows “Sign in”.

## Deploying

```bash
npm run check && npm run build && npm test
node scripts/deploy.mjs --dry-run     # the list of files and where they go
node scripts/deploy.mjs               # asks the FTP password (sftp)
```

The script uploads an explicit list of files from `site/` (`scripts/lib/deploy.mjs`):
`index.html`, `htaccess.txt` as `.htaccess` (http → https), `css/`, `js/`,
`data/zoo.json`, `data/abstracts.json`, `data/review.json`, and `api/` (`index.php`, `callback.php`,
`lib.php`, `.htaccess`, `config.example.php`). It never uploads a `config.php`
(a local one may have `dev_login`) or anything else from the repository
(`cache/` holds copyrighted texts and the admin token, `feedback/` private
messages), and it never deletes a file on the server: the server's
`api/config.php` and `rmzoo-data/` (endorsements, comments, sessions) are left
alone. It refuses to run when `data/` changed after the last build, and warns
about uncommitted changes (the live site would then differ from GitHub).
`rmzoo-data/` and `api/config.php` exist only on the server: back them up with
`node scripts/backup.mjs` (docs/BACKUP.md), which also restores them.

Settings in `cache/deploy.json` (git-ignored), from the OVH control panel
(Web hosting → FTP-SSH):

```json
{ "protocol": "sftp", "host": "ftp.cluster015.hosting.ovh.net", "user": "LOGIN", "dir": "www" }
```

`dir` is the folder of the site on the hosting (`www`, or the folder of the
multisite entry). `sftp` (the default) uses OpenSSH: OVH web hosting accepts it
with the FTP password, which ssh asks in the terminal (an SSH key works too).
`ftp` uses curl with TLS required, for hosts that support it: OVH's FTP server
does not, and plain FTP (`--no-tls`) would send the password in clear. Upload
by hand only the same files.

## Routine: committing endorsements, treating comments

```bash
RMZOO_ADMIN_TOKEN=… node scripts/endorsements-sync.mjs        # or put the token in cache/admin-token
npm run check && npm run build && npm test
git add data/endorsements.yaml && git commit -m "Endorsements"
```

The sync takes the data lock, rewrites `data/endorsements.yaml` (endorsements,
people, and the public comments on the open questions under `discussions`),
copies the votes and comments of the review page into `data/review.yaml` (then
run `node scripts/review.mjs apply`, docs/REVIEW.md), adds each fact of a new
suggestion to `data/review.yaml` as a pending `result` item (origin
`contributed`, with `contributor`, `ref`/`loc` or `citation`, `argument`), and
saves each new comment, error report or suggestion as
`feedback/inbox/<id>.json` (git-ignored). Each file is self-contained for
processing with an AI assistant: `kind` (error | comment | suggestion), `target`
(type, id and a copy of the result, statement, paper or question it is about),
`text`, `facts` (suggestions: each with a copy of its statements, its `source`
and `justification`), `author` (ORCID iD, name), `page`, `date`. Treat a report like
any lead (AGENTS.md §1: read the theorem in the paper before changing data),
then move the file to `feedback/done/`; files in `inbox/` or `done/` are never
downloaded again. `--dry-run` shows what would change.

### Answers

The author of a message sees its answers in the conversation of the message, in
the Messages section of their profile; the bell of the header counts the answers
they have not seen and opens the first unread conversation. An
answer is drafted in the message's file, as
`"reply": {"text": "…", "by": "ai" | "maintainer"}` (`by: ai` when an AI
assistant wrote it: the viewer says so). The text may use `$…$` TeX and `[[id]]`
links to statements. The maintainer reads the drafts, then sends them:

```bash
node scripts/feedback-answer.mjs --dry-run     # what would be sent
node scripts/feedback-answer.mjs               # send (admin token as for the sync)
```

The server (`?a=answer`, admin token) appends the answer to the message's file
(`answers: [{date, text, by}]`; the same text twice is kept once), and the script
copies the answers into the local file, so an answer is never sent twice; to answer
the same message again, replace its `reply`. Under each conversation the author
finds a composer: the reply is a new comment with `replyTo: <message id>` (only on
one's own messages), downloaded by the sync like any message and answered the same
way; the profile shows it in the conversation. Like the
messages, answers are private to their author and never committed.

### Badges

Hovering (or focusing) a researcher's name anywhere in the viewer shows a card with
their badges, which are also shown under their name on their profile:

| badge | counted from |
|-------|--------------|
| facts entered | `data/credits.yaml`, kind `fact` (its `count`, default 1) |
| errors fixed | `data/credits.yaml`, kind `fix`: a wrong fact, citation, numbering or label corrected on their report |
| sources added | `data/credits.yaml`, kind `source`: a better or earlier source, or a simpler justification, on their remark |
| endorsements | their endorsements (server, or `data/endorsements.yaml`) |
| public comments | their comments on open questions and on the review page |
| full texts shared | the server's count of their uploads (`uploadCounts` in `?a=state`; live instance only, the files stay private) |

Only nonzero badges are shown. A profile with credits also has a Contributions
section listing each credit's note.

`data/credits.yaml` is public and committed: one entry per message and kind,
`{orcid, name, kind, date, note, message?, count?}` (entity `credit` in
`scripts/lib/schema.mjs`; the build validates it). Its `note` says what changed
in the database, in a sentence; it never quotes the private message.
- When a message is treated and changes the database, add its entry.
- `node scripts/review.mjs accept` adds one itself for a contributed fact; a
  second fact of the same message raises its `count`.
- The code is in `site/js/badges.js` (the counts), `badgesHtml` and
  `showUserCard` in `site/js/app.js`, and `scripts/lib/credits.mjs` (writing
  entries). It is tested in `tests/badges.test.mjs`.

### What is in git

The endorsements and the public comments on the open questions are committed in
`data/endorsements.yaml`; the votes and public comments of the review page in
`data/review.yaml`; what messages changed in the database (badges) in
`data/credits.yaml`. The private messages (comments, error reports, suggestions)
and their answers stay on the server and in `feedback/` (git-ignored).

## Local development

```bash
# a configuration outside the repository, with dev_login (sign in as any iD, from this machine only)
cat > /tmp/rmzoo-config.php <<'EOF'
<?php return ['orcid_client_id' => 'APP-TEST', 'orcid_client_secret' => 'x', 'admin_token' => 'local-admin-token-0123456789',
  'data_dir' => '/tmp/rmzoo-data', 'dev_login' => true];
EOF
RMZOO_CONFIG=/tmp/rmzoo-config.php php -S 127.0.0.1:8090 -t site
# then open http://127.0.0.1:8090/api/index.php?a=devlogin&orcid=0000-0002-1825-0097&name=Josiah%20Carberry
```
