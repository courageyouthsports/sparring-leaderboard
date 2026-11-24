// Stand-in for the Supabase client used by the demo build (/demo/).
// Serves a fixed, made-up data set; nothing is saved.
import fx from './fixtures.json';
const session = { user: { id: fx.userId, email: 'demo@example.com' } };
function builder(table) {
  let rows = (fx[table] || []).slice();
  const b = {
    select() { return b; }, eq(k, v) { rows = rows.filter((r) => r[k] === v); return b; },
    in(k, vs) { rows = rows.filter((r) => vs.includes(r[k])); return b; },
    order() { return b; }, limit(n) { rows = rows.slice(0, n); return b; },
    range(a, z) { rows = rows.slice(a, z + 1); return b; },
    single() { return Promise.resolve({ data: rows[0], error: null }); },
    maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
  };
  return b;
}
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ error: null }), signOut: async () => {},
    },
    from: builder,
    rpc: async (name) => (name === 'current_challenge'
      ? { data: fx.current, error: null }
      : { data: null, error: { message: 'This is a demo, so nothing is saved.' } }),
  };
}
