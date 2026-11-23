import { useState } from 'react';
import { rpc, supabase } from '../lib/supabase.js';
import { ErrorNote, Field } from '../components/ui.jsx';

export default function Join({ onJoined, session }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function join(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await rpc('join_org', { p_code: code, p_display_name: name }); onJoined(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <main className="narrow">
      <h1>Join your school</h1>
      <p className="lede">Enter the school code from your instructor. You only need to do this once.</p>
      <form onSubmit={join} className="stack">
        <Field label="Your name" hint="Shown to your school’s admins, e.g. “Jamie Smith (Ava’s mom)”.">
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="School code">
          <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6}
            autoCapitalize="characters" className="code-input" />
        </Field>
        <button className="primary" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
      </form>
      <ErrorNote error={error} />
      <p className="muted small">Signed in as {session.user.email}. <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button></p>
    </main>
  );
}
