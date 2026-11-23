import { DISCIPLINES, PROVISIONAL_MATCHES, RATING_TIERS, TIER_NAMES, XP_TIERS } from '../config.js';
import { fullName, nextTier, ratingOf, ratingTier, seasonYear, todayStr, weeklyDone, xpFor, xpTier } from '../lib/scoring.js';
import { displayTitle } from '../lib/achievements.js';
import { divisionOf } from '../lib/divisions.js';
import { Emblem } from './ui.jsx';
import ShareButton from './ShareButton.jsx';

// The student's name and both ranks, big, at the top of their home screen and profile.
export default function MeCard({ data, c, link = true }) {
  const canShare = data.myCompetitorIds.has(c.id);
  const xp = xpFor(data, c.id);
  const xt = xpTier(xp);
  const xn = nextTier(xp, XP_TIERS);
  const ratings = ['sparring', 'combat'].map((d) => ({ d, r: ratingOf(data, c.id, d) })).filter((x) => x.r);
  const best = ratings.slice().sort((a, b) => b.r.rating - a.r.rating)[0];
  const rating = best ? Number(best.r.rating) : 1000;
  const rt = ratingTier(rating);
  const rn = nextTier(rating, RATING_TIERS);
  const title = displayTitle(data, c);
  const classRating = ratingOf(data, c.id, 'class');
  const division = divisionOf(c, seasonYear(todayStr()));
  const weekly = weeklyDone(data, c.id);

  return (
    <section className="me">
      <div className="me-name">
        <h1>{link ? <a href={`#/c/${c.id}`}>{fullName(c)}</a> : fullName(c)}</h1>
        <p>
          {title && <span className="title-chip">{title}</span>}
          {weekly && <span className="weekly-chip">Weekly challenge done</span>}
          <span className="me-division">{division ? division.label : [c.belt, c.school].filter(Boolean).join(', ')}</span>
        </p>
        {canShare && <ShareButton data={data} c={c} />}
      </div>
      <div className="me-ranks">
        <div className="rank">
          <Emblem track="experience" tier={xt.id} size={84} />
          <div>
            <span className="rank-kind">Experience</span>
            <b className="rank-tier">{TIER_NAMES[xt.id]}</b>
            <span className="rank-num">{xp.toLocaleString()} XP</span>
            {xn && (
              <span className="rank-next">
                <span className="progress"><span style={{ width: `${((xp - xt.min) / (xn.min - xt.min)) * 100}%` }} /></span>
                {(xn.min - xp).toLocaleString()} to {TIER_NAMES[xn.id]}
              </span>
            )}
          </div>
        </div>
        <div className="rank">
          <Emblem track="competitive" tier={rt.id} size={84} />
          <div>
            <span className="rank-kind">Skill rating</span>
            <b className="rank-tier">{TIER_NAMES[rt.id]}</b>
            <span className="rank-num">
              {best ? `${Math.round(rating)} ${DISCIPLINES[best.d].toLowerCase()}` : 'No matches yet'}
              {best && best.r.matches < PROVISIONAL_MATCHES ? ' (provisional)' : ''}
            </span>
            {(ratings.length > 1 || classRating) && (
              <span className="rank-next">{[...ratings, ...(classRating ? [{ d: 'class', r: classRating }] : [])]
                .map((x) => `${DISCIPLINES[x.d]} ${Math.round(x.r.rating)}`).join(', ')}</span>
            )}
            {ratings.length <= 1 && !classRating && rn && best && <span className="rank-next">{Math.ceil(rn.min - rating)} to {TIER_NAMES[rn.id]}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
