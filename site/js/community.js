// Endorsements and comments (docs/ENDORSEMENTS.md).
//
// On the live instance, the PHP server in site/api/ answers api/index.php?a=state:
// who is signed in (ORCID), the CSRF token and the current endorsements. On a
// static copy (GitHub, scripts/serve.mjs) there is no server: the endorsements
// committed in data/endorsements.yaml (copied into zoo.json) are shown, and
// signing in is not offered.
//
// Endorsements refer to results by their key (`_key` in zoo.json, resultKey in
// scripts/lib/schema.mjs).

const API = 'api/index.php';

export function createCommunity(zoo) {
  const c = {
    live: false, user: null, csrf: '', people: {}, list: [],
    byResult: new Map(), // result key → [{orcid, date}]
    byPerson: new Map(), // orcid → [{result, date}]
  };
  const index = (people, list) => {
    c.people = people || {};
    c.list = list || [];
    c.byResult = new Map();
    c.byPerson = new Map();
    for (const e of c.list) {
      if (!c.byResult.has(e.result)) c.byResult.set(e.result, []);
      c.byResult.get(e.result).push({ orcid: e.orcid, date: e.date });
      if (!c.byPerson.has(e.orcid)) c.byPerson.set(e.orcid, []);
      c.byPerson.get(e.orcid).push({ result: e.result, date: e.date });
    }
  };
  index(zoo.raw.endorsements?.people, zoo.raw.endorsements?.endorsements);

  // try the server; a static host returns no JSON (404, or the PHP source)
  c.ready = fetch(`${API}?a=state`, { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null))
    .then((s) => {
      if (!s || !Array.isArray(s.endorsements)) return;
      c.live = true;
      c.user = s.user;
      c.csrf = s.csrf;
      index(s.people, s.endorsements);
    })
    .catch(() => {});

  const post = async (action, body) => {
    const r = await fetch(`${API}?a=${action}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': c.csrf },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
    if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
    return j;
  };

  c.endorsers = (key) => c.byResult.get(key) || [];
  c.name = (orcid) => c.people[orcid]?.name || orcid;
  c.endorsedByMe = (key) => !!c.user && c.endorsers(key).some((e) => e.orcid === c.user.orcid);
  c.setEndorsement = async (key, on) => {
    const s = await post('endorse', { result: key, endorse: on });
    index(s.people, s.endorsements);
  };
  // kind: error | comment; target: {type: result|statement|reference|question|general, id}
  c.sendFeedback = (kind, target, text) => post('feedback', { kind, target, text, page: location.hash });
  c.loginUrl = () => `${API}?a=login&back=${encodeURIComponent(location.hash.slice(1) || '/')}`;
  c.logoutUrl = () => `${API}?a=logout&back=${encodeURIComponent('/')}`;
  return c;
}
