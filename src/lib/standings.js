// ATA state standings (imported from MyATA) grouped into ATA's own divisions.
import { isBlackBelt } from '../config.js';
import { competitionAge } from './scoring.js';

const nums = (s) => (String(s).match(/\d+/g) || []).map(Number);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

// "13 - 14 Years Old" -> {lo:13, hi:14}; "70 & Over" -> {lo:70, hi:200}
function parseAge(age) {
  const n = nums(age);
  if (!n.length) return { lo: 0, hi: 200 };
  return { lo: n[0], hi: n.length > 1 ? n[1] : (/over|up|\+/i.test(age) ? 200 : n[0]) };
}
// "2nd, 3rd Degree Black Belt" -> {black:true, dlo:2, dhi:3}; "Color Belt" -> {black:false}
function parseRank(rank) {
  if (!/degree|black/i.test(rank)) return { black: false };
  const n = nums(rank);
  return { black: true, dlo: n[0] || 1, dhi: n.at(-1) || n[0] || 9 };
}

const GENDER_ORDER = { GIRLS: 0, BOYS: 1, WOMEN: 2, MEN: 3 };

export function standingsDivision(row) {
  const age = parseAge(row.age);
  const rank = parseRank(row.rank);
  const ageLabel = age.hi >= 200 ? `${age.lo} & up` : age.lo === age.hi ? `${age.lo}` : `${age.lo}–${age.hi}`;
  return {
    key: `${row.gender}|${row.rank}|${row.age}`,
    label: `${titleCase(row.gender)} ${ageLabel}, ${row.rank.replace(/(\d)\w*,\s*(\d)/, '$1–$2').replace(/(\d\w*)\s*-\s*/, '$1–')}`,
    order: (GENDER_ORDER[row.gender] ?? 9) * 1e6 + age.lo * 1000 + (rank.black ? 10 + rank.dlo : 0),
    gender: /^(BOYS|MEN)$/.test(row.gender) ? 'M' : 'F',
    junior: /^(BOYS|GIRLS)$/.test(row.gender),
    age, rank,
  };
}

// All divisions in the standings for one event, in a sensible order.
export function standingsDivisions(rows, event) {
  const map = new Map();
  for (const r of rows) if (r.event === event && !map.has(`${r.gender}|${r.rank}|${r.age}`)) map.set(`${r.gender}|${r.rank}|${r.age}`, standingsDivision(r));
  return [...map.values()].sort((a, b) => a.order - b.order);
}

// The standings division a student competes in, from their gender, birth year and belt.
export function matchDivision(divisions, c, season) {
  if (!c?.gender || !c.birth_year || !c.belt) return null;
  const age = competitionAge(c.birth_year, season);
  const black = isBlackBelt(c.belt);
  const deg = Number((c.belt.match(/^(\d)/) || [])[1] || 0);
  return divisions.find((d) => d.gender === c.gender && d.junior === age <= 17
    && age >= d.age.lo && age <= d.age.hi && d.rank.black === black
    && (!black || (deg >= d.rank.dlo && deg <= d.rank.dhi))) || null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Which of our students (not opponents) a standings row is, by link or by name.
export function studentFor(row, students) {
  return students.find((c) => c.id === row.competitor_id)
    || students.find((c) => norm(`${c.first_name}${c.last_name}`) === norm(row.name)) || null;
}
