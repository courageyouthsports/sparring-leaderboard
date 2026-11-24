import { useState } from 'react';
import { fullName } from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { ErrorNote } from '../components/ui.jsx';

const ROLE_NAMES = { admin: 'Admin', instructor: 'Instructor', member: 'Family' };

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

      <DemoData data={data} busy={busy} act={act} />

      <Challenges data={data} busy={busy} act={act} />

      <section>
        <h2>Accounts <span className="muted">{data.members.length}</span></h2>
        <ul className="admin-list">
          {data.members.map((m) => (
            <li key={m.user_id}>
              <span><b>{m.display_name || 'No name'}</b> <span className="muted">{ROLE_NAMES[m.role]}</span></span>
              {m.user_id !== session.user.id && (
                <span className="row-actions">
                  <select aria-label={`Role for ${m.display_name}`} value={m.role} disabled={busy}
                    onChange={(e) => act(() => rpc('set_member_role', { p_org: org, p_user: m.user_id, p_role: e.target.value }))}>
                    <option value="member">Family</option><option value="instructor">Instructor (approves)</option><option value="admin">Admin</option>
                  </select>
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

function Challenges({ data, busy, act }) {
  const [editing, setEditing] = useState(null);   // challenge id, 'new', or null
  const list = data.challenges.slice().sort((a, b) => a.sort_order - b.sort_order);
  const current = data.challenge?.id;

  return (
    <section>
      <h2>Weekly challenges <span className="muted">{list.filter((c) => c.active).length} active</span></h2>
      <p className="small muted">A new one comes up every Monday, going down this list in order. Turn one off to skip it.</p>
      {list.length === 0 && (
        <p><button className="primary" disabled={busy} onClick={() => act(() => rpc('seed_starter_challenges', { p_org: data.org.id }))}>Add the 12 starter challenges</button></p>
      )}
      <ul className="admin-list">
        {list.map((ch) => (editing === ch.id ? (
          <li key={ch.id}><ChallengeForm data={data} ch={ch} busy={busy} act={act} done={() => setEditing(null)} /></li>
        ) : (
          <li key={ch.id} className={ch.active ? '' : 'inactive'}>
            <span>
              <b>{ch.title}</b> {ch.id === current && <span className="title-chip small-chip">This week</span>}
              <span className="muted"> {ch.xp} XP{ch.active ? '' : ', off'}</span>
              <span className="small muted block">{ch.description}</span>
            </span>
            <span className="row-actions">
              <button onClick={() => setEditing(ch.id)}>Edit</button>
              <button disabled={busy} onClick={() => act(() => rpc('save_challenge', { p: { ...ch, active: !ch.active } }))}>{ch.active ? 'Turn off' : 'Turn on'}</button>
              <button className="link danger" disabled={busy} onClick={() => act(() => rpc('delete_challenge', { p_id: ch.id }), `Remove "${ch.title}"? Students keep the XP from past weeks.`)}>Remove</button>
            </span>
          </li>
        )))}
      </ul>
      {editing === 'new'
        ? <ChallengeForm data={data} ch={null} busy={busy} act={act} done={() => setEditing(null)} />
        : <button onClick={() => setEditing('new')}>Add a challenge</button>}
    </section>
  );
}

function ChallengeForm({ data, ch, busy, act, done }) {
  const [f, setF] = useState({ title: ch?.title || '', description: ch?.description || '', xp: ch?.xp ?? 50 });
  return (
    <form className="challenge-form stack" onSubmit={(e) => { e.preventDefault(); act(() => rpc('save_challenge', { p: { ...(ch || {}), org_id: data.org.id, ...f, xp: Number(f.xp) } })).then(done); }}>
      <label className="field"><span className="field-label">Name</span><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="field"><span className="field-label">What to do</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label className="field"><span className="field-label">XP</span><input type="number" min="0" max="500" value={f.xp} onChange={(e) => setF({ ...f, xp: e.target.value })} /></label>
      <div className="actions"><button className="primary" disabled={busy}>Save challenge</button><button type="button" className="link" onClick={done}>Cancel</button></div>
    </form>
  );
}

function DemoData({ data, busy, act }) {
  const demo = data.competitors.find((c) => c.is_demo && !c.is_placeholder);
  return (
    <section className="card">
      <h2>Demo student</h2>
      <p className="small muted">A made-up student with every achievement, badge and title unlocked, plus made-up opponents and tournaments,
        so you can see how everything looks. Only admins see it, and it never affects real ratings.</p>
      <div className="actions">
        {demo && <a className="button" href={`#/c/${demo.id}`}>Open {demo.first_name} {demo.last_name}</a>}
        <button className="primary" disabled={busy} onClick={() => act(() => rpc('seed_demo', { p_org: data.org.id }))}>
          {demo ? 'Reset demo' : 'Add demo student'}
        </button>
        {demo && (
          <button className="link danger" disabled={busy}
            onClick={() => act(() => rpc('remove_demo', { p_org: data.org.id }), 'Remove the demo student and all demo data?')}>Remove demo</button>
        )}
      </div>
    </section>
  );
}
