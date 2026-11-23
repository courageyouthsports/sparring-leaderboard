import { useState } from 'react';
import { fullName } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { ErrorNote } from '../components/ui.jsx';

export default function Admin({ data, reload, session }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const org = data.org.id;
  const memberName = (uid) => data.members.find((m) => m.user_id === uid)?.display_name || 'Unknown account';

  async function act(fn, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(null);
    try { await fn(); await reload(); } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const students = data.competitors.filter((c) => !c.is_placeholder).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const opponents = data.competitors.filter((c) => c.is_placeholder).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

  return (
    <>
      <h1>Admin</h1>
      <ErrorNote error={error} />

      <section className="card">
        <h2>School code</h2>
        <p>Families join with this code after signing in:</p>
        <p className="join-code">{data.org.join_code}</p>
      </section>

      <section>
        <h2>Accounts <span className="muted">{data.members.length}</span></h2>
        <ul className="admin-list">
          {data.members.map((m) => (
            <li key={m.user_id}>
              <span><b>{m.display_name || 'No name'}</b> <span className="muted">{m.role === 'admin' ? 'Admin' : 'Family'}</span></span>
              {m.user_id !== session.user.id && (
                <span className="row-actions">
                  <button disabled={busy} onClick={() => act(() => rpc('set_member_role', { p_org: org, p_user: m.user_id, p_role: m.role === 'admin' ? 'member' : 'admin' }))}>
                    {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                  </button>
                  <button disabled={busy} className="link danger" onClick={() => act(() => rpc('remove_member', { p_org: org, p_user: m.user_id }), `Remove ${m.display_name}? Their competitors and results stay.`)}>Remove</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Students <span className="muted">{students.length}</span></h2>
        <ul className="admin-list">
          {students.map((c) => {
            const managers = data.managers.filter((x) => x.competitor_id === c.id);
            return (
              <li key={c.id} className="admin-student">
                <span>
                  <a href={`#/c/${c.id}`}><b>{fullName(c)}</b></a>
                  <span className="muted"> ATA # {data.ataNumbers.get(c.id) || '—'}</span>
                  <span className="small muted block">Managed by {managers.map((x) => memberName(x.user_id)).join(', ') || 'nobody'}</span>
                </span>
                <span className="row-actions">
                  <select aria-label={`Give an account access to ${fullName(c)}`} value="" disabled={busy}
                    onChange={(e) => e.target.value && act(() => rpc('add_manager', { p_competitor: c.id, p_user: e.target.value }))}>
                    <option value="">Give access to…</option>
                    {data.members.filter((m) => !managers.some((x) => x.user_id === m.user_id)).map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.display_name || 'No name'}</option>
                    ))}
                  </select>
                  <button disabled={busy} className="link danger" onClick={() => act(() => rpc('delete_competitor', { p_id: c.id }), `Delete ${fullName(c)} and all their results? This can’t be undone.`)}>Delete</button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>Opponent profiles <span className="muted">{opponents.length}</span></h2>
        <p className="small muted">Created when a family logs an opponent who isn’t in the app. If the same person was entered twice, merge the duplicate into the right one.</p>
        <ul className="admin-list">
          {opponents.map((c) => <OpponentRow key={c.id} c={c} all={data.competitors} busy={busy} act={act} />)}
        </ul>
      </section>
    </>
  );
}

function OpponentRow({ c, all, busy, act }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ first_name: c.first_name, last_name: c.last_name, school: c.school, state: c.state });
  if (edit) {
    return (
      <li className="opp-edit">
        <input aria-label="First name" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
        <input aria-label="Last name" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
        <input aria-label="School" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} />
        <input aria-label="State" value={f.state} maxLength={2} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} />
        <button disabled={busy} className="primary" onClick={() => act(() => rpc('update_placeholder', { p: { id: c.id, ...f } })).then(() => setEdit(false))}>Save</button>
        <button className="link" onClick={() => setEdit(false)}>Cancel</button>
      </li>
    );
  }
  return (
    <li>
      <span><a href={`#/c/${c.id}`}><b>{fullName(c)}</b></a> <span className="muted">{[c.school, c.state].filter(Boolean).join(', ')}</span></span>
      <span className="row-actions">
        <button onClick={() => setEdit(true)}>Edit</button>
        <select aria-label={`Merge ${fullName(c)} into`} value="" disabled={busy}
          onChange={(e) => {
            const into = all.find((x) => x.id === e.target.value);
            if (into) act(() => rpc('merge_competitor', { p_from: c.id, p_into: into.id }), `Merge ${fullName(c)} into ${fullName(into)}? Their matches move over.`);
          }}>
          <option value="">Merge into…</option>
          {all.filter((x) => x.id !== c.id).sort((a, b) => fullName(a).localeCompare(fullName(b))).map((x) => (
            <option key={x.id} value={x.id}>{fullName(x)}{x.school ? ` (${x.school})` : ''}</option>
          ))}
        </select>
      </span>
    </li>
  );
}
