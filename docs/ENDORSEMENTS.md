# Endorsements and comments

Researchers sign in on the live instance (rmzoo.ludovicpatey.com) with their
ORCID iD. Once signed in they can:

* **endorse** a result: “I have read the proof of this result and believe it is
  correct”. A result endorsed by one person shows a bronze ✓, by several a gold
  ✓ with the count; clicking it lists the endorsers. Endorsements can be
  withdrawn at any time;
* **report an error** or **comment** on a result, a statement or a paper. Each
  message becomes one JSON file for the maintainer (not published);
* see their **profile** page `#/u/<ORCID iD>`, which lists the results they
  endorsed (every profile is public; `#/u/me` goes to one's own).

The static copy of the zoo (GitHub, `scripts/serve.mjs`) shows the endorsements
committed in `data/endorsements.yaml` and offers no sign-in.

## How it works

| part | file |
|------|------|
| server (PHP 7.4+, no dependencies, runs on OVH shared hosting) | `site/api/index.php` (actions), `callback.php` (ORCID redirect), `lib.php` |
| server configuration (on the server only, never committed) | `site/api/config.php`, from `config.example.php` |
| viewer: state, marks, result panel, comment form, profile | `site/js/community.js`, `site/js/app.js` (section "endorsements and comments") |
| committed endorsements | `data/endorsements.yaml` (validated by the build, copied into `zoo.json`) |
| download from the server | `scripts/endorsements-sync.mjs` |
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
  their ORCID record) only when they endorse a result, and forgets them when
  they withdraw their last endorsement. Comments are stored with the author's
  iD and name and never published.
* **Security**: sign-in uses ORCID's OAuth (`/authenticate` scope: only the iD
  and name). The session cookie is HttpOnly and SameSite=Lax; every write also
  needs the CSRF token of the session (header `X-CSRF-Token`). Comments are
  limited to 10,000 characters and 30 per person and day (`feedback_per_day`).
  The export of all data needs the admin token. `<data_dir>` must be outside the
  web root (the default is two levels above `api/`).

## Setting up the live instance

1. **HTTPS.** Enable the free SSL certificate of the OVH hosting
   (Hébergement → Multisite → SSL) and redirect http to https: the sign-in
   cookie must not travel in clear.
2. **Register an ORCID client.** Sign in at orcid.org → *Developer tools* →
   register a public API client, with the redirect URI
   `https://rmzoo.ludovicpatey.com/api/callback.php`. Note the client id and
   secret. (To try first, ORCID's sandbox, sandbox.orcid.org, works the same
   way: set `orcid_base` in the configuration.)
3. **Deploy** `site/` as usual (it now contains `site/api/`, with its
   `.htaccess`).
4. **Configure** on the server: copy `api/config.example.php` to
   `api/config.php` and fill in the client id and secret and an admin token
   (`php -r 'echo bin2hex(random_bytes(24)), "\n";'`). Keep `data_dir` outside
   `www/` (the default `../../rmzoo-data` relative to `api/` is next to `www/`).
   Never upload a `config.php` with `dev_login`.
5. **Check**: `https://rmzoo.ludovicpatey.com/api/index.php?a=state` returns
   JSON; the header of the site shows “Sign in”.

## Routine: committing endorsements, treating comments

```bash
RMZOO_ADMIN_TOKEN=… node scripts/endorsements-sync.mjs        # or put the token in cache/admin-token
npm run check && npm run build && npm test
git add data/endorsements.yaml && git commit -m "Endorsements"
```

The sync takes the data lock, rewrites `data/endorsements.yaml` and saves each
new comment or error report as `feedback/inbox/<id>.json` (git-ignored). Each
file is self-contained for processing with an AI assistant: `kind` (error |
comment), `target` (type, id and a copy of the result, statement or paper it is
about), `text`, `author` (ORCID iD, name), `page`, `date`. Treat a report like
any lead (AGENTS.md §1: read the theorem in the paper before changing data),
then move the file to `feedback/done/`; files in `inbox/` or `done/` are never
downloaded again. `--dry-run` shows what would change.

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
