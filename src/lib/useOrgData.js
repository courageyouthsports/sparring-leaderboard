import { useCallback, useEffect, useState } from 'react';
import { supabase, fetchAll } from './supabase.js';
import { indexData } from './scoring.js';

// Loads everything for the signed-in person's school. One school is small enough to load at once.
export function useOrgData(session) {
  const [state, setState] = useState({ loading: true, error: null, membership: null, data: null });

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const userId = session.user.id;
      const { data: mine, error: mErr } = await supabase
        .from('members').select('org_id, role, display_name').eq('user_id', userId).order('created_at').limit(1);
      if (mErr) throw new Error(mErr.message);
      if (!mine.length) { setState({ loading: false, error: null, membership: null, data: null }); return; }
      const membership = mine[0];
      const org = membership.org_id;

      const [orgRow, members, competitors, ratings, tournaments, entries, matches, managed, privateRows, challenges, completions, current, classLogs, classMatches, awarded, standings] = await Promise.all([
        supabase.from('orgs').select('*').eq('id', org).single().then((r) => { if (r.error) throw new Error(r.error.message); return r.data; }),
        fetchAll('members', 'user_id, role, display_name, created_at', (q) => q.eq('org_id', org)),
        fetchAll('competitors', '*', (q) => q.eq('org_id', org)),
        fetchAll('ratings'),
        fetchAll('tournaments', '*', (q) => q.eq('org_id', org)),
        fetchAll('entries'),
        fetchAll('matches'),
        fetchAll('competitor_managers'),
        fetchAll('competitor_private'),
        fetchAll('challenges', '*', (q) => q.eq('org_id', org).order('sort_order')),
        fetchAll('challenge_completions'),
        supabase.rpc('current_challenge', { p_org: org }).then((r) => { if (r.error) throw new Error(r.error.message); return r.data; }),
        fetchAll('class_logs'),
        fetchAll('class_matches'),
        fetchAll('competitor_titles'),
        fetchAll('state_standings', '*', (q) => q.eq('org_id', org)),
      ]);

      // Demo data is only for admins to look around; everyone else never sees it.
      const showDemo = membership.role === 'admin';
      const visible = showDemo ? competitors : competitors.filter((c) => !c.is_demo);
      const inOrg = new Set(visible.map((c) => c.id));
      const raw = {
        org: orgRow,
        members,
        competitors: visible,
        ratings: ratings.filter((r) => inOrg.has(r.competitor_id)),
        tournaments: showDemo ? tournaments : tournaments.filter((t) => !t.is_demo),
        entries: entries.filter((e) => inOrg.has(e.competitor_id)),
        matches,
        managers: managed,
        myCompetitorIds: new Set(managed.filter((m) => m.user_id === userId).map((m) => m.competitor_id)),
        ataNumbers: new Map(privateRows.map((p) => [p.competitor_id, p.ata_number])),
        challenges,
        completions: completions.filter((cc) => inOrg.has(cc.competitor_id)),
        challenge: (Array.isArray(current) ? current[0] : current) || null,   // this week's challenge
        classLogs: classLogs.filter((l) => inOrg.has(l.competitor_id)),
        classMatches,
        awardedTitles: awarded.filter((a) => inOrg.has(a.competitor_id)),
        standings,
        userId,
      };
      setState({ loading: false, error: null, membership, data: indexData(raw) });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
