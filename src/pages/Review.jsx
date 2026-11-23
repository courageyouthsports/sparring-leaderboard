import { useState } from 'react';
import { DISCIPLINES } from '../config.js';
import { fullName } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { ErrorNote, Score, fmtDate, ordinal } from '../components/ui.jsx';

// Everything waiting for an instructor: whole tournament days and class logs.
export function pendingItems(data) {
  const days = new Map();
  for (const e of data.unapproved.filter((x) => x.status === 'pending')) {
    const k = e.submission_id || e.id;
    if (!days.has(k)) days.set(k, { kind: 'tournament', key: k, competitor_id: e.competitor_id, tournament: e.tournament, entries: [], created_at: e.created_at });
    days.get(k).entries.push(e);
  }
  const classes = data.classLogs.filter((l) => l.status === 'pending')
    .map((l) => ({ kind: 'class', key: l.id, competitor_id: l.competitor_id, log: l, created_at: l.created_at }));
  return [...days.values(), ...classes].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export default function Review({ data, reload }) {
  const items = pendingItems(data);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const name = (id) => fullName(data.competitorById.get(id));

  async function review(item, approve) {
    let note = '';
    if (!approve) {
      note = window.prompt(`What should ${data.competitorById.get(item.competitor_id)?.first_name} fix? They’ll see this note.`, '');
      if (note === null) return;
    }
    setBusy(item.key); setError(null);
    try {
      if (item.kind === 'tournament') await rpc('review_entries', { p_ids: item.entries.map((e) => e.id), p_approve: approve, p_note: note });
      else await rpc('review_class', { p_ids: [item.log.id], p_approve: approve, p_note: note });
      await reload();
    } catch (e) { setError(e.message); }
    setBusy(null);
  }

  async function approveAll() {
    if (!window.confirm(`Approve all ${items.length} submissions?`)) return;
    setBusy('all'); setError(null);
    try {
      const entryIds = items.filter((i) => i.kind === 'tournament').flatMap((i) => i.entries.map((e) => e.id));
      const classIds = items.filter((i) => i.kind === 'class').map((i) => i.log.id);
      if (entryIds.length) await rpc('review_entries', { p_ids: entryIds, p_approve: true, p_note: '' });
      if (classIds.length) await rpc('review_class', { p_ids: classIds, p_approve: true, p_note: '' });
      await reload();
    } catch (e) { setError(e.message); }
    setBusy(null);
  }

  return (
    <>
      <div className="board-head">
        <h1>Review</h1>
        {items.length > 1 && <button className="primary" disabled={!!busy} onClick={approveAll}>Approve all {items.length}</button>}
      </div>
      <p className="lede">Results and classes count once you approve them. Send one back with a note if something needs fixing.</p>
      <ErrorNote error={error} />
      {items.length === 0 ? (
        <div className="empty"><p>All caught up. Nothing is waiting for approval.</p></div>
      ) : (
        <ul className="results review-list">
          {items.map((item) => (
            <li key={item.key} className="result">
              <div className="result-head">
                <div>
                  <b>{name(item.competitor_id)}</b>
                  <span className="muted">
                    {item.kind === 'tournament'
                      ? ` ${item.tournament.name}, ${fmtDate(item.tournament.event_date)}, class ${item.tournament.tier}`
                      : ` Class on ${fmtDate(item.log.class_date)}`}
                  </span>
                </div>
                <span className="kind-tag">{item.kind === 'tournament' ? 'Tournament' : 'Class'}</span>
              </div>

              {item.kind === 'tournament' && item.entries.map((e) => (
                <div key={e.id} className="review-event">
                  <p className="small"><b>{e.team ? `Team ${DISCIPLINES[e.discipline].toLowerCase()}` : DISCIPLINES[e.discipline]}</b>
                    {e.placement ? `, ${ordinal(e.placement)} place` : ', did not place'}{e.ring_size ? `, ${e.ring_size} in ring` : ''}{!e.champion ? ', recreational' : ''}</p>
                  <ul className="matches">
                    {e.matches.map((m) => (
                      <li key={m.id}><Score mine={m.my_score} theirs={m.opp_score} won={m.won} />
                        <span className="vs">vs {name(m.opponent_id)}{e.team && m.team_score != null && <span className="muted"> · team {m.team_score}–{m.opp_team_score}</span>}</span></li>
                    ))}
                  </ul>
                </div>
              ))}

              {item.kind === 'class' && (
                <div className="review-event">
                  {item.log.challenge_done && <p className="small"><span className="weekly-chip">Weekly challenge done</span></p>}
                  {item.log.matches.length === 0 && <p className="small muted">Attended, no matches logged.</p>}
                  <ul className="matches">
                    {item.log.matches.map((m) => (
                      <li key={m.id}><Score mine={m.my_score} theirs={m.opp_score} won={m.won} />
                        <span className="vs">vs {name(m.opponent_id)} <span className="muted">({m.discipline})</span></span></li>
                    ))}
                  </ul>
                  {item.log.note && <p className="small">“{item.log.note}”</p>}
                </div>
              )}

              <div className="row-actions review-actions">
                <button className="primary" disabled={!!busy} onClick={() => review(item, true)}>{busy === item.key ? 'Saving…' : 'Approve'}</button>
                <button disabled={!!busy} onClick={() => review(item, false)}>Send back</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
