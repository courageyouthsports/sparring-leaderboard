import { useState } from 'react';
import { fullName, todayStr } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { go } from '../lib/router.js';
import { ErrorNote, Field } from '../components/ui.jsx';
import MatchRow, { blankMatch, checkMatches, matchPayload } from '../components/MatchRow.jsx';

const mondayOf = (d) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toLocaleDateString('en-CA');
};

// A class the student attended: any sparring or combat matches, and whether they did the weekly challenge.
export default function LogClass({ data, params, reload, isAdmin, isApprover }) {
  const editing = params.class ? data.classLogs.find((l) => l.id === params.class) : null;
  const choices = data.competitors.filter((c) => !c.is_placeholder && (isAdmin || data.myCompetitorIds.has(c.id)))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));

  const [form, setForm] = useState(() => (editing ? {
    competitor_id: editing.competitor_id, class_date: editing.class_date, challenge_done: editing.challenge_done, note: editing.note,
    matches: editing.matches.map((m) => ({
      ...blankMatch(), opponent_id: m.opponent_id, query: fullName(data.competitorById.get(m.opponent_id)),
      my: String(m.my_score), opp: String(m.opp_score), won: m.won, discipline: m.discipline,
    })),
  } : {
    competitor_id: params.competitor || (choices.length === 1 ? choices[0].id : ''),
    class_date: todayStr(), challenge_done: false, note: '', matches: [],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setMatch = (key, patch) => setForm((f) => ({ ...f, matches: f.matches.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));

  if (choices.length === 0) {
    return (
      <div className="empty">
        <h1>Log a class</h1>
        <p>First add your competitor. Then you can log their classes and in-class matches.</p>
        <a className="button primary" href="#/mine">Add a competitor</a>
      </div>
    );
  }

  const ch = data.challenge;
  const thisWeek = ch && mondayOf(form.class_date) === String(ch.week_start).slice(0, 10);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const msg = checkMatches(form.matches);
    if (msg) return setError(msg);
    setBusy(true);
    try {
      await rpc('log_class', { p: {
        class_log_id: editing?.id, competitor_id: form.competitor_id, class_date: form.class_date,
        challenge_done: form.challenge_done, note: form.note,
        matches: form.matches.map((m) => matchPayload(m, { withDiscipline: true })),
      } });
      await reload();
      go(`/c/${form.competitor_id}?sent=1`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="log">
      <h1>{editing ? 'Edit class' : 'Log a class'}</h1>
      <p className="lede">Log the class, any matches you sparred, and whether you hit the weekly challenge{isApprover ? '.' : '. Your instructor approves it.'}</p>
      {editing?.status === 'rejected' && editing.review_note && <p className="note">Instructor’s note: {editing.review_note}</p>}

      <fieldset>
        <legend>Class</legend>
        <div className="grid2">
          <Field label="Student">
            <select required value={form.competitor_id} onChange={(e) => set({ competitor_id: e.target.value })} disabled={!!editing}>
              <option value="">Choose…</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" required value={form.class_date} max={todayStr()} onChange={(e) => set({ class_date: e.target.value })} />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Weekly challenge</legend>
        {thisWeek && (
          <div className="challenge-mini">
            <b>{ch.title}</b> <span className="muted">+{ch.xp} XP</span>
            <p className="small">{ch.description}</p>
          </div>
        )}
        <label className="check big-check">
          <input type="checkbox" checked={form.challenge_done} onChange={(e) => set({ challenge_done: e.target.checked })} />
          {thisWeek ? 'I completed this challenge in a match at this class' : 'I completed that week’s challenge in a match at this class'}
        </label>
      </fieldset>

      <fieldset>
        <legend>Matches at this class</legend>
        {form.matches.length === 0 && <p className="muted small">No matches? That’s fine, attending still earns XP.</p>}
        {form.matches.map((m, i) => (
          <MatchRow key={m.key} n={i + 1} m={m} classMode data={data} self={form.competitor_id}
            onChange={(patch) => setMatch(m.key, patch)} onRemove={() => set({ matches: form.matches.filter((x) => x.key !== m.key) })} />
        ))}
        <button type="button" onClick={() => set({ matches: [...form.matches, blankMatch()] })}>Add a match</button>
      </fieldset>

      <fieldset>
        <legend>Note for your instructor (optional)</legend>
        <input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Scored the head kick against Ben in round 2" maxLength={300} />
      </fieldset>

      <ErrorNote error={error} />
      <div className="actions">
        <button className="primary" disabled={busy}>{busy ? 'Sending…' : isApprover ? 'Save class' : editing ? 'Save and resend for approval' : 'Send for approval'}</button>
        <a href="#/">Cancel</a>
      </div>
    </form>
  );
}
