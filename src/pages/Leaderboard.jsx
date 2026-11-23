import { useMemo, useState } from 'react';
import { PROVISIONAL_MATCHES, TIER_NAMES } from '../config.js';
import {
  fullName, ratingOf, ratingTier, recordOf, seasonLabel, seasonPoints, seasonYear, todayStr, weeklyDone, xpFor, xpTier,
} from '../lib/scoring.js';
import { displayTitle } from '../lib/achievements.js';
import { divisionOf, divisionsPresent } from '../lib/divisions.js';
import { Emblem, Segmented } from '../components/ui.jsx';
import MeCard from '../components/MeCard.jsx';
import ChallengeCard from '../components/ChallengeCard.jsx';

const EVENTS = [['sparring', 'Sparring'], ['combat', 'Combat'], ['team-sparring', 'Team sparring'], ['team-combat', 'Team combat']];

export default function Home({ data, params, reload, isAdmin }) {
  const thisSeason = seasonYear(todayStr());
  const mine = data.competitors.filter((c) => !c.is_placeholder && data.myCompetitorIds.has(c.id))
    .sort((a, b) => a.first_name.localeCompare(b.first_name));
  const [meId, setMeId] = useState(mine[0]?.id || null);
  const me = mine.find((c) => c.id === meId) || null;
  const myDivision = me ? divisionOf(me, thisSeason) : null;

  const [board, setBoard] = useState(params.board || 'competitive');
  const [discipline, setDiscipline] = useState('sparring');
  const [event, setEvent] = useState('sparring');
  const seasons = useMemo(() => {
    const s = new Set([thisSeason, ...[...data.tournaments.values()].map((t) => seasonYear(t.event_date))]);
    return [...s].sort((a, b) => b - a);
  }, [data, thisSeason]);
  const [season, setSeason] = useState(thisSeason);
  const divisions = useMemo(() => divisionsPresent(data.competitors, thisSeason), [data, thisSeason]);
  const [divChoice, setDivChoice] = useState(null);   // null = follow the selected student
  const divKey = divChoice ?? myDivision?.key ?? 'all';
  const division = divisions.find((d) => d.key === divKey);

  const students = useMemo(() => data.competitors.filter((c) => !c.is_placeholder)
    .filter((c) => divKey === 'all' || divisionOf(c, thisSeason)?.key === divKey), [data, divKey, thisSeason]);

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
      {mine.length > 1 && (
        <Segmented label="Student" value={meId} onChange={(v) => { setMeId(v); setDivChoice(null); }}
          options={mine.map((c) => [c.id, c.first_name])} />
      )}
      {me && <MeCard data={data} c={me} />}
      {me && !myDivision && (
        <p className="note small">Add {me.first_name}’s birth year, belt and division under <a href="#/mine">My competitors</a> to see their ATA division here.</p>
      )}
      {mine.length === 0 && !isAdmin && (
        <div className="empty">
          <p>Add yourself or your student to see their ranks here.</p>
          <a className="button primary" href="#/mine">Add a competitor</a>
        </div>
      )}

      <ChallengeCard data={data} competitors={mine} reload={reload} isAdmin={isAdmin} />

      <section className="division-board">
        <div className="board-head">
          <label className="division-pick">
            <span className="muted small">Leaderboard</span>
            <select value={divKey} onChange={(e) => setDivChoice(e.target.value)} aria-label="Division">
              <option value="all">All divisions</option>
              {divisions.map((d) => <option key={d.key} value={d.key}>{d.label}{d.key === myDivision?.key ? ' (yours)' : ''}</option>)}
            </select>
          </label>
          <Segmented label="Leaderboard type" value={board} onChange={setBoard}
            options={[['competitive', 'Skill'], ['experience', 'Experience'], ['points', 'ATA points']]} />
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
        </div>
        <p className="muted small">
          {board === 'points' && 'What each student should have on their ATA profile, from the results logged here. Only the best results in each class count.'}
          {board === 'experience' && 'Earned by competing and completing weekly challenges. It never goes down.'}
          {board === 'competitive' && 'Moves with every match. Big wins over strong opponents move it most; close losses barely cost anything.'}
        </p>

        {rows.length === 0 ? (
          <div className="empty">
            <p>{division ? `No ${board === 'points' ? 'points' : 'results'} in ${division.label} yet.` : 'No results here yet.'}</p>
            <a className="button primary" href="#/log">Log a tournament result</a>
          </div>
        ) : (
          <ol className="board">
            {rows.map((row) => {
              if (!row.provisional) rank += 1;
              const title = displayTitle(data, row.c);
              return (
                <li key={row.c.id} className={row.c.id === meId ? 'is-me' : ''}>
                  <a href={`#/c/${row.c.id}`} className="board-row">
                    <span className="board-rank">{row.provisional ? '–' : rank}</span>
                    {row.tier ? <Emblem track={track} tier={row.tier} size={40} /> : <span className="emblem-gap" />}
                    <span className="board-name">
                      <b>{fullName(row.c)}{weeklyDone(data, row.c.id) && <span className="weekly-dot" title="Completed this week’s challenge" aria-label="Completed this week’s challenge" />}</b>
                      <span className="muted">
                        {title && <span className="title-chip small-chip">{title}</span>}
                        {[divKey === 'all' && divisionOf(row.c, thisSeason)?.label, divKey !== 'all' && row.c.belt,
                          row.tier && TIER_NAMES[row.tier], row.provisional && 'provisional'].filter(Boolean).join(', ')}
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
      </section>
    </>
  );
}
