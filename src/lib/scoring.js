// Experience, tiers, badges and ATA ranking points, worked out from the logged results.
// (Skill ratings are calculated in the database; see supabase/schema.sql.)
import {
  XP, XP_TIERS, RATING_TIERS, UNTESTED, PROVISIONAL_MATCHES, INDIVIDUAL_POINTS, C_POINTS, TEAM_POINTS, COUNTED, SEASON_END,
} from '../config.js';

// ---- Seasons ---------------------------------------------------------------

// The season that a date belongs to, as its starting year (2026 = the 2026-27 season).
export function seasonYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const afterEnd = m > SEASON_END.month || (m === SEASON_END.month && d > SEASON_END.day);
  return afterEnd ? y : y - 1;
}
export const seasonLabel = (y) => `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
export const todayStr = () => new Date().toLocaleDateString('en-CA');  // YYYY-MM-DD, local time

// Competition age: age on December 31 of the season's first year.
export const competitionAge = (birthYear, season) => (birthYear ? season - birthYear : null);

// ---- Indexing --------------------------------------------------------------

export function indexData(raw) {
  const tournaments = new Map(raw.tournaments.map((t) => [t.id, { ...t, event_date: String(t.event_date).slice(0, 10) }]));
  const competitorById = new Map(raw.competitors.map((c) => [c.id, c]));
  const matchesByEntry = new Map();
  for (const m of raw.matches) {
    if (!matchesByEntry.has(m.entry_id)) matchesByEntry.set(m.entry_id, []);
    matchesByEntry.get(m.entry_id).push(m);
  }
  for (const list of matchesByEntry.values()) list.sort((a, b) => a.round_no - b.round_no);
  const allEntries = raw.entries
    .map((e) => ({ ...e, status: e.status || 'approved', tournament: tournaments.get(e.tournament_id), matches: matchesByEntry.get(e.id) || [] }))
    .filter((e) => e.tournament)
    .sort((a, b) => b.tournament.event_date.localeCompare(a.tournament.event_date) || String(b.created_at).localeCompare(String(a.created_at)));
  // Only approved results count anywhere; pending and sent-back ones are kept separately for the family and instructors.
  const entries = allEntries.filter((e) => e.status === 'approved');
  const group = (list, key) => {
    const m = new Map();
    for (const x of list) { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); }
    return m;
  };
  const entriesByCompetitor = group(entries, 'competitor_id');
  const unapproved = allEntries.filter((e) => e.status !== 'approved');
  const classMatchesByLog = group((raw.classMatches || []).slice().sort((a, b) => a.round_no - b.round_no), 'class_log_id');
  const classLogs = (raw.classLogs || []).map((l) => ({ ...l, class_date: String(l.class_date).slice(0, 10), matches: classMatchesByLog.get(l.id) || [] }))
    .sort((a, b) => b.class_date.localeCompare(a.class_date));
  const classLogsByCompetitor = group(classLogs, 'competitor_id');
  const ratings = new Map(raw.ratings.map((r) => [`${r.competitor_id}:${r.discipline}`, r]));
  const completionsByCompetitor = new Map();
  for (const cc of raw.completions || []) {
    const w = { ...cc, week_start: String(cc.week_start).slice(0, 10) };
    if (!completionsByCompetitor.has(cc.competitor_id)) completionsByCompetitor.set(cc.competitor_id, []);
    completionsByCompetitor.get(cc.competitor_id).push(w);
  }
  for (const list of completionsByCompetitor.values()) list.sort((a, b) => b.week_start.localeCompare(a.week_start));
  return { ...raw, tournaments, competitorById, entries, entriesByCompetitor, ratings, completionsByCompetitor,
    allEntries, unapproved, classLogs, classLogsByCompetitor };
}

export const entriesOf = (idx, id) => idx.entriesByCompetitor.get(id) || [];
export const completionsOf = (idx, id) => idx.completionsByCompetitor?.get(id) || [];
export const classLogsOf = (idx, id) => idx.classLogsByCompetitor?.get(id) || [];
export const approvedClassesOf = (idx, id) => classLogsOf(idx, id).filter((l) => l.status === 'approved');
// The completion for this week's challenge, if any (the "temporary badge").
export const weeklyDone = (idx, id) => {
  const wk = idx.challenge?.week_start && String(idx.challenge.week_start).slice(0, 10);
  return wk ? completionsOf(idx, id).find((c) => c.week_start === wk) || null : null;
};
export const ratingOf = (idx, id, discipline) => idx.ratings.get(`${id}:${discipline}`) || null;

// ---- Tiers -----------------------------------------------------------------

export function tierFor(value, tiers) {
  let tier = tiers[0];
  for (const t of tiers) if (value >= t.min) tier = t;
  return tier;
}
export function nextTier(value, tiers) {
  return tiers.find((t) => t.min > value) || null;
}
export const xpTier = (xp) => tierFor(xp, XP_TIERS);
export const ratingTier = (rating) => tierFor(rating ?? 1000, RATING_TIERS);
// Skill tier for a ratings row: Untested until enough matches, then by rating.
export const skillTier = (r) => (!r || r.matches < PROVISIONAL_MATCHES ? UNTESTED : ratingTier(Number(r.rating)));

// ---- ATA ranking points ----------------------------------------------------

// Points one result should earn. Returns { points, note } — note explains a zero.
export function entryPoints(entry, competitor) {
  const tier = entry.tournament.tier;
  const p = entry.placement;
  if (!p) return { points: 0, note: 'No placement' };
  if (!entry.champion) return { points: 0, note: 'Recreational division' };
  if (entry.team) {
    const table = TEAM_POINTS[tier];
    if (!table) return { points: 0, note: `No team points at class ${tier}` };
    return { points: table[p - 1], note: '' };
  }
  if (!competitor?.leadership) return { points: 0, note: 'Needs Leadership/Legacy registration' };
  if (tier === 'C') {
    if (!entry.ring_size) return { points: C_POINTS(5)[p - 1], note: 'Assumes 5+ in the ring' };
    const pts = C_POINTS(entry.ring_size)[p - 1];
    return { points: pts, note: pts ? '' : `Only ${entry.ring_size} in the ring` };
  }
  return { points: INDIVIDUAL_POINTS[tier][p - 1], note: '' };
}

const bucketOf = (tier) => (tier === 'A' || tier === 'B' ? 'regional' : tier);

// Season standings for one competitor. Only the best results in each class count.
export function seasonPoints(idx, competitorId, season) {
  const competitor = idx.competitorById.get(competitorId);
  const result = { total: 0, events: {} };
  const inSeason = entriesOf(idx, competitorId).filter((e) => seasonYear(e.tournament.event_date) === season);
  for (const e of inSeason) {
    const key = e.team ? `team-${e.discipline}` : e.discipline;
    if (!result.events[key]) result.events[key] = { total: 0, rows: [] };
    const { points, note } = entryPoints(e, competitor);
    result.events[key].rows.push({ entry: e, points, note, counted: false });
  }
  for (const ev of Object.values(result.events)) {
    const byBucket = {};
    for (const row of ev.rows) {
      const b = bucketOf(row.entry.tournament.tier);
      (byBucket[b] ||= []).push(row);
    }
    for (const [b, rows] of Object.entries(byBucket)) {
      const limit = COUNTED[b] ?? Infinity;
      rows.filter((r) => r.points > 0).sort((x, y) => y.points - x.points).slice(0, limit)
        .forEach((r) => { r.counted = true; });
    }
    ev.total = ev.rows.filter((r) => r.counted).reduce((s, r) => s + r.points, 0);
    result.total += ev.total;
  }
  return result;
}

// ---- Badges ----------------------------------------------------------------

const isShutout = (m) => m.won && m.opp_score === 0;
const isUpset = (m) => m.won && m.rating_before != null && m.opp_rating_before - m.rating_before >= 100;

export const BADGES = [
  { id: 'first-tournament', name: 'First tournament', desc: 'Competed at a tournament', test: (s) => s.entries.length >= 1 },
  { id: 'first-win', name: 'First win', desc: 'Won a match', test: (s) => s.wins >= 1 },
  { id: 'shutout', name: 'Shutout', desc: 'Won a match without giving up a point', test: (s) => s.matches.some(isShutout) },
  { id: 'podium', name: 'Podium', desc: 'Placed in the top three', test: (s) => s.entries.some((e) => e.placement) },
  { id: 'champion', name: 'Ring champion', desc: 'Won first place', test: (s) => s.entries.some((e) => e.placement === 1) },
  { id: 'upset', name: 'Giant slayer', desc: 'Beat someone rated 100+ higher', test: (s) => s.matches.some(isUpset) },
  { id: 'big-stage', name: 'Big stage', desc: 'Competed at Nationals or Worlds', test: (s) => s.entries.some((e) => ['AA', 'AAA'].includes(e.tournament.tier)) },
  { id: 'regular', name: 'Regular', desc: 'Competed at 5 tournaments', test: (s) => s.tournamentCount >= 5 },
  { id: 'ten-wins', name: 'Ten wins', desc: 'Won 10 matches', test: (s) => s.wins >= 10 },
  { id: 'teammate', name: 'Teammate', desc: 'Competed in team sparring', test: (s) => s.entries.some((e) => e.team) },
  { id: 'both-sides', name: 'Two-way fighter', desc: 'Competed in sparring and combat sparring', test: (s) => new Set(s.entries.map((e) => e.discipline)).size === 2 },
];

function statsFor(idx, competitorId) {
  const entries = entriesOf(idx, competitorId);
  const matches = entries.flatMap((e) => e.matches);
  return {
    entries,
    matches,
    wins: matches.filter((m) => m.won).length,
    tournamentCount: new Set(entries.map((e) => e.tournament_id)).size,
  };
}

export const badgesFor = (idx, competitorId) => {
  const s = statsFor(idx, competitorId);
  return BADGES.map((b) => ({ ...b, earned: b.test(s) }));
};

// ---- Experience ------------------------------------------------------------

export function xpFor(idx, competitorId) {
  const s = statsFor(idx, competitorId);
  let xp = 0;
  for (const e of s.entries) {
    xp += XP.event[e.tournament.tier] || 0;
    if (e.placement) xp += XP.place[e.placement] || 0;
    for (const m of e.matches) {
      xp += XP.match;
      if (m.won) xp += XP.win;
      if (isShutout(m)) xp += XP.shutout;
    }
  }
  xp += badgesFor(idx, competitorId).filter((b) => b.earned).length * XP.badge;
  xp += completionsOf(idx, competitorId).reduce((s, c) => s + c.xp, 0);   // weekly challenges
  for (const l of approvedClassesOf(idx, competitorId)) {
    xp += XP.classAttended;
    for (const m of l.matches) xp += XP.classMatch + (m.won ? XP.classWin : 0);
  }
  return xp;
}

export function recordOf(idx, competitorId, discipline) {
  if (discipline === 'class') {
    const cm = approvedClassesOf(idx, competitorId).flatMap((l) => l.matches);
    return { wins: cm.filter((m) => m.won).length, losses: cm.filter((m) => !m.won).length };
  }
  const ms = entriesOf(idx, competitorId).filter((e) => !discipline || e.discipline === discipline).flatMap((e) => e.matches);
  return { wins: ms.filter((m) => m.won).length, losses: ms.filter((m) => !m.won).length };
}

// Team match record (team matches won / lost).
export function teamRecordOf(idx, competitorId) {
  const ms = entriesOf(idx, competitorId).filter((e) => e.team).flatMap((e) => e.matches).filter((m) => m.team_won != null);
  return { wins: ms.filter((m) => m.team_won).length, losses: ms.filter((m) => !m.team_won).length };
}

// Rating over time for one discipline, oldest first.
export function ratingHistory(idx, competitorId, discipline) {
  const points = [];
  if (discipline === 'class') {
    for (const l of approvedClassesOf(idx, competitorId).slice().reverse()) for (const m of l.matches) {
      if (m.rating_after != null) points.push({ date: l.class_date, rating: Number(m.rating_after) });
    }
    return points;
  }
  const es = entriesOf(idx, competitorId).filter((e) => e.discipline === discipline).slice().reverse();
  for (const e of es) for (const m of e.matches) {
    if (m.rating_after != null) points.push({ date: e.tournament.event_date, rating: Number(m.rating_after) });
  }
  return points;
}

export const fullName = (c) => (c ? `${c.first_name} ${c.last_name}` : 'Unknown');
