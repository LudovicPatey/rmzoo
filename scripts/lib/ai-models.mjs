// Models the AI reader (scripts/ai-analyze.mjs) can use, their prices, and the
// order used by --upgrade (a second reading by a stronger model of the papers
// read by a weaker one).
//
// Prices in $ per million tokens (Claude API, November 2026; the cache write is
// the 1-hour TTL used for the catalogue). Haiku 5.5 has two rate cards chosen by
// the length of the prompt (cached part included).

export const MODELS = {
  haiku: {
    id: 'claude-haiku-5-5',
    rates: (promptTokens) => (promptTokens > 100000
      ? { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 1 }
      : { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 }),
    fallbacks: false, // no server-side fallback for Haiku 5.5: a decline stays declined
  },
  sonnet: {
    id: 'claude-sonnet-5-5',
    rates: () => ({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 }),
    fallbacks: true,
  },
  opus: {
    id: 'claude-opus-5-5',
    rates: () => ({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 }),
    fallbacks: true,
  },
};

// a short name or a full model id → the entry (unknown ids are refused: their
// price is unknown)
export function modelOf(name) {
  if (MODELS[name]) return { key: name, ...MODELS[name] };
  const k = Object.keys(MODELS).find((x) => MODELS[x].id === name);
  if (!k) throw new Error(`unknown model ${name} (one of ${Object.keys(MODELS).join(', ')})`);
  return { key: k, ...MODELS[k] };
}

// strength of the model recorded in data/ai-analyzed.yaml, by family (the served
// model may be another version, e.g. after a server-side fallback); 0 when unknown
export function modelRank(id) {
  const s = String(id || '');
  if (/fable|mythos/.test(s)) return 4;
  if (/opus/.test(s)) return 3;
  if (/sonnet/.test(s)) return 2;
  if (/haiku/.test(s)) return 1;
  return 0;
}

// the entry of the family of a recorded model id (e.g. claude-opus-5 → opus), or null
export function familyOf(id) {
  const k = Object.keys(MODELS).find((x) => String(id || '').includes(x));
  return k ? { key: k, ...MODELS[k] } : null;
}

// Ratio of the recorded costs (data/ai-analyzed.yaml) to the estimates for the same
// units: the estimate assumes ~15k output tokens, but papers with many facts produce
// much longer answers and verification calls. `estimate(entry, model)` gives the
// estimate of a recorded unit (null if its text is gone). The units read by the same
// family as `model` are used if there are at least 5, otherwise all units; 1 without data.
export function calibration(ledger, model, estimate) {
  const pairs = Object.entries(ledger).map(([uid, e]) => {
    const fam = familyOf(e.model);
    const est = fam && e.cost > 0 ? estimate(uid, fam) : null;
    return est ? { fam: fam.key, cost: e.cost, est } : null;
  }).filter(Boolean);
  const same = pairs.filter((p) => p.fam === model.key);
  const use = same.length >= 5 ? same : pairs;
  const est = use.reduce((s, p) => s + p.est, 0);
  return est > 0 ? { factor: use.reduce((s, p) => s + p.cost, 0) / est, units: use.length, sameModel: use === same } : { factor: 1, units: 0, sameModel: false };
}

// dollars for one call's usage {input, output, cacheRead, cacheWrite} (tokens)
export function callCost(model, u) {
  const r = model.rates(u.input + u.cacheRead + u.cacheWrite);
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite) / 1e6;
}

// Which units (a paper, or a part "<key>#<n>" of a long text) a run reads:
//  * default: those never read;
//  * redo: all of them again;
//  * upgrade: only those read before by a weaker model than `model` (a paper read
//    whole is re-read in its parts if it is now split);
//  * replay: those with a saved answer (no new reading).
export function wantsUnit({ ledger, key, uid, mode, model, saved }) {
  if (mode === 'replay') return saved;
  if (mode === 'redo') return true;
  const entry = ledger[uid] || (uid !== key ? ledger[key] : undefined);
  if (mode === 'upgrade') return !!entry && modelRank(entry.model) < modelRank(model.id);
  return !ledger[key] && !ledger[uid];
}
