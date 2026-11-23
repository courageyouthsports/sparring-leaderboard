// Draws the 10 tier emblems into public/emblems/<track>/<tier>.svg.
// The app only ever loads those files by path, so new art can replace them at any time:
// drop in a new file with the same name (SVG, or change the extension in src/config.js to use PNGs).
import fs from 'fs';

const TIERS = [
  { id: 'bronze',   n: 1, c: '#B4713D', light: '#E9C3A2' },
  { id: 'silver',   n: 2, c: '#7D8BA1', light: '#D5DCE6' },
  { id: 'gold',     n: 3, c: '#C99A0E', light: '#F6E3A1' },
  { id: 'platinum', n: 4, c: '#2E9C95', light: '#B9E6E2' },
  { id: 'mythic',   n: 5, c: '#7B4FD6', light: '#D9CBF6' },
];

const gem = (r, n, t) => {
  const d = `M60 ${60 - r}L${60 + r} 60L60 ${60 + r}L${60 - r} 60Z`;
  const facets = n >= 4
    ? `<path d="M${60 - r} 60H${60 + r}M60 ${60 - r}L${60 - r / 2} 60L60 ${60 + r}L${60 + r / 2} 60Z" fill="none" stroke="${t.c}" stroke-width="1.4"/>`
    : '';
  return `<path d="${d}" fill="${t.light}" stroke="${t.c}" stroke-width="2.2"/>${facets}`;
};

const rays = (t, r) => [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
  const k = Math.PI / 180;
  const x1 = 60 + r * Math.cos(a * k), y1 = 60 + r * Math.sin(a * k);
  const x2 = 60 + (r + 9) * Math.cos(a * k), y2 = 60 + (r + 9) * Math.sin(a * k);
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${t.c}" stroke-width="3" stroke-linecap="round"/>`;
}).join('');

const wings = (t, d) => `<g fill="${t.light}" stroke="${t.c}" stroke-width="1.8" stroke-linejoin="round">
  <path d="M${60 - d} 54L${60 - d - 16} 44L${60 - d - 11} 57L${60 - d - 20} 61L${60 - d - 2} 68Z"/>
  <path d="M${60 + d} 54L${60 + d + 16} 44L${60 + d + 11} 57L${60 + d + 20} 61L${60 + d + 2} 68Z"/></g>`;

const shield = s => `M${60 - 30 * s} ${60 - 34 * s}H${60 + 30 * s}V${60 + 2 * s}Q${60 + 30 * s} ${60 + 26 * s} 60 ${60 + 37 * s}Q${60 - 30 * s} ${60 + 26 * s} ${60 - 30 * s} ${60 + 2 * s}Z`;
const diamond = s => `M60 ${60 - 40 * s}L${60 + 36 * s} 60L60 ${60 + 40 * s}L${60 - 36 * s} 60Z`;

const draw = (frame, t, wingGap) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${t.id}">
${t.n === 5 ? rays(t, 47) : ''}${t.n >= 3 ? wings(t, wingGap) : ''}
<path d="${frame(1)}" fill="${t.light}" fill-opacity="0.55" stroke="${t.c}" stroke-width="3" stroke-linejoin="round"/>
${t.n >= 2 ? `<path d="${frame(0.78)}" fill="none" stroke="${t.c}" stroke-width="1.6" stroke-linejoin="round"/>` : ''}
${gem(t.n >= 4 ? 13 : 10, t.n, t)}
</svg>
`;

for (const [track, frame, gap] of [['experience', shield, 30], ['competitive', diamond, 34]]) {
  fs.mkdirSync(`public/emblems/${track}`, { recursive: true });
  for (const t of TIERS) fs.writeFileSync(`public/emblems/${track}/${t.id}.svg`, draw(frame, t, gap));
}
console.log('Emblems written to public/emblems/');
