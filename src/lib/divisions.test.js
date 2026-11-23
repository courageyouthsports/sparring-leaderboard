import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divisionOf } from './divisions.js';
import { indexData } from './scoring.js';
import { achievementsFor } from './achievements.js';

const kid = (extra) => ({ id: 'a', first_name: 'A', last_name: 'B', is_placeholder: false, gender: 'F', birth_year: 2014, belt: '1st Degree', ...extra });

test('divisions follow the ATA chart', () => {
  assert.equal(divisionOf(kid({}), 2026).label, 'Junior Girls 11–12, 1st Degree');
  assert.equal(divisionOf(kid({ belt: '3rd Degree' }), 2026).label, 'Junior Girls 11–12, 2nd–3rd Degree');
  assert.equal(divisionOf(kid({ birth_year: 2019, belt: '2nd Degree', gender: 'M' }), 2026).label, 'Junior Boys 8 & under, 1st–3rd Degree');
  assert.equal(divisionOf(kid({ birth_year: 1990, belt: '4th Degree', gender: 'M' }), 2026).label, 'Men 30–39, 4th–5th Degree');
  assert.equal(divisionOf(kid({ birth_year: 1960, belt: '2nd Degree' }), 2026).label, 'Women 60–69, 1st–3rd Degree');
  assert.equal(divisionOf(kid({ belt: 'Green' }), 2026).label, 'Junior Girls 11–12, Camo–Purple belts');
  assert.equal(divisionOf(kid({ belt: 'Red/Black' }), 2026).label, 'Junior Girls 11–12, Blue–Red/Black belts');
  assert.equal(divisionOf(kid({ birth_year: null }), 2026), null);
});

test('Unbroken needs 10 wins in a row, and a loss resets the streak', () => {
  const t = { id: 't1', name: 'T', tier: 'B', event_date: '2026-10-01' };
  const t2 = { id: 't2', name: 'T2', tier: 'B', event_date: '2026-10-08' };
  const e1 = { id: 'e1', competitor_id: 'a', tournament_id: 't1', discipline: 'sparring', team: false, placement: 1, created_at: '1' };
  const e2 = { id: 'e2', competitor_id: 'a', tournament_id: 't2', discipline: 'sparring', team: false, placement: 1, created_at: '2' };
  const m = (entry, n, won) => ({ id: `${entry}-${n}`, entry_id: entry, round_no: n, opponent_id: 'z', my_score: won ? 5 : 1, opp_score: won ? 0 : 5, won });
  const matches = [...[1, 2, 3, 4, 5, 6].map((n) => m('e1', n, true)), m('e1', 7, false), ...[1, 2, 3, 4, 5, 6].map((n) => m('e2', n, true))];
  let idx = indexData({ competitors: [kid({})], tournaments: [t, t2], entries: [e1, e2], matches, ratings: [] });
  let u = achievementsFor(idx, 'a').find((a) => a.id === 'unbroken');
  assert.equal(u.value, 6); assert.equal(u.done, false);
  matches[6] = m('e1', 7, true);
  idx = indexData({ competitors: [kid({})], tournaments: [t, t2], entries: [e1, e2], matches, ratings: [] });
  u = achievementsFor(idx, 'a').find((a) => a.id === 'unbroken');
  assert.equal(u.value, 13); assert.equal(u.done, true);
  assert.equal(achievementsFor(idx, 'a').find((a) => a.id === 'iron-wall').done, true, '6 shutouts at one tournament');
});
