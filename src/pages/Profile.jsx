import { useState } from 'react';
import { DISCIPLINES, PROVISIONAL_MATCHES, TIER_NAMES, RATING_TIERS, TITLE_NAMES } from '../config.js';
import {
  approvedClassesOf, badgesFor, classLogsOf, completionsOf, entriesOf, fullName, nextTier, ratingHistory, ratingOf, ratingTier, recordOf, seasonLabel,
  seasonPoints, seasonYear, teamRecordOf, todayStr, weeklyDone,
} from '../lib/scoring.js';
import { achievementsFor } from '../lib/achievements.js';
import MeCard from '../components/MeCard.jsx';
import { rpc } from '../lib/supabase.js';
import { Delta, Emblem, ErrorNote, Score, Sparkline, fmtDate, ordinal } from '../components/ui.jsx';

const EVENT_NAMES = { sparring: 'Sparring', combat: 'Combat sparring', 'team-sparring': 'Team sparring', 'team-combat': 'Team combat' };

export default function Profile({ data, id, reload, isAdmin, isApprover, params }) {
  const c = data.competitorById.get(id);
  const [error, setError] = useState(null);
  if (!c) return <p>That competitor wasn’t found. <a href="#/">Back to rankings</a></p>;
  if (c.is_placeholder) return <OpponentProfile data={data} c={c} />;

  const canManage = data.myCompetitorIds.has(id) || isAdmin;
  const mine = data.myCompetitorIds.has(id);
  const completions = completionsOf(data, id);
  const weekly = weeklyDone(data, id);
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
      <MeCard data={data} c={c} link={false} />
      {canManage && (
        <p className="actions">
          <a className="button primary" href={`#/class?competitor=${id}`}>Log a class</a>
          <a className="button" href={`#/log?competitor=${id}`}>Log a tournament</a>
        </p>
      )}
      {params?.sent && !isApprover && <p className="note">Sent. It will count once an instructor approves it.</p>}

      {(canManage || isApprover) && <Waiting data={data} id={id} canManage={canManage} reload={reload} />}

      <section className="tiers">
        {['sparring', 'combat', 'class'].map((d) => <RatingCard key={d} data={data} id={id} discipline={d} />)}
      </section>

      <Achievements data={data} c={c} canManage={canManage} reload={reload} />

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
        {completions.length > 0 && <p className="small muted">Weekly challenges completed: {completions.length}</p>}
        <ul className="badges">
          {weekly && (
            <li className="earned weekly-badge">
              <b>{weekly.title}</b><span>This week’s challenge, completed. Lasts until Sunday.</span>
            </li>
          )}
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
      <ClassHistory data={data} id={id} canManage={canManage} reload={reload} />
    </>
  );
}

