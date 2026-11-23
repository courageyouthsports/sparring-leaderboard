import { EMBLEM_EXT, TIER_NAMES } from '../config.js';

export function Emblem({ track, tier, size = 48 }) {
  return (
    <img className="emblem" src={`/emblems/${track}/${tier}.${EMBLEM_EXT}`} width={size} height={size}
      alt={`${TIER_NAMES[tier]} ${track === 'experience' ? 'experience' : 'competitive'} tier`} />
  );
}

// A match score shown like scoreboard paddles: red = this competitor, white = opponent.
export function Score({ mine, theirs, won }) {
  return (
    <span className={`score ${won ? 'score-won' : 'score-lost'}`} aria-label={`${won ? 'Won' : 'Lost'} ${mine} to ${theirs}`}>
      <span className="score-red">{mine}</span>
      <span className="score-white">{theirs}</span>
    </span>
  );
}

export function Delta({ before, after }) {
  if (before == null || after == null) return null;
  const d = Number(after) - Number(before);
  const s = (Math.abs(d) < 0.05 ? '±0' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1));
  return <span className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{s}</span>;
}

export function Sparkline({ points, width = 280, height = 56 }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.rating);
  const lo = Math.min(...vals, 1000), hi = Math.max(...vals, 1000);
  const span = hi - lo || 1;
  const x = (i) => 4 + (i / (points.length - 1)) * (width - 8);
  const y = (v) => height - 4 - ((v - lo) / span) * (height - 8);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rating).toFixed(1)}`).join('');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Rating went from ${vals[0]} to ${vals.at(-1)}`}>
      <line x1="0" x2={width} y1={y(1000)} y2={y(1000)} className="spark-base" />
      <path d={d} className="spark-line" />
      <circle cx={x(points.length - 1)} cy={y(vals.at(-1))} r="3.5" className="spark-dot" />
    </svg>
  );
}

export function ErrorNote({ error }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v}
          className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export const ordinal = (p) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[p] || '');
export const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
