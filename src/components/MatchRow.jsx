import { useMemo } from 'react';
import { fullName } from '../lib/scoring.js';
import { Field, Segmented } from './ui.jsx';

let keySeq = 0;
export const newKey = () => ++keySeq;
export const blankMatch = () => ({
  key: newKey(), opponent_id: '', query: '', opponent: { first_name: '', last_name: '', school: '', state: 'IN' },
  newOpp: false, my: '', opp: '', won: null, team_score: '', opp_team_score: '', discipline: 'sparring',
});

// Turn a form match into what the database functions expect.
export function matchPayload(m, { team = false, withDiscipline = false } = {}) {
  return {
    opponent_id: m.opponent_id || undefined,
    opponent: m.opponent_id ? undefined : m.opponent,
    my_score: Number(m.my), opp_score: Number(m.opp),
    won: Number(m.my) === Number(m.opp) ? m.won : undefined,
    team_score: team && m.team_score !== '' ? Number(m.team_score) : undefined,
    opp_team_score: team && m.opp_team_score !== '' ? Number(m.opp_team_score) : undefined,
    discipline: withDiscipline ? m.discipline : undefined,
  };
}

// Returns an error message for the first incomplete match, or null.
export function checkMatches(matches, label = 'Match') {
  for (const [i, m] of matches.entries()) {
    if (!m.opponent_id && !(m.opponent.first_name.trim() && m.opponent.last_name.trim())) return `${label} ${i + 1}: choose or add the opponent.`;
    if (m.my === '' || m.opp === '') return `${label} ${i + 1}: enter both scores.`;
    if (Number(m.my) === Number(m.opp) && m.won == null) return `${label} ${i + 1}: the score is tied. Say who won.`;
  }
  return null;
}

export default function MatchRow({ n, m, cap, team, data, self, onChange, onRemove, classMode = false }) {
  const suggestions = useMemo(() => {
    const q = m.query.trim().toLowerCase();
    if (q.length < 2 || m.opponent_id) return [];
    return data.competitors
      .filter((c) => c.id !== self && (!classMode || !c.is_placeholder) && fullName(c).toLowerCase().includes(q))
      .slice(0, 6);
  }, [m.query, m.opponent_id, data, self, classMode]);
  const matchCap = classMode ? (m.discipline === 'combat' ? 10 : 5) : cap;
  const tied = m.my !== '' && m.opp !== '' && Number(m.my) === Number(m.opp);
  const overCap = matchCap && (Number(m.my) > matchCap + 2 || Number(m.opp) > matchCap + 2);

  return (
    <div className="match">
      <div className="match-top">
        <b>Match {n}</b>
        {onRemove && <button type="button" className="link danger" onClick={onRemove}>Remove</button>}
      </div>
      {classMode && (
        <Segmented label="Kind of match" value={m.discipline} onChange={(v) => onChange({ discipline: v })}
          options={[['sparring', 'Sparring'], ['combat', 'Combat']]} />
      )}
      {!m.newOpp ? (
        <div className="opp-pick">
          <Field label={classMode ? 'Classmate' : 'Opponent'}>
            <input value={m.query} placeholder="Start typing a name" autoComplete="off"
              onChange={(e) => onChange({ query: e.target.value, opponent_id: '' })} />
          </Field>
          {suggestions.length > 0 && (
            <ul className="suggest" role="listbox">
              {suggestions.map((c) => (
                <li key={c.id}><button type="button" onClick={() => onChange({ opponent_id: c.id, query: fullName(c) })}>
                  {fullName(c)} <span className="muted">{[c.school, c.state].filter(Boolean).join(', ')}</span>
                </button></li>
              ))}
            </ul>
          )}
          {!m.opponent_id && (
            <button type="button" className="link" onClick={() => {
              const [first, ...rest] = m.query.trim().split(/\s+/);
              onChange({ newOpp: true, opponent: { ...m.opponent, first_name: first || '', last_name: rest.join(' '), school: classMode ? data.org.name : m.opponent.school } });
            }}>{classMode ? 'Not in the app yet? Add their name' : 'Not listed? Add a new opponent'}</button>
          )}
        </div>
      ) : (
        <div className="grid2">
          <Field label="First name"><input required value={m.opponent.first_name} onChange={(e) => onChange({ opponent: { ...m.opponent, first_name: e.target.value } })} /></Field>
          <Field label="Last name"><input required value={m.opponent.last_name} onChange={(e) => onChange({ opponent: { ...m.opponent, last_name: e.target.value } })} /></Field>
          {!classMode && (
            <>
              <Field label="Their school (if known)"><input value={m.opponent.school} onChange={(e) => onChange({ opponent: { ...m.opponent, school: e.target.value } })} /></Field>
              <Field label="State"><input value={m.opponent.state} maxLength={2} onChange={(e) => onChange({ opponent: { ...m.opponent, state: e.target.value.toUpperCase() } })} /></Field>
            </>
          )}
          <button type="button" className="link" onClick={() => onChange({ newOpp: false })}>Pick someone from the list instead</button>
        </div>
      )}
      <div className="scores">
        <Field label={team ? 'Your bout score' : 'Your score'}>
          <input className="score-in red" type="number" min="0" max="99" inputMode="numeric" required value={m.my} onChange={(e) => onChange({ my: e.target.value })} />
        </Field>
        <Field label={team ? 'Their bout score' : 'Their score'}>
          <input className="score-in white" type="number" min="0" max="99" inputMode="numeric" required value={m.opp} onChange={(e) => onChange({ opp: e.target.value })} />
        </Field>
        {team && (
          <>
            <Field label="Your team total"><input type="number" min="0" inputMode="numeric" value={m.team_score} onChange={(e) => onChange({ team_score: e.target.value })} /></Field>
            <Field label="Their team total"><input type="number" min="0" inputMode="numeric" value={m.opp_team_score} onChange={(e) => onChange({ opp_team_score: e.target.value })} /></Field>
          </>
        )}
      </div>
      {tied && (
        <Segmented label="Who won the tied match" value={m.won} onChange={(v) => onChange({ won: v })}
          options={[[true, 'We won (sudden victory)'], [false, 'They won']]} />
      )}
      {overCap && <p className="small note">That’s higher than usual for a {matchCap}-point match. Double-check the score.</p>}
    </div>
  );
}
