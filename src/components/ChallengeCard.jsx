import { useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { weeklyDone } from '../lib/scoring.js';
import { ErrorNote } from './ui.jsx';

const short = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// This week's in-class challenge, with a button for each of the family's competitors.
export default function ChallengeCard({ data, competitors, reload, isAdmin }) {
  const ch = data.challenge;
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  if (!ch) {
    return isAdmin ? (
      <section className="challenge empty-challenge">
        <p>No weekly challenges are set up yet. <a href="#/admin">Add them on the Admin page.</a></p>
      </section>
    ) : null;
  }

  const start = String(ch.week_start).slice(0, 10);
  const end = new Date(`${start}T12:00:00`);
  end.setDate(end.getDate() + 6);

  async function run(key, fn) {
    setBusy(key); setError(null);
    try { await fn(); await reload(); } catch (e) { setError(e.message); }
    setBusy(null);
  }

  return (
    <section className="challenge">
      <div className="challenge-top">
        <span className="challenge-kind">This week’s challenge, {short(start)}–{short(end.toLocaleDateString('en-CA'))}</span>
        <span className="challenge-xp">+{ch.xp} XP</span>
      </div>
      <h2>{ch.title}</h2>
      <p>{ch.description}</p>
      {competitors.length > 0 && (
        <div className="challenge-actions">
          {competitors.map((c) => {
            const done = weeklyDone(data, c.id);
            return done ? (
              <span key={c.id} className="challenge-done">
                {c.first_name} completed it
                <button className="link" disabled={busy === c.id}
                  onClick={() => run(c.id, () => rpc('delete_challenge_completion', { p_id: done.id }))}>Undo</button>
              </span>
            ) : (
              <button key={c.id} className="primary" disabled={busy === c.id}
                onClick={() => run(c.id, () => rpc('log_challenge', { p_competitor: c.id }))}>
                {busy === c.id ? 'Saving…' : competitors.length > 1 ? `${c.first_name} completed it` : 'Mark as completed'}
              </button>
            );
          })}
        </div>
      )}
      <ErrorNote error={error} />
      <p className="small muted">Completed in class this week? Log it for {competitors.length > 1 ? 'each student' : 'the XP and this week’s badge'}. Honor system.</p>
    </section>
  );
}
