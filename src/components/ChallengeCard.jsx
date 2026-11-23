import { weeklyDone } from '../lib/scoring.js';

const mondayOf = (d) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toLocaleDateString('en-CA');
};
const short = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// This week's challenge. Students complete it in a class match and log it with that class.
export default function ChallengeCard({ data, competitors, isAdmin }) {
  const ch = data.challenge;

  if (!ch) {
    return isAdmin ? (
      <section className="challenge empty-challenge">
        <p>No weekly challenges are set up yet. <a href="#/admin">Add them on the Admin page.</a></p>
      </section>
    ) : null;
  }

  const start = String(ch.week_start).slice(0, 10);
  const end = new Date(`${start}T12:00:00`);
  end.setDate(end.getDate() + 6);

  return (
    <section className="challenge">
      <div className="challenge-top">
        <span className="challenge-kind">This week’s challenge, {short(start)}–{short(end.toLocaleDateString('en-CA'))}</span>
        <span className="challenge-xp">+{ch.xp} XP</span>
      </div>
      <h2>{ch.title}</h2>
      <p>{ch.description}</p>
      {competitors.length > 0 && (
        <div className="challenge-actions">
          {competitors.map((c) => {
            const done = weeklyDone(data, c.id);
            const pending = data.classLogs.find((l) => l.competitor_id === c.id && l.challenge_done && l.status === 'pending'
              && mondayOf(l.class_date) === start);
            if (done) return <span key={c.id} className="challenge-done">{c.first_name} completed it</span>;
            if (pending) return <span key={c.id} className="challenge-pending">{c.first_name}: waiting for approval</span>;
            return (
              <a key={c.id} className="button primary" href={`#/class?competitor=${c.id}`}>
                {competitors.length > 1 ? `Log ${c.first_name}’s class` : 'Log a class'}
              </a>
            );
          })}
        </div>
      )}
      <p className="small muted">Do it during a sparring or combat match in class, then log the class and tick the challenge. It counts once your instructor approves.</p>
    </section>
  );
}
