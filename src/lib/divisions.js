// Which ATA division a competitor falls in this season.
import { AGE_GROUPS, COLOR_GROUPS, isBlackBelt } from '../config.js';
import { competitionAge } from './scoring.js';

const degree = (belt) => Number((belt || '').match(/^(\d)/)?.[1] || 0);

function rankGroup(belt, ageGroup) {
  if (isBlackBelt(belt)) {
    const d = Math.min(degree(belt), 5);
    const g = ageGroup.black.find(([id]) => {
      const [lo, hi = lo] = id.split('-').map(Number);
      return d >= lo && d <= hi;
    }) || ageGroup.black.at(-1);
    return { id: `bb${g[0]}`, label: g[1], order: 10 + d };
  }
  const i = COLOR_GROUPS.findIndex((cg) => cg.belts.includes(belt));
  if (i < 0) return null;
  return { id: COLOR_GROUPS[i].id, label: COLOR_GROUPS[i].label, order: i };
}

// Returns { key, label, order } or null when gender, birth year or belt is missing.
export function divisionOf(c, season) {
  if (!c || !c.gender || !c.birth_year || !c.belt) return null;
  const age = competitionAge(c.birth_year, season);
  const ag = AGE_GROUPS.find((g) => age >= g.lo && age <= g.hi);
  if (!ag) return null;
  const rg = rankGroup(c.belt, ag);
  if (!rg) return null;
  const junior = age <= 17;
  const who = junior ? (c.gender === 'M' ? 'Junior Boys' : 'Junior Girls') : (c.gender === 'M' ? 'Men' : 'Women');
  const ai = AGE_GROUPS.indexOf(ag);
  return {
    key: `${c.gender}|${ag.id}|${rg.id}`,
    label: `${who} ${ag.label}, ${rg.label}`,
    order: (c.gender === 'F' ? 0 : 1) * 10000 + ai * 100 + rg.order,
  };
}

// Every division that has at least one of our students, in a sensible order.
export function divisionsPresent(competitors, season) {
  const map = new Map();
  for (const c of competitors) {
    if (c.is_placeholder) continue;
    const d = divisionOf(c, season);
    if (d && !map.has(d.key)) map.set(d.key, d);
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}
