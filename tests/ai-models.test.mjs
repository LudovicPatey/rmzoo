import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, modelOf, modelRank, familyOf, callCost, wantsUnit, calibration } from '../scripts/lib/ai-models.mjs';

test('models: names, ids, order', () => {
  assert.equal(modelOf('sonnet').id, 'claude-sonnet-5-5');
  assert.equal(modelOf('claude-haiku-5-5').key, 'haiku');
  assert.throws(() => modelOf('gpt-5'), /unknown model/);
  // the served model may be another version of the family (server-side fallback)
  assert.ok(modelRank('claude-haiku-5-5') < modelRank('claude-sonnet-5') && modelRank('claude-sonnet-5-5') < modelRank('claude-opus-5'));
  assert.equal(familyOf('claude-opus-5').key, 'opus');
  assert.equal(MODELS.haiku.fallbacks, false);
});

test('models: cost, with the two rate cards of Haiku', () => {
  const u = { input: 50000, output: 10000, cacheRead: 0, cacheWrite: 0 };
  assert.equal(callCost(modelOf('opus'), u).toFixed(2), '0.40');
  assert.equal(callCost(modelOf('sonnet'), u).toFixed(2), '0.20');
  assert.equal(callCost(modelOf('haiku'), u).toFixed(3), '0.010');
  // a prompt over 100k tokens (cached part included) is billed at the higher rate
  assert.equal(callCost(modelOf('haiku'), { ...u, cacheRead: 60000 }).toFixed(3), '0.053');
});

test('models: which units a run reads (new, upgrade, redo, replay)', () => {
  const ledger = { a: { model: 'claude-haiku-5-5' }, b: { model: 'claude-opus-5-5' }, 'c#1': { model: 'claude-sonnet-5-5' }, 'c#2': { model: 'claude-opus-5-5' } };
  const opus = modelOf('opus'), sonnet = modelOf('sonnet');
  const want = (key, uid, mode, model) => wantsUnit({ ledger, key, uid, mode, model, saved: false });
  // default: only what was never read
  assert.equal(want('a', 'a', 'new', opus), false);
  assert.equal(want('d', 'd', 'new', opus), true);
  // upgrade: only what a weaker model read; never-read papers are left out
  assert.equal(want('a', 'a', 'upgrade', opus), true);
  assert.equal(want('a', 'a', 'upgrade', modelOf('haiku')), false);
  assert.equal(want('b', 'b', 'upgrade', opus), false);
  assert.equal(want('d', 'd', 'upgrade', opus), false);
  assert.equal(want('c', 'c#1', 'upgrade', opus), true);
  assert.equal(want('c', 'c#2', 'upgrade', opus), false);
  assert.equal(want('c', 'c#1', 'upgrade', sonnet), false);
  // a paper read whole by a weaker model, now read in parts
  assert.equal(want('a', 'a#3', 'upgrade', opus), true);
  assert.equal(want('b', 'b#1', 'redo', opus), true);
  assert.equal(wantsUnit({ ledger, key: 'b', uid: 'b', mode: 'replay', model: opus, saved: true }), true);
});

test('models: calibration of the estimates on recorded costs', () => {
  const ledger = { a: { model: 'claude-opus-5-5', cost: 2 }, b: { model: 'claude-opus-5-5', cost: 1 }, c: { model: 'claude-opus-5-5', cost: 0 } };
  const est = () => 0.5;
  const c = calibration(ledger, modelOf('sonnet'), est);
  assert.equal(c.factor, 3); // (2 + 1) / (0.5 + 0.5), the unit without cost ignored
  assert.equal(c.sameModel, false); // fewer than 5 units of the same family: all units
  assert.deepEqual(calibration({}, modelOf('opus'), est), { factor: 1, units: 0, sameModel: false });
});
