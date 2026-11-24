import { useState } from 'react';
import { DISCIPLINES, EMBLEM_EXT, TIER_NAMES } from '../config.js';
import { entriesOf, fullName, ratingOf, skillTier, recordOf, xpFor, xpTier } from '../lib/scoring.js';
import { displayTitle } from '../lib/achievements.js';
import { ordinal } from './ui.jsx';

// Builds a brag card (image + message) and opens the phone's share menu,
// or downloads the picture and copies the message on a computer.

function facts(data, c) {
  const xp = xpFor(data, c.id);
  const ratings = ['sparring', 'combat'].map((d) => ({ d, r: ratingOf(data, c.id, d) })).filter((x) => x.r);
  const best = ratings.sort((a, b) => b.r.rating - a.r.rating)[0];
  const rec = best ? recordOf(data, c.id, best.d) : null;
  const last = entriesOf(data, c.id)[0];
  return {
    name: fullName(c),
    first: c.first_name,
    title: displayTitle(data, c),
    xp, xpTier: xpTier(xp).id,
    rating: best ? Math.round(best.r.rating) : null,
    ratingTier: skillTier(best?.r).id,
    discipline: best ? DISCIPLINES[best.d].toLowerCase() : null,
    record: rec ? `${rec.wins}–${rec.losses}` : null,
    last: last ? { place: last.placement, name: last.tournament.name, discipline: DISCIPLINES[last.discipline].toLowerCase(), team: last.team } : null,
    school: data.org.name,
  };
}

export function shareText(f) {
  const parts = [];
  if (f.last?.place) parts.push(`${f.first} took ${ordinal(f.last.place)} in ${f.last.team ? 'team ' : ''}${f.last.discipline} at ${f.last.name}!`);
  parts.push(`${f.title ? `"${f.title}" ` : ''}${f.name} is ${TIER_NAMES[f.ratingTier]}${f.ratingTier === 'untested' ? '' : ' rank'}${f.rating ? ` with a ${f.rating} ${f.discipline} rating (${f.record})` : ''} and ${TIER_NAMES[f.xpTier]} in experience.`);
  parts.push(`Training at ${f.school}.`);
  return parts.join(' ');
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

async function drawCard(f) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  try { await document.fonts.ready; } catch { /* fonts optional */ }
  const display = (size, weight = 700) => `${weight} ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  const body = (size, weight = 500) => `${weight} ${size}px Barlow, system-ui, sans-serif`;

  g.fillStyle = '#14213D'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#C8223A'; g.fillRect(0, 0, 28, H);                       // red corner stripe
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(W - 28, 0, 28, H);   // white corner stripe

  g.fillStyle = '#C9D3E3'; g.font = body(36);
  g.fillText(f.school, 90, 130);
  let y = 250;
  g.fillStyle = '#FFFFFF'; g.font = display(f.name.length > 16 ? 104 : 128);
  g.fillText(f.name, 86, y);
  if (f.title) {
    y += 80;
    g.font = display(52, 600);
    const tw = g.measureText(f.title).width;
    g.fillStyle = '#C8223A'; g.beginPath(); g.roundRect(86, y - 52, tw + 48, 72, 36); g.fill();
    g.fillStyle = '#FFFFFF'; g.fillText(f.title, 110, y);
  }

  const [ex, sk] = await Promise.all([
    loadImg(`/emblems/experience/${f.xpTier}.${EMBLEM_EXT}`),
    loadImg(`/emblems/competitive/${f.ratingTier}.${EMBLEM_EXT}`),
  ]);
  const top = 470;
  for (const [i, img, kind, tier, num] of [
    [0, ex, 'Experience', f.xpTier, `${f.xp.toLocaleString()} XP`],
    [1, sk, 'Skill rating', f.ratingTier, f.rating ? `${f.rating} ${f.discipline}` : 'Starting out'],
  ]) {
    const x = 86 + i * 470;
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.beginPath(); g.roundRect(x, top, 440, 520, 28); g.fill();
    g.drawImage(img, x + 100, top + 40, 240, 240);
    g.textAlign = 'center';
    g.fillStyle = '#C9D3E3'; g.font = body(34); g.fillText(kind, x + 220, top + 330);
    g.fillStyle = '#FFFFFF'; g.font = display(84); g.fillText(TIER_NAMES[tier], x + 220, top + 415);
    g.fillStyle = '#FF8A99'; g.font = display(44, 600); g.fillText(num, x + 220, top + 475);
    g.textAlign = 'left';
  }

  if (f.last?.place) {
    g.fillStyle = '#FFFFFF'; g.font = display(64);
    g.fillText(`${ordinal(f.last.place)} place, ${f.last.team ? 'team ' : ''}${f.last.discipline}`, 86, 1110);
    g.fillStyle = '#C9D3E3'; g.font = body(38);
    g.fillText(f.last.name, 86, 1165);
  } else if (f.record) {
    g.fillStyle = '#FFFFFF'; g.font = display(64);
    g.fillText(`${f.record} record`, 86, 1110);
  }
  g.fillStyle = '#5C6B80'; g.font = body(30);
  g.fillText('Sparring Leaderboard', 86, 1280);

  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export default function ShareButton({ data, c }) {
  const [state, setState] = useState(null);

  async function share() {
    setState('working');
    try {
      const f = facts(data, c);
      const text = shareText(f);
      const blob = await drawCard(f);
      const file = new File([blob], `${c.first_name}-${c.last_name}-rank.png`.toLowerCase(), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        setState(null);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      try { await navigator.clipboard.writeText(text); setState('copied'); } catch { setState(null); }
    } catch (e) {
      setState(e?.name === 'AbortError' ? null : 'failed');
    }
  }

  return (
    <span className="share">
      <button type="button" onClick={share} disabled={state === 'working'}>{state === 'working' ? 'Making the card…' : 'Share'}</button>
      {state === 'copied' && <span className="small muted">Picture downloaded and message copied. Paste it with the picture.</span>}
      {state === 'failed' && <span className="small error">Couldn’t make the card on this device.</span>}
    </span>
  );
}
