import { useMemo, useState } from 'react';
import { TIERS, TIER_LABELS } from '../config.js';
import { fullName, todayStr } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { go } from '../lib/router.js';
import { ErrorNote, Field, Segmented, fmtDate } from '../components/ui.jsx';

let keySeq = 0;
const blankMatch = () => ({ key: ++keySeq, opponent_id: '', query: '', opponent: { first_name: '', last_name: '', school: '', state: 'IN' }, newOpp: false, my: '', opp: '', won: null, team_score: '', opp_team_score: '' });

export default function LogResult({ data, params, reload, isAdmin }) {
  const editing = params.entry ? data.entries.find((e) => e.id === params.entry) : null;
  const choices = data.competitors.filter((c) => !c.is_placeholder && (isAdmin || data.myCompetitorIds.has(c.id)))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const tournaments = [...data.tournaments.values()].sort((a, b) => b.event_date.localeCompare(a.event_date));

  const [form, setForm] = useState(() => {
    if (editing) {
      return {
        competitor_id: editing.competitor_id, tournament_id: editing.tournament_id,
        t: { name: '', event_date: todayStr(), tier: 'B', location: '' },
        discipline: editing.discipline, team: editing.team, team_name: editing.team_name, champion: editing.champion,
        division: editing.division, placement: editing.placement || '', ring_size: editing.ring_size || '',
        matches: editing.matches.map((m) => ({
          ...blankMatch(), opponent_id: m.opponent_id, query: fullName(data.competitorById.get(m.opponent_id)),
          my: String(m.my_score), opp: String(m.opp_score), won: m.won,
          team_score: m.team_score ?? '', opp_team_score: m.opp_team_score ?? '',
        })),
      };
    }
    return {
      competitor_id: params.competitor || (choices.length === 1 ? choices[0].id : ''),
      tournament_id: '', t: { name: '', event_date: todayStr(), tier: 'B', location: '' },
      discipline: 'sparring', team: false, team_name: '', champion: true, division: '', placement: '', ring_size: '',
      matches: [blankMatch()],
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setMatch = (key, patch) => setForm((f) => ({ ...f, matches: f.matches.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));

  if (choices.length === 0) {
    return (
      <div className="empty">
        <h1>Log a result</h1>
        <p>First add your competitor, with their ATA number. Then you can log their tournament matches.</p>
        <a className="button primary" href="#/mine">Add a competitor</a>
      </div>
    );
  }

  const selectedTournament = data.tournaments.get(form.tournament_id);
  const tier = selectedTournament?.tier || form.t.tier;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    for (const [i, m] of form.matches.entries()) {
      if (!m.opponent_id && !(m.opponent.first_name.trim() && m.opponent.last_name.trim())) return setError(`Match ${i + 1}: choose or add the opponent.`);
      if (m.my === '' || m.opp === '') return setError(`Match ${i + 1}: enter both scores.`);
      if (Number(m.my) === Number(m.opp) && m.won == null) return setError(`Match ${i + 1}: the score is tied. Say who won.`);
    }
    setBusy(true);
    try {
      const payload = {
        entry_id: editing?.id,
        competitor_id: form.competitor_id,
        tournament: form.tournament_id ? { id: form.tournament_id } : form.t,
        discipline: form.discipline, team: form.team, team_name: form.team_name, champion: form.champion,
        division: form.division, placement: form.placement || null, ring_size: form.ring_size || null,
        matches: form.matches.map((m) => ({
          opponent_id: m.opponent_id || undefined,
          opponent: m.opponent_id ? undefined : m.opponent,
          my_score: Number(m.my), opp_score: Number(m.opp),
          won: Number(m.my) === Number(m.opp) ? m.won : undefined,
          team_score: form.team && m.team_score !== '' ? Number(m.team_score) : undefined,
          opp_team_score: form.team && m.opp_team_score !== '' ? Number(m.opp_team_score) : undefined,
        })),
      };
      await rpc('log_entry', { p: payload });
      await reload();
      go(`/c/${form.competitor_id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const cap = form.team ? null : form.discipline === 'combat' ? 10 : 5;

  return (
    <form onSubmit={submit} className="log">
      <h1>{editing ? 'Edit result' : 'Log a result'}</h1>

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
            <Field label="Date"><input type="date" required value={form.t.event_date} onChange={(e) => set({ t: { ...form.t, event_date: e.target.value } })} /></Field>
            <Field label="Class">
              <select value={form.t.tier} onChange={(e) => set({ t: { ...form.t, tier: e.target.value } })}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="City (optional)"><input value={form.t.location} onChange={(e) => set({ t: { ...form.t, location: e.target.value } })} /></Field>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Event</legend>
        <Segmented label="Event" value={form.discipline} onChange={(v) => set({ discipline: v })} options={[['sparring', 'Sparring'], ['combat', 'Combat sparring']]} />
        <Segmented label="Individual or team" value={form.team} onChange={(v) => set({ team: v })} options={[[false, 'Individual'], [true, 'Team']]} />
        {form.team && <Field label="Team name (optional)"><input value={form.team_name} onChange={(e) => set({ team_name: e.target.value })} /></Field>}
        <div className="grid2">
          <Field label="Placement">
            <select value={form.placement} onChange={(e) => set({ placement: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">Didn’t place</option><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option>
            </select>
          </Field>
          <Field label="Competitors in the ring" hint={tier === 'C' ? 'Needed for class C points.' : 'Optional.'}>
            <input type="number" min="1" max="64" inputMode="numeric" value={form.ring_size} required={tier === 'C' && !!form.placement}
              onChange={(e) => set({ ring_size: e.target.value ? Number(e.target.value) : '' })} />
          </Field>
          <Field label="Division (optional)"><input value={form.division} onChange={(e) => set({ division: e.target.value })} placeholder="e.g. Boys 11–12, 1st Degree" /></Field>
          <label className="check"><input type="checkbox" checked={!form.champion} onChange={(e) => set({ champion: !e.target.checked })} /> Recreational division (no ranking points)</label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Matches, in order</legend>
        {form.team && <p className="small muted">For each team match, enter your own bout score (it counts toward your rating) and the team totals.</p>}
        {form.matches.map((m, i) => (
          <MatchRow key={m.key} n={i + 1} m={m} cap={cap} team={form.team} data={data} self={form.competitor_id}
            onChange={(patch) => setMatch(m.key, patch)}
            onRemove={form.matches.length > 1 ? () => set({ matches: form.matches.filter((x) => x.key !== m.key) }) : null} />
        ))}
        <button type="button" onClick={() => set({ matches: [...form.matches, blankMatch()] })}>Add another match</button>
      </fieldset>

      <ErrorNote error={error} />
      <div className="actions">
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save result'}</button>
        <a href={editing ? `#/c/${editing.competitor_id}` : '#/'}>Cancel</a>
      </div>
      <p className="small muted">Results are on the honor system. Please log scores exactly as they were called.</p>
    </form>
  );
}

function MatchRow({ n, m, cap, team, data, self, onChange, onRemove }) {
  const suggestions = useMemo(() => {
    const q = m.query.trim().toLowerCase();
    if (q.length < 2 || m.opponent_id) return [];
    return data.competitors.filter((c) => c.id !== self && fullName(c).toLowerCase().includes(q)).slice(0, 6);
  }, [m.query, m.opponent_id, data, self]);
  const tied = m.my !== '' && m.opp !== '' && Number(m.my) === Number(m.opp);
  const overCap = cap && (Number(m.my) > cap + 2 || Number(m.opp) > cap + 2);

  return (
    <div className="match">
      <div className="match-top">
        <b>Match {n}</b>
        {onRemove && <button type="button" className="link danger" onClick={onRemove}>Remove</button>}
      </div>
      {!m.newOpp ? (
        <div className="opp-pick">
          <Field label="Opponent">
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
              onChange({ newOpp: true, opponent: { ...m.opponent, first_name: first || '', last_name: rest.join(' ') } });
            }}>Not listed? Add a new opponent</button>
          )}
        </div>
      ) : (
        <div className="grid2">
          <Field label="Opponent first name"><input required value={m.opponent.first_name} onChange={(e) => onChange({ opponent: { ...m.opponent, first_name: e.target.value } })} /></Field>
          <Field label="Last name"><input required value={m.opponent.last_name} onChange={(e) => onChange({ opponent: { ...m.opponent, last_name: e.target.value } })} /></Field>
          <Field label="Their school (if known)"><input value={m.opponent.school} onChange={(e) => onChange({ opponent: { ...m.opponent, school: e.target.value } })} /></Field>
          <Field label="State"><input value={m.opponent.state} maxLength={2} onChange={(e) => onChange({ opponent: { ...m.opponent, state: e.target.value.toUpperCase() } })} /></Field>
          <button type="button" className="link" onClick={() => onChange({ newOpp: false })}>Pick an existing opponent instead</button>
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
      {overCap && <p className="small note">That’s higher than usual for a {cap}-point match. Double-check the score.</p>}
    </div>
  );
}
