// Everything you might want to tune lives here.

// --- Tier emblems ----------------------------------------------------------
// Images are loaded from public/emblems/<track>/<tier>.<EMBLEM_EXT>. Swap the files to change the art.
export const EMBLEM_EXT = 'svg';

export const TIER_NAMES = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', mythic: 'Mythic',
};

// Experience track: earned by competing. Only ever goes up. Minimum XP for each tier.
export const XP_TIERS = [
  { id: 'bronze', min: 0 },
  { id: 'silver', min: 250 },
  { id: 'gold', min: 750 },
  { id: 'platinum', min: 1500 },
  { id: 'mythic', min: 3000 },
];

// Competitive track: from the skill rating (everyone starts at 1000). Minimum rating for each tier.
export const RATING_TIERS = [
  { id: 'bronze', min: -Infinity },
  { id: 'silver', min: 1050 },
  { id: 'gold', min: 1125 },
  { id: 'platinum', min: 1225 },
  { id: 'mythic', min: 1350 },
];
// Matches needed before a rating counts as settled (shown as "provisional" until then).
export const PROVISIONAL_MATCHES = 3;

// --- Experience points -----------------------------------------------------
export const XP = {
  event: { AAA: 100, AA: 80, 'A+': 60, A: 50, B: 40, C: 25 },  // for competing in an event at a tournament
  match: 10,          // every match fought
  win: 15,            // every match won
  shutout: 20,        // won without giving up a point
  place: { 1: 50, 2: 35, 3: 20 },
  badge: 25,          // each badge earned
};

// --- ATA ranking points (2026-27 rules) -----------------------------------
export const INDIVIDUAL_POINTS = {
  AAA: [20, 15, 10], AA: [15, 10, 8], 'A+': [12, 8, 4], A: [8, 5, 2], B: [5, 3, 1],
};
// Class C depends on how many were in the ring.
export const C_POINTS = (ringSize) =>
  ringSize >= 5 ? [3, 2, 1] : ringSize === 4 ? [2, 1, 0] : ringSize === 3 ? [1, 0, 0] : [0, 0, 0];
export const TEAM_POINTS = { AA: [10, 8, 5], 'A+': [5, 3, 1], A: [5, 3, 1], B: [5, 3, 1] };  // no team events at AAA

// How many results count toward the season total, per event.
export const COUNTED = { AAA: 1, AA: 2, 'A+': 2, regional: 5, C: 3 };   // regional = A and B together

// The season ends on this month-day; later tournaments count toward the next season.
export const SEASON_END = { month: 4, day: 24 };

// --- Lists -----------------------------------------------------------------
export const TIERS = ['AAA', 'AA', 'A+', 'A', 'B', 'C'];
export const TIER_LABELS = {
  AAA: 'AAA (Super-20 at Worlds)', AA: 'AA (Nationals)', 'A+': 'A+ (H.U. Lee Classic, etc.)',
  A: 'A (Regional)', B: 'B (Regional)', C: 'C (In-school)',
};
export const BELTS = [
  'White', 'Orange', 'Yellow', 'Camo', 'Green', 'Purple', 'Blue', 'Brown', 'Red',
  'Red/Black', '1st Degree', '2nd Degree', '3rd Degree', '4th Degree', '5th Degree',
];
export const isBlackBelt = (belt) => /Degree/.test(belt || '');
export const DISCIPLINES = { sparring: 'Sparring', combat: 'Combat sparring' };

// ATA competition age = age on December 31 of the season's first year.
export const AGE_GROUPS = [
  { id: 'u8', label: '8 & under', lo: 0, hi: 8 },
  { id: '9-10', label: '9–10', lo: 9, hi: 10 },
  { id: '11-12', label: '11–12', lo: 11, hi: 12 },
  { id: '13-14', label: '13–14', lo: 13, hi: 14 },
  { id: '15-17', label: '15–17', lo: 15, hi: 17 },
  { id: '18-29', label: '18–29', lo: 18, hi: 29 },
  { id: '30-39', label: '30–39', lo: 30, hi: 39 },
  { id: '40-49', label: '40–49', lo: 40, hi: 49 },
  { id: '50+', label: '50 & up', lo: 50, hi: 200 },
];
