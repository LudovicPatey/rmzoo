# Full texts uploaded by researchers

Researchers signed in with ORCID on the live instance can share the PDFs of papers
(their own, or papers they may share) so that the maintainer can analyze their results:
mine them (`scripts/mine/`) and have the AI reader read them (`scripts/ai-analyze.mjs`).
This complements the automatic sources of `scripts/fulltext.mjs` (Zotero, arXiv, open
access, authors' pages) for papers that are behind paywalls.

**The files are private.** They are stored outside the web root of the server, never
published, and read only by the maintainer's `scripts/uploads-sync.mjs`, which copies them
into the git-ignored `cache/fulltext/`. They are never committed. Uploaders confirm that
they are authors of the papers or otherwise allowed to share the files with the maintainer
for this purpose, and can remove them at any time.

## In the viewer

* The **Full texts** tab of one's profile (`#/u/<orcid>?tab=texts`; `#/uploads` leads there;
  the other tab lists one's endorsements) has a drop zone for PDF
  files. Each file is attached to a paper of the database (guessed from the file name,
  chosen in a list of the papers), or described in a few words (title, authors, year, DOI
  or arXiv id) when the paper is not in the database. Files are uploaded after the
  confirmation box is ticked.
* The same page lists one's uploads: **replace** a file (button, or drop the new PDF on its
  row) or **remove** it.
* It also lists the papers of the database without a full text of which the signed-in
  person is an author: one of the paper's zbMATH authors (`zbmathAuthors`, written by
  `scripts/zbmath.mjs`) has their ORCID iD in its zbMATH profile (`data/authors.yaml`); not if
  a zbMATH author of the paper with their surname has another ORCID iD (someone else);
  otherwise by the surname and first initial in the reference's author list. Each can be uploaded, or marked **not my
  paper** or **not allowed to share**: it then leaves the list (a collapsed list of the papers
  set aside allows to undo).
* A **bell** next to the account button counts these papers (not yet uploaded nor set aside)
  and opens the Full texts tab.
* The page of a paper without a full text shows a drop zone for its PDF to signed-in
  researchers.
* The code: `viewProfile`, `loadUploads`, `paperUploadPanel` in `site/js/app.js`; `listUploads`, `upload`,
  `removeUpload` in `site/js/community.js`.

## On the server (`site/api/`)

| action | |
|---|---|
| `GET ?a=uploads` | the signed-in person's uploads (no checksums or paths) |
| `POST ?a=upload` | multipart: `file` (a PDF), `ref` (a reference key) or `citation`, `rights=1`, `replace=<id>` to replace one's own file; CSRF header as for the other writes |
| `POST ?a=unupload` | `{id}`: removes one's own upload and its file |
| `POST ?a=dismiss` | `{ref, reason: not-author \| not-allowed \| null}`: sets aside a paper of the bell (null: undo); `GET ?a=uploads` returns them as `dismissed` |
| `GET ?a=uploads-export` | admin token: the index of all uploads |
| `GET ?a=upload-file&id=<id>` | admin token: one file |

Storage: `data_dir/uploads/index.json` (`[{id, orcid, name, ref?, citation?, filename, size,
sha256, date, replaced?}]`), `data_dir/uploads/<id>.pdf`, and the papers set aside
`data_dir/uploads/dismissed.json` (`{orcid: {ref: {reason, date}}}`). Limits in `api/config.php`:
`upload_max_mb` (default 40; PHP's `upload_max_filesize` and `post_max_size` must allow
it: on OVH shared hosting, set them in the hosting's PHP configuration or a `.user.ini`
in `api/`) and `uploads_per_day` (default 50 per person). Only PDFs are accepted (checked
by their first bytes); the same file cannot be uploaded twice by the same person.

## Importing the files

```bash
RMZOO_ADMIN_TOKEN=… node scripts/uploads-sync.mjs [--dry-run]
```

* A file attached to a paper becomes `cache/fulltext/<key>.pdf` and `.txt` (source
  `upload` in `cache/fulltext/index.json`) and the paper's reading status becomes
  `read: pdf-author`, unless the cache already has a text of the paper from another source
  (the upload is then kept in `cache/uploads/`).
* A replaced file is imported again; a removed upload is taken out of the cache.
* A file about a paper that is not in the database is saved as `cache/uploads/<id>.pdf` and
  listed: add the reference (README, "Adding a paper"), attach the file by hand (copy it to
  `cache/fulltext/<key>.pdf`, as for the authors' pages in the README) and continue.
* Then mine the new texts (`node scripts/mine/facts.mjs --only <keys>`) or have them read
  (`node scripts/ai-analyze.mjs --only <keys>`).
