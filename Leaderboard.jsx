import { useMemo, useState } from 'react';
import { AGE_GROUPS, PROVISIONAL_MATCHES, TIER_NAMES, isBlackBelt } from '../config.js';
import {
  competitionAge, fullName, ratingOf, ratingTier, recordOf, seasonLabel, seasonPoints, seasonYear, todayStr, xpFor, xpTier,
} from '../lib/scoring.js';
import { Emblem, Segmented } from '../components/ui.jsx';

const EVENTS = [['sparring', 'Sparring'], ['combat', 'Combat'], ['team-sparring', 'Team sparring'], ['team-combat', 'Team combat']];

export default function Leaderboard({ data, params }) {
  const [board, setBoard] = useState(params.board || 'competitive');
  const [discipline, setDiscipline] = useState('sparring');
  const [event, setEvent] = useState('sparring');
  const thisSeason = seasonYear(todayStr());
  const seasons = useMemo(() => {
    const s = new Set([thisSeason, ...[...data.tournaments.values()].map((t) => seasonYear(t.event_date))]);
    return [...s].sort((a, b) => b - a);
  }, [data, thisSeason]);
  const [season, setSeason] = useState(thisSeason);
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [belt, setBelt] = useState('');

  const students = useMemo(() => {
    const group = AGE_GROUPS.find((g) => g.id === age);
    return data.competitors.filter((c) => !c.is_placeholder)
      .filter((c) => !gender || c.gender === gender)
      .filter((c) => !belt || (belt === 'black' ? isBlackBelt(c.belt) : c.belt && !isBlackBelt(c.belt)))
      .filter((c) => {
        if (!group) return true;
        const a = competitionAge(c.birth_year, thisSeason);
        return a != null && a >= group.lo && a <= group.hi;
      });
  }, [data, gender, belt, age, thisSeason]);

  const rows = useMemo(() => {
    if (board === 'competitive') {
      return students.map((c) => ({ c, r: ratingOf(data, c.id, discipline) })).filter((x) => x.r)
        .map(({ c, r }) => {
          const rec = recordOf(data, c.id, discipline);
          return {
            c, value: Number(r.rating), display: Math.round(r.rating), tier: ratingTier(r.rating).id,
            provisional: r.matches < PROVISIONAL_MATCHES, sub: `${rec.wins}–${rec.losses}`,
          };
        })
        .sort((a, b) => (a.provisional - b.provisional) || b.value - a.value);
    }
    if (board === 'experience') {
      return students.map((c) => {
        const xp = xpFor(data, c.id);
        return { c, value: xp, display: xp.toLocaleString(), tier: xpTier(xp).id, sub: 'XP' };
      }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    }
    return students.map((c) => {
      const ev = seasonPoints(data, c.id, season).events[event];
      return { c, value: ev?.total || 0, display: ev?.total || 0, sub: 'pts' };
    }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [board, students, data, discipline, event, season]);

  const track = board === 'experience' ? 'experience' : 'competitive';
  let rank = 0;

  return (
    <>
      <div className="board-head">
        <h1>Rankings</h1>
        <Segmented label="Leaderboard" value={board} onChange={setBoard}
          options={[['competitive', 'Skill rating'], ['experience', 'Experience'], ['points', 'ATA points']]} />
      </div>

      <div className="filters">
        {board === 'competitive' && (
          <Segmented label="Event" value={discipline} onChange={setDiscipline} options={[['sparring', 'Sparring'], ['combat', 'Combat']]} />
        )}
        {board === 'points' && (
          <>
            <select aria-label="Event" value={event} onChange={(e) => setEvent(e.target.value)}>
              {EVENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select aria-label="Season" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)} season</option>)}
            </select>
          </>
        )}
        <select aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Everyone</option><option value="M">Boys &amp; men</option><option value="F">Girls &amp; women</option>
        </select>
        <select aria-label="Age group" value={age} onChange={(e) => setAge(e.target.value)}>
          <option value="">All ages</option>
          {AGE_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <select aria-label="Belt" value={belt} onChange={(e) => setBelt(e.target.value)}>
          <option value="">All belts</option><option value="color">Color belts</option><option value="black">Black belts</option>
        </select>
      </div>

      {board === 'points' && <p className="muted small">What each student should have on their ATA profile, from the results logged here. Only the best results in each class count.</p>}
      {board === 'experience' && <p className="muted small">Earned by competing: every event, match, win, placement and badge adds up. It never goes down.</p>}
      {board === 'competitive' && <p className="muted small">Moves with every match. Big wins over strong opponents move it most; close losses barely cost anything.</p>}

      {rows.length === 0 ? (
        <div className="empty">
          <p>No results here yet.</p>
          <a className="button primary" href="#/log">Log a tournament result</a>
        </div>
      ) : (
        <ol className="board">
          {rows.map((row) => {
            if (!row.provisional) rank += 1;
            return (
              <li key={row.c.id}>
                <a href={`#/c/${row.c.id}`} className="board-row">
                  <span className="board-rank">{row.provisional ? '–' : rank}</span>
                  {row.tier ? <Emblem track={track} tier={row.tier} size={40} /> : <span className="emblem-gap" />}
                  <span className="board-name">
                    <b>{fullName(row.c)}</b>
                    <span className="muted">
                      {[row.c.belt, row.tier && TIER_NAMES[row.tier], row.provisional && 'provisional'].filter(Boolean).join(', ')}
                    </span>
                  </span>
                  <span className="board-value">
                    <b>{row.display}</b>
                    <span className="muted">{row.sub}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
