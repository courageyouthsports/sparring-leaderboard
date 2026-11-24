import { useMemo, useState } from 'react';
import { seasonYear, todayStr } from '../lib/scoring.js';
import { matchDivision, standingsDivisions, studentFor } from '../lib/standings.js';
import { Segmented } from './ui.jsx';

const STATE_NAMES = { IN: 'Indiana' };

// ATA's official state standings, as last imported from MyATA. Our students are highlighted.
export default function StateBoard({ data, me }) {
  const all = data.standings || [];
  const latest = useMemo(() => [...new Set(all.map((r) => r.season))].sort().at(-1), [all]);
  const rows = useMemo(() => all.filter((r) => r.season === latest), [all, latest]);
  const students = useMemo(() => data.competitors.filter((c) => !c.is_placeholder), [data]);
  const [event, setEvent] = useState('sparring');
  const divisions = useMemo(() => standingsDivisions(rows, event), [rows, event]);

  // Default to the division the selected student is listed in, or the one they compete in.
  const myDivKey = useMemo(() => {
    if (!me) return null;
    const listed = rows.find((r) => r.event === event && studentFor(r, [me]));
    if (listed) return `${listed.gender}|${listed.rank}|${listed.age}`;
    return matchDivision(divisions, me, seasonYear(todayStr()))?.key || null;
  }, [rows, event, me, divisions]);
  const [choice, setChoice] = useState(null);
  const ourDivs = useMemo(() => new Set(rows.filter((r) => r.event === event && studentFor(r, students))
    .map((r) => `${r.gender}|${r.rank}|${r.age}`)), [rows, event, students]);
  const divKey = (choice && divisions.some((d) => d.key === choice) ? choice : null) ?? myDivKey ?? divisions[0]?.key;
  const division = divisions.find((d) => d.key === divKey);

  const list = rows.filter((r) => r.event === event && `${r.gender}|${r.rank}|${r.age}` === divKey)
    .sort((a, b) => a.place - b.place || (b.points || 0) - (a.points || 0));
  const state = rows[0]?.state;
  const updated = rows.reduce((m, r) => (r.imported_at > m ? r.imported_at : m), '');

  return (
    <>
      <div className="filters">
        <label className="division-pick">
          <span className="muted small">State division</span>
          <select value={divKey || ''} onChange={(e) => setChoice(e.target.value)} aria-label="State division">
            {divisions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}{d.key === myDivKey ? ' (yours)' : ourDivs.has(d.key) ? ' ★' : ''}
              </option>
            ))}
          </select>
        </label>
        <Segmented label="Event" value={event} onChange={setEvent} options={[['sparring', 'Sparring'], ['combat', 'Combat']]} />
      </div>
      <p className="muted small">
        ATA’s official {STATE_NAMES[state] || state} standings for the {latest?.replace('-', '–')} season
        {updated ? `, as of ${new Date(updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.
        {' '}Your school’s students are highlighted; ★ marks divisions they’re ranked in.
      </p>
      {list.length === 0 ? (
        <div className="empty"><p>No one is ranked in {division ? division.label : 'this division'} yet.</p></div>
      ) : (
        <ol className="board">
          {list.map((r) => {
            const ours = studentFor(r, students);
            const linked = ours || data.competitors.find((c) => c.id === r.competitor_id);
            const inner = (
              <>
                <span className="board-rank">{r.place}</span>
                <span className="board-name">
                  <b>{r.name}</b>
                  <span className="muted">
                    {ours && <span className="title-chip small-chip">{data.org.name}</span>}
                    {r.city}
                  </span>
                </span>
                <span className="board-value">
                  <b>{r.points ?? '–'}</b>
                  <span className="muted">pts</span>
                </span>
              </>
            );
            return (
              <li key={r.id} className={ours ? (ours.id === me?.id ? 'is-me' : 'is-ours') : ''}>
                {linked
                  ? <a href={`#/c/${linked.id}`} className="board-row state-row">{inner}</a>
                  : <div className="board-row state-row">{inner}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
