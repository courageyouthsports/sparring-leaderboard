import { useState } from 'react';
import { DISCIPLINES, PROVISIONAL_MATCHES, TIER_NAMES, XP_TIERS, RATING_TIERS } from '../config.js';
import {
  badgesFor, entriesOf, fullName, nextTier, ratingHistory, ratingOf, ratingTier, recordOf, seasonLabel, seasonPoints,
  seasonYear, teamRecordOf, todayStr, xpFor, xpTier,
} from '../lib/scoring.js';
import { rpc } from '../lib/supabase.js';
import { Delta, Emblem, ErrorNote, Score, Sparkline, fmtDate, ordinal } from '../components/ui.jsx';

const EVENT_NAMES = { sparring: 'Sparring', combat: 'Combat sparring', 'team-sparring': 'Team sparring', 'team-combat': 'Team combat' };

export default function Profile({ data, id, reload, isAdmin }) {
  const c = data.competitorById.get(id);
  const [error, setError] = useState(null);
  if (!c) return <p>That competitor wasn’t found. <a href="#/">Back to rankings</a></p>;
  if (c.is_placeholder) return <OpponentProfile data={data} c={c} />;

  const canManage = data.myCompetitorIds.has(id) || isAdmin;
  const mine = data.myCompetitorIds.has(id);
  const xp = xpFor(data, id);
  const xt = xpTier(xp);
  const xn = nextTier(xp, XP_TIERS);
  const season = seasonYear(todayStr());
  const sp = seasonPoints(data, id, season);
  const badges = badgesFor(data, id);
  const entries = entriesOf(data, id);
  const team = teamRecordOf(data, id);

  async function remove(entryId) {
    if (!window.confirm('Delete this result? Ratings will be recalculated.')) return;
    try { await rpc('delete_entry', { p_entry: entryId }); reload(); } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="profile-head">
        <h1>{fullName(c)}</h1>
        <p className="muted">{[c.belt, c.school, c.state].filter(Boolean).join(', ')}</p>
        {(mine || canManage) && <a className="button primary" href={`#/log?competitor=${id}`}>Log a result</a>}
      </div>

      <section className="tiers">
        <div className="tier-card">
          <Emblem track="experience" tier={xt.id} size={72} />
          <div>
            <h2>{TIER_NAMES[xt.id]} <span className="muted">experience</span></h2>
            <p className="big">{xp.toLocaleString()} <span className="unit">XP</span></p>
            {xn ? (
              <>
                <div className="progress" role="progressbar" aria-valuemin={xt.min} aria-valuemax={xn.min} aria-valuenow={xp}>
                  <span style={{ width: `${((xp - xt.min) / (xn.min - xt.min)) * 100}%` }} />
                </div>
                <p className="small muted">{(xn.min - xp).toLocaleString()} XP to {TIER_NAMES[xn.id]}</p>
              </>
            ) : <p className="small muted">Top tier reached</p>}
          </div>
        </div>
        {['sparring', 'combat'].map((d) => <RatingCard key={d} data={data} id={id} discipline={d} />)}
      </section>

      <section>
        <h2>ATA points, {seasonLabel(season)} season</h2>
        {Object.keys(sp.events).length === 0 ? (
          <p className="muted">No results logged this season yet.</p>
        ) : (
          <>
            {!c.leadership && <p className="note">Individual points only count for students registered in ATA’s Leadership or Legacy program. If {c.first_name} is registered, turn it on under My competitors.</p>}
            <div className="points-grid">
              {Object.entries(sp.events).map(([key, ev]) => (
                <div key={key} className="points-card">
                  <h3>{EVENT_NAMES[key]}</h3>
                  <p className="big">{ev.total} <span className="unit">pts</span></p>
                  <ul className="points-list">
                    {ev.rows.map((r) => (
                      <li key={r.entry.id} className={r.counted ? '' : 'not-counted'}>
                        <span>{r.entry.tournament.name} <span className="muted">({r.entry.tournament.tier}{r.entry.placement ? `, ${ordinal(r.entry.placement)}` : ''})</span></span>
                        <span>{r.points}{!r.counted && r.points > 0 ? ' (not counted)' : ''}{r.note ? ` · ${r.note}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="small muted">Compare with ATA’s state standings, which update weekly. Corrections must reach ATA within 30 days of a tournament being posted.</p>
          </>
        )}
      </section>

      <section>
        <h2>Badges <span className="muted">{badges.filter((b) => b.earned).length} of {badges.length}</span></h2>
        <ul className="badges">
          {badges.map((b) => (
            <li key={b.id} className={b.earned ? 'earned' : ''}>
              <b>{b.name}</b><span>{b.desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Results</h2>
        {(team.wins + team.losses > 0) && <p className="muted">Team record {team.wins}–{team.losses}</p>}
        <ErrorNote error={error} />
        {entries.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <ul className="results">
            {entries.map((e) => (
              <li key={e.id} className="result">
                <div className="result-head">
                  <div>
                    <b>{e.tournament.name}</b>
                    <span className="muted"> {fmtDate(e.tournament.event_date)}, class {e.tournament.tier}</span>
                  </div>
                  {e.placement && <span className={`place place-${e.placement}`}>{ordinal(e.placement)}</span>}
                </div>
                <p className="small muted">
                  {[e.team ? `Team ${DISCIPLINES[e.discipline].toLowerCase()}${e.team_name ? ` (${e.team_name})` : ''}` : DISCIPLINES[e.discipline],
                    e.division, !e.champion && 'Recreational', e.ring_size && `${e.ring_size} in ring`].filter(Boolean).join(', ')}
                </p>
                <ul className="matches">
                  {e.matches.map((m) => (
                    <li key={m.id}>
                      <Score mine={m.my_score} theirs={m.opp_score} won={m.won} />
                      <span className="vs">vs <a href={`#/c/${m.opponent_id}`}>{fullName(data.competitorById.get(m.opponent_id))}</a>
                        {e.team && m.team_score != null && <span className="muted"> · team {m.team_score}–{m.opp_team_score}</span>}
                      </span>
                      <Delta before={m.rating_before} after={m.rating_after} />
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <div className="row-actions">
                    <a href={`#/log?entry=${e.id}`}>Edit</a>
                    <button className="link danger" onClick={() => remove(e.id)}>Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RatingCard({ data, id, discipline }) {
  const r = ratingOf(data, id, discipline);
  if (!r) {
    return (
      <div className="tier-card faded">
        <Emblem track="competitive" tier="bronze" size={72} />
        <div><h2>{DISCIPLINES[discipline]}</h2><p className="muted">No matches yet. Everyone starts at 1000.</p></div>
      </div>
    );
  }
  const t = ratingTier(r.rating);
  const n = nextTier(Number(r.rating), RATING_TIERS);
  const rec = recordOf(data, id, discipline);
  return (
    <div className="tier-card">
      <Emblem track="competitive" tier={t.id} size={72} />
      <div>
        <h2>{TIER_NAMES[t.id]} <span className="muted">{DISCIPLINES[discipline].toLowerCase()}</span></h2>
        <p className="big">{Math.round(r.rating)} <span className="unit">rating</span></p>
        <p className="small muted">
          {rec.wins}–{rec.losses} record, peak {Math.round(r.peak)}
          {r.matches < PROVISIONAL_MATCHES ? `, provisional until ${PROVISIONAL_MATCHES} matches` : n ? `, ${Math.ceil(n.min - r.rating)} to ${TIER_NAMES[n.id]}` : ''}
        </p>
        <Sparkline points={ratingHistory(data, id, discipline)} />
      </div>
    </div>
  );
}

function OpponentProfile({ data, c }) {
  const faced = data.entries.flatMap((e) => e.matches.filter((m) => m.opponent_id === c.id).map((m) => ({ m, e })));
  return (
    <>
      <div className="profile-head">
        <h1>{fullName(c)}</h1>
        <p className="muted">{[c.school, c.state].filter(Boolean).join(', ') || 'Opponent'}. Opponent profile, not yet joined.</p>
      </div>
      <section className="tiers">
        {['sparring', 'combat'].map((d) => {
          const r = ratingOf(data, c.id, d);
          return r ? (
            <div key={d} className="tier-card">
              <Emblem track="competitive" tier={ratingTier(r.rating).id} size={56} />
              <div><h2>{DISCIPLINES[d]}</h2><p className="big">{Math.round(r.rating)} <span className="unit">estimated</span></p></div>
            </div>
          ) : null;
        })}
      </section>
      <section>
        <h2>Matches against our students</h2>
        <ul className="results">
          {faced.map(({ m, e }) => (
            <li key={m.id} className="result">
              <Score mine={m.opp_score} theirs={m.my_score} won={!m.won} />
              <span className="vs"> vs <a href={`#/c/${e.competitor_id}`}>{fullName(data.competitorById.get(e.competitor_id))}</a>
                <span className="muted"> · {e.tournament.name}, {fmtDate(e.tournament.event_date)}</span></span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