function RatingCard({ data, id, discipline }) {
  const r = ratingOf(data, id, discipline);
  if (!r) {
    return (
      <div className="tier-card faded">
        <Emblem track="competitive" tier="bronze" size={72} />
        <div><h2>{DISCIPLINES[discipline]}</h2><p className="muted">{discipline === 'class' ? 'No approved class matches yet.' : 'No matches yet.'} Everyone starts at 1000.</p></div>
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

function Achievements({ data, c, canManage, reload }) {
  const list = achievementsFor(data, c.id);
  const earned = list.filter((a) => a.done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function choose(title) {
    setBusy(true); setError(null);
    try { await rpc('set_title', { p_competitor: c.id, p_title: title || null }); await reload(); } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <section>
      <h2>Achievements <span className="muted">{earned.length} of {list.length}</span></h2>
      <p className="small muted">Each achievement unlocks a title that can show next to {c.first_name}’s name on the leaderboards.</p>
      {canManage && earned.length > 0 && (
        <label className="title-pick">
          <span className="field-label">Title shown on leaderboards</span>
          <select value={c.title && earned.some((a) => a.id === c.title) ? c.title : ''} disabled={busy} onChange={(e) => choose(e.target.value)}>
            <option value="">No title</option>
            {earned.map((a) => <option key={a.id} value={a.id}>{TITLE_NAMES[a.id]}</option>)}
          </select>
        </label>
      )}
      <ErrorNote error={error} />
      <ul className="achievements">
        {list.map((a) => (
          <li key={a.id} className={a.done ? 'done' : ''}>
            <div className="ach-top">
              <b>{a.title}</b>
              <span className="muted small">{a.done ? 'Unlocked' : a.goal > 1 ? `${a.value.toLocaleString()} / ${a.goal.toLocaleString()}` : 'Locked'}</span>
            </div>
            <span className="small">{a.desc}</span>
            {!a.done && a.goal > 1 && <span className="progress"><span style={{ width: `${a.pct}%` }} /></span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Submissions that haven't counted yet: waiting for an instructor, or sent back with a note.
function Waiting({ data, id, canManage, reload }) {
  const entries = data.unapproved.filter((e) => e.competitor_id === id);
  const classes = classLogsOf(data, id).filter((l) => l.status !== 'approved');
  const [error, setError] = useState(null);
  if (entries.length + classes.length === 0) return null;

  async function del(fn, msg) {
    if (!window.confirm(msg)) return;
    try { await fn(); await reload(); } catch (e) { setError(e.message); }
  }
  const tag = (st) => <span className={`status status-${st}`}>{st === 'pending' ? 'Waiting for approval' : 'Sent back'}</span>;

  return (
    <section>
      <h2>Not counted yet</h2>
      <ErrorNote error={error} />
      <ul className="results">
        {entries.map((e) => (
          <li key={e.id} className="result">
            <div className="result-head">
              <div><b>{e.tournament.name}</b> <span className="muted">{DISCIPLINES[e.discipline]}{e.team ? ' (team)' : ''}{e.placement ? `, ${ordinal(e.placement)}` : ''}</span></div>
              {tag(e.status)}
            </div>
            {e.review_note && <p className="small note">Instructor: {e.review_note}</p>}
            <p className="small muted">{e.matches.map((m) => `${m.my_score}–${m.opp_score}`).join(', ')}</p>
            {canManage && (
              <div className="row-actions">
                <a href={`#/log?entry=${e.id}`}>{e.status === 'rejected' ? 'Fix and resend' : 'Edit'}</a>
                <button className="link danger" onClick={() => del(() => rpc('delete_entry', { p_entry: e.id }), 'Delete this result?')}>Delete</button>
              </div>
            )}
          </li>
        ))}
        {classes.map((l) => (
          <li key={l.id} className="result">
            <div className="result-head">
              <div><b>Class</b> <span className="muted">{fmtDate(l.class_date)}{l.challenge_done ? ', weekly challenge' : ''}, {l.matches.length} match{l.matches.length === 1 ? '' : 'es'}</span></div>
              {tag(l.status)}
            </div>
            {l.review_note && <p className="small note">Instructor: {l.review_note}</p>}
            {canManage && (
              <div className="row-actions">
                <a href={`#/class?class=${l.id}`}>{l.status === 'rejected' ? 'Fix and resend' : 'Edit'}</a>
                <button className="link danger" onClick={() => del(() => rpc('delete_class_log', { p_id: l.id }), 'Delete this class?')}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClassHistory({ data, id, canManage, reload }) {
  const logs = approvedClassesOf(data, id);
  const [error, setError] = useState(null);
  if (logs.length === 0) return null;
  async function del(lid) {
    if (!window.confirm('Delete this class? Its XP and any challenge credit go with it.')) return;
    try { await rpc('delete_class_log', { p_id: lid }); await reload(); } catch (e) { setError(e.message); }
  }
  return (
    <section>
      <h2>Classes <span className="muted">{logs.length}</span></h2>
      <ErrorNote error={error} />
      <ul className="results">
        {logs.map((l) => (
          <li key={l.id} className="result">
            <div className="result-head">
              <div><b>{fmtDate(l.class_date)}</b>{l.challenge_done && <span className="weekly-chip inline-chip">Weekly challenge</span>}</div>
            </div>
            {l.matches.length === 0 ? <p className="small muted">Attended</p> : (
              <ul className="matches">
                {l.matches.map((m) => (
                  <li key={m.id}>
                    <Score mine={m.my_score} theirs={m.opp_score} won={m.won} />
                    <span className="vs">vs <a href={`#/c/${m.opponent_id}`}>{fullName(data.competitorById.get(m.opponent_id))}</a> <span className="muted">({m.discipline})</span></span>
                    <Delta before={m.rating_before} after={m.rating_after} />
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="row-actions">
                <a href={`#/class?class=${l.id}`}>Edit</a>
                <button className="link danger" onClick={() => del(l.id)}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
