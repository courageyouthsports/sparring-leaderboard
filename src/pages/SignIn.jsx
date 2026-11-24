import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { ErrorNote, Field } from '../components/ui.jsx';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function send(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) setError(err.message); else setSent(true);
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) setError('That code didn’t work. Check the newest email, or send a new code.');
  }

  return (
    <main className="narrow signin">
      <div className="signin-mark">
        <img src="/emblems/competitive/diamond.svg" alt="" width="72" height="72" />
      </div>
      <h1>Sparring Leaderboard</h1>
      <p className="lede">Log tournament matches, watch your rating climb, and earn your next tier.</p>
      {!sent ? (
        <form onSubmit={send} className="stack">
          <Field label="Email">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p>We sent a sign-in email to <b>{email}</b>. Tap the link in it on this device, or enter the code if the email has one.</p>
          <Field label="Code (if your email has one)">
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} required
              value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </Field>
          <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="link" onClick={() => { setSent(false); setCode(''); }}>Use a different email</button>
        </form>
      )}
      <ErrorNote error={error} />
    </main>
  );
}
