import { useMemo, useState } from 'react';
import { BELTS } from '../config.js';
import { entriesOf, fullName, xpFor, xpTier } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { Emblem, ErrorNote, Field } from '../components/ui.jsx';

export default function MyCompetitors({ data, reload }) {
  const mine = data.competitors.filter((c) => data.myCompetitorIds.has(c.id) && !c.is_placeholder);
  const [editing, setEditing] = useState(mine.length ? null : 'new');

  return (
    <>
      <h1>My competitors</h1>
      <p className="lede">Add yourself or your kids. You can log results for anyone on this list.</p>
      {mine.length > 0 && (
        <ul className="mine">
          {mine.map((c) => (
            <li key={c.id}>
              <Emblem track="experience" tier={xpTier(xpFor(data, c.id)).id} size={44} />
              <span className="mine-name">
                <a href={`#/c/${c.id}`}><b>{fullName(c)}</b></a>
                <span className="muted">{[c.belt, `ATA # ${data.ataNumbers.get(c.id) || '—'}`, `${entriesOf(data, c.id).length} results`].filter(Boolean).join(', ')}</span>
              </span>
              <button onClick={() => setEditing(c.id)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <CompetitorForm key={editing} data={data} competitor={editing === 'new' ? null : data.competitorById.get(editing)}
          onDone={async () => { await reload(); setEditing(null); }} onCancel={mine.length ? () => setEditing(null) : null} />
      ) : (
        <button className="primary" onClick={() => setEditing('new')}>Add a competitor</button>
      )}
    </>
  );
}

function CompetitorForm({ data, competitor, onDone, onCancel }) {
  const c = competitor;
  const [f, setF] = useState({
    first_name: c?.first_name || '', last_name: c?.last_name || '', school: c?.school || data.org.name,
    state: c?.state || 'IN', gender: c?.gender || '', birth_year: c?.birth_year || '', belt: c?.belt || '',
    leadership: c?.leadership || false, ata_number: c ? data.ataNumbers.get(c.id) || '' : '',
  });
  const [claim, setClaim] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  // Someone may already have logged a match against this person as an opponent.
  const matches = useMemo(() => {
    if (c || !f.first_name.trim() || !f.last_name.trim()) return [];
    const fn = f.first_name.trim().toLowerCase(), ln = f.last_name.trim().toLowerCase();
    return data.competitors.filter((x) => x.is_placeholder && x.first_name.toLowerCase() === fn && x.last_name.toLowerCase() === ln);
  }, [c, f.first_name, f.last_name, data]);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (c) await rpc('update_competitor', { p: { id: c.id, ...f } });
      else await rpc('create_competitor', { p: { org_id: data.org.id, ...f, claim_placeholder_id: claim || undefined } });
      await onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <form onSubmit={save} className="card stack">
      <h2>{c ? `Edit ${fullName(c)}` : 'Add a competitor'}</h2>
      <div className="grid2">
        <Field label="First name"><input required value={f.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
        <Field label="Last name"><input required value={f.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
        <Field label="ATA number" hint="Kept private: only you and the school’s admins can see it.">
          <input required value={f.ata_number} onChange={(e) => set({ ata_number: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Belt">
          <select value={f.belt} onChange={(e) => set({ belt: e.target.value })}>
            <option value="">Choose…</option>
            {BELTS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Birth year" hint="Used for ATA competition age groups.">
          <input type="number" min="1930" max="2030" inputMode="numeric" value={f.birth_year} onChange={(e) => set({ birth_year: e.target.value })} />
        </Field>
        <Field label="Division">
          <select value={f.gender} onChange={(e) => set({ gender: e.target.value })}>
            <option value="">Choose…</option><option value="M">Boys / men</option><option value="F">Girls / women</option>
          </select>
        </Field>
        <Field label="School"><input value={f.school} onChange={(e) => set({ school: e.target.value })} /></Field>
        <Field label="State"><input value={f.state} maxLength={2} onChange={(e) => set({ state: e.target.value.toUpperCase() })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.leadership} onChange={(e) => set({ leadership: e.target.checked })} />
        Registered in ATA’s Leadership or Legacy program (needed to earn individual ranking points)</label>

      {matches.length > 0 && (
        <div className="note">
          <p>Someone already logged matches against a {f.first_name} {f.last_name}. If that’s this competitor, link them so those matches count:</p>
          {matches.map((p) => (
            <label key={p.id} className="check">
              <input type="radio" name="claim" checked={claim === p.id} onChange={() => setClaim(p.id)} />
              {fullName(p)} {p.school && `from ${p.school}`}
            </label>
          ))}
          <label className="check"><input type="radio" name="claim" checked={!claim} onChange={() => setClaim(null)} /> No, that’s someone else</label>
        </div>
      )}

      <ErrorNote error={error} />
      <div className="actions">
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : c ? 'Save changes' : 'Add competitor'}</button>
        {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
