import { useEffect, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import { useOrgData } from './lib/useOrgData.js';
import { useRoute } from './lib/router.js';
import SignIn from './pages/SignIn.jsx';
import Join from './pages/Join.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Profile from './pages/Profile.jsx';
import LogResult from './pages/LogResult.jsx';
import MyCompetitors from './pages/MyCompetitors.jsx';
import Admin from './pages/Admin.jsx';
import LogClass from './pages/LogClass.jsx';
import Review, { pendingItems } from './pages/Review.jsx';

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return <main className="narrow"><h1>Almost there</h1><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the hosting settings, then deploy again.</p></main>;
  }
  if (session === undefined) return <main className="narrow"><p className="muted">Loading…</p></main>;
  if (!session) return <SignIn />;
  return <Signed session={session} />;
}

function Signed({ session }) {
  const { loading, error, membership, data, reload } = useOrgData(session);
  const route = useRoute();

  if (loading) return <main className="narrow"><p className="muted">Loading…</p></main>;
  if (error) return <main className="narrow"><p className="error">Couldn’t load the leaderboard: {error}</p><button onClick={reload}>Try again</button></main>;
  if (!membership) return <Join onJoined={reload} session={session} />;

  const isAdmin = membership.role === 'admin';
  const isApprover = isAdmin || membership.role === 'instructor';
  const props = { data, reload, session, membership, isAdmin, isApprover, params: route.params };
  const waiting = isApprover ? pendingItems(data).length : 0;
  const path = route.path;
  let page;
  if (path.startsWith('/c/')) page = <Profile {...props} id={path.slice(3)} />;
  else if (path === '/log') page = <LogResult key={route.params.entry || 'new'} {...props} />;
  else if (path === '/class') page = <LogClass key={route.params.class || 'new'} {...props} />;
  else if (path === '/review' && isApprover) page = <Review {...props} />;
  else if (path === '/mine') page = <MyCompetitors {...props} />;
  else if (path === '/admin' && isAdmin) page = <Admin {...props} />;
  else page = <Leaderboard {...props} />;

  const tab = path.startsWith('/c/') ? '' : path;
  return (
    <>
      <header className="bar">
        <a className="brand" href="#/">
          <img src="/emblems/competitive/gold.svg" alt="" width="28" height="28" />
          <span>Indiana <b>Fighter Tracker</b></span>
        </a>
        <nav className="nav" aria-label="Main">
          <a href="#/" aria-current={tab === '/' || tab === '' ? 'page' : undefined}>Home</a>
          <a href="#/class" aria-current={tab === '/class' ? 'page' : undefined}>Log a class</a>
          <a href="#/log" aria-current={tab === '/log' ? 'page' : undefined}>Log a tournament</a>
          <a href="#/mine" aria-current={tab === '/mine' ? 'page' : undefined}>My competitors</a>
          {isApprover && <a href="#/review" aria-current={tab === '/review' ? 'page' : undefined}>Review{waiting > 0 && <span className="count">{waiting}</span>}</a>}
          {isAdmin && <a href="#/admin" aria-current={tab === '/admin' ? 'page' : undefined}>Admin</a>}
        </nav>
      </header>
      <main className="page">{page}</main>
      <footer className="foot">
        <span>Signed in as {session.user.email}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </footer>
    </>
  );
}
