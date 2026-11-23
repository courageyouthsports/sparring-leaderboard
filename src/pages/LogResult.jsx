import { useState } from 'react';
import { TIERS, TIER_LABELS } from '../config.js';
import { fullName, todayStr } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { go } from '../lib/router.js';
import { ErrorNote, Field, Segmented, fmtDate } from '../components/ui.jsx';
import MatchRow, { blankMatch, checkMatches, matchPayload, newKey } from '../components/MatchRow.jsx';

const blankEvent = (discipline = 'sparring', team = false) => ({
  key: newKey(), discipline, team, team_name: '', champion: true, division: '', placement: '', ring_size: '', matches: [blankMatch()],
});
const EVENT_LABEL = (e) => `${e.team ? 'Team ' : ''}${e.discipline === 'combat' ? 'combat sparring' : 'sparring'}`;

// Log a whole tournament day: one or more events (sparring, combat, team), each with its matches.
// Editing an existing result works on that one event.
export default function LogResult({ data, params, reload, isAdmin, isApprover }) {
  const editing = params.entry ? data.allEntries.find((e) => e.id === params.entry) : null;
  const choices = data.competitors.filter((c) => !c.is_placeholder && (isAdmin || data.myCompetitorIds.has(c.id)))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const tournaments = [...data.tournaments.values()].sort((a, b) => b.event_date.localeCompare(a.event_date));

  const [form, setForm] = useState(() => {
    if (editing) {
      return {
        competitor_id: editing.competitor_id, tournament_id: editing.tournament_id,
        t: { name: '', event_date: todayStr(), tier: 'B', location: '' },
        events: [{
          key: newKey(), discipline: editing.discipline, team: editing.team, team_name: editing.team_name,
          champion: editing.champion, division: editing.division, placement: editing.placement || '', ring_size: editing.ring_size || '',
          matches: editing.matches.map((m) => ({
            ...blankMatch(), opponent_id: m.opponent_id, query: fullName(data.competitorById.get(m.opponent_id)),
            my: String(m.my_score), opp: String(m.opp_score), won: m.won,
            team_score: m.team_score ?? '', opp_team_score: m.opp_team_score ?? '',
          })),
        }],
      };
    }
    return {
      competitor_id: params.competitor || (choices.length === 1 ? choices[0].id : ''),
      tournament_id: '', t: { name: '', event_date: todayStr(), tier: 'B', location: '' },
      events: [blankEvent()],
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setEvent = (key, patch) => setForm((f) => ({ ...f, events: f.events.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));
  const setMatch = (ek, mk, patch) => setForm((f) => ({
    ...f, events: f.events.map((e) => (e.key === ek ? { ...e, matches: e.matches.map((m) => (m.key === mk ? { ...m, ...patch } : m)) } : e)),
  }));

  if (choices.length === 0) {
    return (
      <div className="empty">
        <h1>Log a tournament</h1>
        <p>First add your competitor, with their ATA number. Then you can log their tournament matches.</p>
        <a className="button primary" href="#/mine">Add a competitor</a>
      </div>
    );
  }

  const tier = data.tournaments.get(form.tournament_id)?.tier || form.t.tier;
  const used = new Set(form.events.map((e) => `${e.discipline}-${e.team}`));
  const addable = [['sparring', false], ['combat', false], ['sparring', true], ['combat', true]].filter(([d, t]) => !used.has(`${d}-${t}`));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (new Set(form.events.map((ev) => `${ev.discipline}-${ev.team}`)).size !== form.events.length) return setError('Each event can only be added once per tournament.');
    for (const ev of form.events) {
      const msg = checkMatches(ev.matches, `${EVENT_LABEL(ev)}, match`);
      if (msg) return setError(msg[0].toUpperCase() + msg.slice(1));
    }
    const event = (ev) => ({
      discipline: ev.discipline, team: ev.team, team_name: ev.team_name, champion: ev.champion, division: ev.division,
      placement: ev.placement || null, ring_size: ev.ring_size || null,
      matches: ev.matches.map((m) => matchPayload(m, { team: ev.team })),
    });
    const tournament = form.tournament_id ? { id: form.tournament_id } : form.t;
    setBusy(true);
    try {
      if (editing) {
        await rpc('log_entry', { p: { entry_id: editing.id, competitor_id: form.competitor_id, tournament, ...event(form.events[0]) } });
      } else {
        await rpc('log_tournament_day', { p: { competitor_id: form.competitor_id, tournament, events: form.events.map(event) } });
      }
      await reload();
      go(`/c/${form.competitor_id}?sent=1`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="log">
      <h1>{editing ? 'Edit result' : 'Log a tournament'}</h1>
      {!editing && <p className="lede">Add every event from the day, then send it all at once{isApprover ? '.' : ' for your instructor to approve.'}</p>}
      {editing?.status === 'rejected' && editing.review_note && <p className="note">Instructor’s note: {editing.review_note}</p>}

      <fieldset>
        <legend>Who and where</legend>
        <Field label="Competitor">
          <select required value={form.competitor_id} onChange={(e) => set({ competitor_id: e.target.value })} disabled={!!editing}>
            <option value="">Choose…</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
          </select>
        </Field>
        <Field label="Tournament">
          <select value={form.tournament_id} onChange={(e) => set({ tournament_id: e.target.value })}>
            <option value="">A new tournament…</option>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}, {fmtDate(t.event_date)} ({t.tier})</option>)}
          </select>
        </Field>
        {!form.tournament_id && (
          <div className="grid2">
            <Field label="Tournament name"><input required value={form.t.name} onChange={(e) => set({ t: { ...form.t, name: e.target.value } })} placeholder="e.g. Indianapolis Regional" /></Field>
            <Field label="Date"><input type="date" required value={form.t.event_date} max={todayStr()} onChange={(e) => set({ t: { ...form.t, event_date: e.target.value } })} /></Field>
            <Field label="Class">
              <select value={form.t.tier} onChange={(e) => set({ t: { ...form.t, tier: e.target.value } })}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="City (optional)"><input value={form.t.location} onChange={(e) => set({ t: { ...form.t, location: e.target.value } })} /></Field>
          </div>
        )}
      </fieldset>

      {form.events.map((ev, ei) => (
        <fieldset key={ev.key} className="event-block">
          <legend>
            {editing ? 'Event' : `Event ${ei + 1}: ${EVENT_LABEL(ev)}`}
            {form.events.length > 1 && (
              <button type="button" className="link danger legend-action" onClick={() => set({ events: form.events.filter((x) => x.key !== ev.key) })}>Remove event</button>
            )}
          </legend>
          <Segmented label="Event" value={ev.discipline} onChange={(v) => setEvent(ev.key, { discipline: v })} options={[['sparring', 'Sparring'], ['combat', 'Combat sparring']]} />
          <Segmented label="Individual or team" value={ev.team} onChange={(v) => setEvent(ev.key, { team: v })} options={[[false, 'Individual'], [true, 'Team']]} />
          {ev.team && <Field label="Team name (optional)"><input value={ev.team_name} onChange={(e) => setEvent(ev.key, { team_name: e.target.value })} /></Field>}
          <div className="grid2">
            <Field label="Placement">
              <select value={ev.placement} onChange={(e) => setEvent(ev.key, { placement: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Didn’t place</option><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option>
              </select>
            </Field>
            <Field label="Competitors in the ring" hint={tier === 'C' ? 'Needed for class C points.' : 'Optional.'}>
              <input type="number" min="1" max="64" inputMode="numeric" value={ev.ring_size} required={tier === 'C' && !!ev.placement}
                onChange={(e) => setEvent(ev.key, { ring_size: e.target.value ? Number(e.target.value) : '' })} />
            </Field>
            <Field label="Division (optional)"><input value={ev.division} onChange={(e) => setEvent(ev.key, { division: e.target.value })} placeholder="e.g. Junior Girls 11–12, 1st Degree" /></Field>
            <label className="check"><input type="checkbox" checked={!ev.champion} onChange={(e) => setEvent(ev.key, { champion: !e.target.checked })} /> Recreational division (no ranking points)</label>
          </div>
          {ev.team && <p className="small muted">For each team match, enter your own bout score (it counts toward your rating) and the team totals.</p>}
          {ev.matches.map((m, i) => (
            <MatchRow key={m.key} n={i + 1} m={m} cap={ev.team ? null : ev.discipline === 'combat' ? 10 : 5} team={ev.team} data={data} self={form.competitor_id}
              onChange={(patch) => setMatch(ev.key, m.key, patch)}
              onRemove={ev.matches.length > 1 ? () => setEvent(ev.key, { matches: ev.matches.filter((x) => x.key !== m.key) }) : null} />
          ))}
          <button type="button" onClick={() => setEvent(ev.key, { matches: [...ev.matches, blankMatch()] })}>Add another match</button>
        </fieldset>
      ))}

      {!editing && addable.length > 0 && (
        <div className="add-event">
          <span className="muted">Also competed in:</span>
          {addable.map(([d, t]) => (
            <button key={`${d}-${t}`} type="button" onClick={() => set({ events: [...form.events, blankEvent(d, t)] })}>
              + {t ? 'Team ' : ''}{d === 'combat' ? 'combat' : 'sparring'}
            </button>
          ))}
        </div>
      )}

      <ErrorNote error={error} />
      <div className="actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Sending…' : editing ? (isApprover ? 'Save changes' : 'Save and resend for approval') : isApprover ? 'Save tournament' : 'Send for approval'}
        </button>
        <a href={editing ? `#/c/${editing.competitor_id}` : '#/'}>Cancel</a>
      </div>
      <p className="small muted">Log scores exactly as they were called. Results count once an instructor approves them.</p>
    </form>
  );
}
