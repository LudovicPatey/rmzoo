# Watchlists

A person follows principles with **filters**; the viewer shows the facts that appeared since
they last looked, on the Watchlist page (`#/watch`) and as a count next to "Watchlist" in the
menu. Nothing is sent by e-mail: the notification is shown at the next visit.

## Filters

Written in a small language, with statement names as in the search field and reductions as in
query mode (`W`, `sW`, `c`, `ω-models`, `RCA0`, …; several separated by commas):

| filter | what it follows |
|--------|-----------------|
| `RT22 vs COH over W, c` | every relation (implication or separation, both directions) between the statements |
| `RT22 vs any over W` (or just `RT22`) | every relation of RT²₂ with any statement (minor ones excepted) |
| `properties of RT22, SRT22` | every known value of a property of these statements |
| `cone avoidance of EM` | one property |
| `results on DS` | every entry of the database naming DS (published, AI-derived, contributed) |
| `questions on COH` | the status of the recorded questions about COH |
| `about KPT` | all of the above for KPT (the "Watch" button of a statement's page adds it) |

Facts are those the engine derives, so a new published result shows up through everything it
implies. Each fact has a key (`I|w|rt22|coh`: COH ≤W RT²₂; `P|cone-avoidance|em|true`;
`R|<result key>`; `Q|<question>|<status>`). Adding a filter marks what it matches now as seen;
"Mark as seen" does the same later. New facts are the keys not seen.

## Storage

* Signed in with ORCID on the live instance: on the server, `<data_dir>/watch/<orcid>.json`,
  private to its owner (`GET`/`POST ?a=watch`, `site/api/index.php`). A filter is
  `{id, text, created, seen}`, `seen` being short hashes of the keys (`keyHash`); at most 100
  filters and 3 MB per person (`watch_max`, `watch_bytes` in the server's configuration).
  Backed up with the rest of the server's data (docs/BACKUP.md).
* Otherwise (signed out, static copy): in the browser (`localStorage`). Filters kept in a browser
  join the account's at the next sign-in.

## Code

`site/js/watch.js` (language, matching, seen sets; tests in `tests/watch.test.mjs`),
`site/js/community.js` (`loadWatch`, `saveWatch`), `site/js/app.js` (`viewWatch`, the count,
the Watch button), server actions in `site/api/index.php` and `with_watch` in
`site/api/lib.php` (tests in `tests/api.test.mjs`).

When the data model changes (a new kind of fact, a renamed id), keys of old facts may change
and show again as new once: acceptable, but worth knowing.
