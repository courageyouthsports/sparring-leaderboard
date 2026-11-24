import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexData, seasonPoints, seasonYear, entryPoints, xpTier, ratingTier, skillTier, badgesFor, xpFor } from './scoring.js';

const comp = (id, extra = {}) => ({ id, first_name: id, last_name: 'X', leadership: true, is_placeholder: false, ...extra });
let n = 0;
const T = (tier, date) => ({ id: `t${++n}`, name: `T${n}`, tier, event_date: date });
const E = (c, t, extra = {}) => ({ id: `e${++n}`, competitor_id: c, tournament_id: t.id, discipline: 'sparring', team: false, champion: true, placement: 1, ring_size: 8, created_at: '2026-01-01', ...extra });

test('season boundaries follow the April 24 end date', () => {
  assert.equal(seasonYear('2026-04-24'), 2025);
  assert.equal(seasonYear('2026-04-25'), 2026);
  assert.equal(seasonYear('2027-01-10'), 2026);
});

test('point tables match the 2026-27 rules', () => {
  const c = comp('a');
  const p = (tier, placement, extra = {}) => entryPoints({ tournament: { tier }, placement, champion: true, team: false, ...extra }, c).points;
  assert.deepEqual(['AAA', 'AA', 'A+', 'A', 'B'].map((t) => [1, 2, 3].map((pl) => p(t, pl))),
    [[20, 15, 10], [15, 10, 8], [12, 8, 4], [8, 5, 2], [5, 3, 1]]);
  assert.deepEqual([1, 2, 3].map((pl) => p('C', pl, { ring_size: 4 })), [2, 1, 0]);
  assert.deepEqual([1, 2, 3].map((pl) => p('C', pl, { ring_size: 3 })), [1, 0, 0]);
  assert.equal(p('C', 1, { ring_size: 2 }), 0);
  assert.equal(p('B', 1, { ring_size: 2 }), 5, 'class B is not reduced for small rings');
  assert.deepEqual([1, 2, 3].map((pl) => p('AA', pl, { team: true })), [10, 8, 5]);
  assert.equal(p('AAA', 1, { team: true }), 0, 'no team points at AAA');
  assert.equal(p('A', 1, { champion: false }), 0, 'recreational earns nothing');
  assert.equal(entryPoints({ tournament: { tier: 'A' }, placement: 1, champion: true, team: false }, comp('b', { leadership: false })).points, 0);
});

test('only the best five regional results count', () => {
  const ts = [5, 5, 5, 8, 8, 8].map((_, i) => T(i < 3 ? 'B' : 'A', `2026-0${5 + i}-01`));
  const entries = ts.map((t, i) => E('a', t, { placement: i < 3 ? 1 : 2 }));  // B 1st = 5 x3, A 2nd = 5 x3
  const idx = indexData({ competitors: [comp('a')], tournaments: ts, entries, matches: [], ratings: [] });
  const sp = seasonPoints(idx, 'a', 2026);
  assert.equal(sp.events.sparring.rows.filter((r) => r.counted).length, 5);
  assert.equal(sp.total, 25);
});

test('tiers, badges and experience', () => {
  assert.equal(xpTier(0).id, 'guardian');
  assert.equal(xpTier(800).id, 'heroic');
  assert.equal(xpTier(5000).id, 'legend');
  assert.equal(ratingTier(1000).id, 'bronze');
  assert.equal(ratingTier(1360).id, 'diamond');
  assert.equal(skillTier({ rating: 1400, matches: 2 }).id, 'untested');
  assert.equal(skillTier({ rating: 1400, matches: 3 }).id, 'diamond');
  const t = T('B', '2026-10-03');
  const e = E('a', t);
  const matches = [
    { id: 'm1', entry_id: e.id, round_no: 1, opponent_id: 'z', my_score: 5, opp_score: 0, won: true, rating_before: 1000, opp_rating_before: 1150 },
  ];
  const idx = indexData({ competitors: [comp('a'), comp('z', { is_placeholder: true })], tournaments: [t], entries: [e], matches, ratings: [] });
  const earned = badgesFor(idx, 'a').filter((b) => b.earned).map((b) => b.id);
  assert.deepEqual(earned.sort(), ['champion', 'first-tournament', 'first-win', 'podium', 'shutout', 'upset'].sort());
  // B event 40 + 1st place 50 + match 10 + win 15 + shutout 20 + 6 badges x 25
  assert.equal(xpFor(idx, 'a'), 40 + 50 + 10 + 15 + 20 + 150);
});
