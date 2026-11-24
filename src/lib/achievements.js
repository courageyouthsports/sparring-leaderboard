// Big achievements. Each one unlocks a title the student can show next to their name.
import { RATING_TIERS, XP_TIERS, TITLE_NAMES } from '../config.js';
import { completionsOf, entriesOf, ratingOf, xpFor } from './scoring.js';

const DIAMOND_RATING = RATING_TIERS.find((t) => t.id === 'diamond').min;
const MYTHIC_XP = XP_TIERS.find((t) => t.id === 'mythic').min;

// Titles an instructor or admin awarded by hand.
export const awardedOf = (idx, id) => new Set((idx.awardedTitles || []).filter((a) => a.competitor_id === id).map((a) => a.title));

// All of a competitor's matches, oldest first.
function timeline(idx, id) {
  return entriesOf(idx, id).slice().reverse().flatMap((e) => e.matches.map((m) => ({ m, e })));
}

function longestStreak(list) {
  let best = 0, run = 0;
  for (const { m } of list) { run = m.won ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

export const ACHIEVEMENTS = [
  {
    id: 'unbroken', name: 'Unbroken', desc: 'Win 10 matches in a row', goal: 10,
    progress: (s) => longestStreak(s.timeline),
    unit: 'in a row',
  },
  {
    id: 'iron-wall', name: 'Iron Wall', desc: 'Win 3 or more matches at one tournament without giving up a single point', goal: 3,
    progress: (s) => Math.max(0, ...s.entries.map((e) => (e.matches.every((m) => m.won && m.opp_score === 0) ? e.matches.length : 0))),
    unit: 'shutouts in one event',
  },
  {
    id: 'double-gold', name: 'Double Gold', desc: 'Win 1st place in both sparring and combat sparring at the same tournament', goal: 1,
    progress: (s) => {
      const golds = s.entries.filter((e) => !e.team && e.placement === 1);
      const both = new Set(golds.filter((e) => e.discipline === 'sparring').map((e) => e.tournament_id));
      return golds.some((e) => e.discipline === 'combat' && both.has(e.tournament_id)) ? 1 : 0;
    },
  },
  {
    id: 'giant-killer', name: 'Giant Killer', desc: 'Beat 3 opponents rated 150 or more points higher than you', goal: 3,
    progress: (s) => s.timeline.filter(({ m }) => m.won && m.rating_before != null && m.opp_rating_before - m.rating_before >= 150).length,
    unit: 'upsets',
  },
  {
    id: 'road-warrior', name: 'Road Warrior', desc: 'Compete at 10 tournaments', goal: 10,
    progress: (s) => new Set(s.entries.map((e) => e.tournament_id)).size,
    unit: 'tournaments',
  },
  {
    id: 'centurion', name: 'Centurion', desc: 'Fight 100 tournament matches', goal: 100,
    progress: (s) => s.timeline.length,
    unit: 'matches',
  },
  {
    id: 'medalist', name: 'National Medalist', desc: 'Place in the top three at Nationals or the Super-20', goal: 1,
    progress: (s) => (s.entries.some((e) => !e.team && e.placement && ['AA', 'AAA'].includes(e.tournament.tier)) ? 1 : 0),
  },
  {
    id: 'champion-of-champions', name: 'Super-20 Champion', desc: 'Win 1st place at the Super-20 (class AAA)', goal: 1,
    progress: (s) => (s.entries.some((e) => !e.team && e.placement === 1 && e.tournament.tier === 'AAA') ? 1 : 0),
  },
  {
    id: 'mythic', name: 'Diamond', desc: `Reach Diamond: a ${DIAMOND_RATING} skill rating in sparring or combat sparring`, goal: DIAMOND_RATING,
    progress: (s) => Math.round(Math.max(1000, ...['sparring', 'combat'].map((d) => Number(ratingOf(s.idx, s.id, d)?.peak || 0)))),
    unit: 'peak rating', start: 1000,
  },
  {
    id: 'legend', name: 'Legend', desc: `Earn ${MYTHIC_XP.toLocaleString()} experience points`, goal: MYTHIC_XP,
    progress: (s) => xpFor(s.idx, s.id),
    unit: 'XP',
  },
  {
    id: 'dedicated', name: 'Dedicated', desc: 'Complete 10 weekly challenges', goal: 10,
    progress: (s) => completionsOf(s.idx, s.id).length,
    unit: 'challenges',
  },
];

// Every achievement with { value, done, pct } for one competitor.
// done = earned through results; awarded = given by an instructor; unlocked = either.
export function achievementsFor(idx, id) {
  const s = { idx, id, entries: entriesOf(idx, id), timeline: timeline(idx, id) };
  const awarded = awardedOf(idx, id);
  return ACHIEVEMENTS.map((a) => {
    const value = a.progress(s);
    const start = a.start || 0;
    const done = value >= a.goal;
    return {
      ...a, title: TITLE_NAMES[a.id], value, done, awarded: awarded.has(a.id), unlocked: done || awarded.has(a.id),
      pct: done ? 100 : Math.max(0, Math.min(100, ((value - start) / (a.goal - start)) * 100)),
    };
  });
}

// The title to show, only if it is still earned (protects against edits removing the achievement).
export function displayTitle(idx, c) {
  if (!c?.title) return null;
  return achievementsFor(idx, c.id).find((a) => a.id === c.title && a.unlocked) ? TITLE_NAMES[c.title] : null;
}
