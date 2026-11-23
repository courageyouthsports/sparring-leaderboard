# Sparring Leaderboard

Students and parents log ATA tournament sparring results. The app turns them into:

- **Skill rating** (separate for sparring and combat sparring): Elo weighted by point spread and tournament class.
- **Experience** that only goes up, earned by competing, winning, placing and earning badges.
- **ATA points**: what each student should have on their ATA profile this season, by the 2026–27 rules.
- **Tier emblems** (Bronze → Mythic) for both tracks, plus badges.
- **Home screen**: the student's name and both ranks up top, this week's in-class challenge, then their ATA division's leaderboard (any other division is one menu away).
- **Weekly challenges**: one per week (Monday–Sunday), rotating through the list on the Admin page. Logging it gives XP and that week's badge.
- **Achievements and titles**: big milestones (e.g. *Unbroken*: 10 wins in a row) unlock a title the family can show next to the name on leaderboards.
- **Share**: makes a brag picture and message for the phone's share menu.

Divisions follow ATA's 2026–27 black belt chart (gender, competition age, rank group). Color belt rings are formed on the day, so color belts are grouped White–Yellow, Camo–Purple and Blue–Red/Black (change in `src/config.js`).

**Updating the database:** after pulling new code, run `supabase/schema.sql` again in the SQL Editor. It's safe to re-run and keeps all data.

Built for Courage Martial Arts and set up so other schools can be added later: every record belongs to a school, and families join with that school's code. ATA numbers are visible only to the family and the school's admins.

## What's in here

| Path | What it is |
|---|---|
| `supabase/schema.sql` | Database tables, privacy rules, the rating engine and every action |
| `src/` | The web app (React + Vite) |
| `src/config.js` | Tier thresholds, XP values, point tables, season end date: change these to tune |
| `public/emblems/` | The 10 emblem images. Replace any file (same name) to change the art |
| `scripts/make-emblems.mjs` | Redraws the default emblems (`npm run emblems`) |

## One-time setup

### 1. Database (Supabase)
1. Supabase → the `sparring-leaderboard` project → **SQL Editor** → **New query**.
2. Paste all of `supabase/schema.sql` and click **Run**.

### 2. Sign-in emails (Supabase)
1. **Authentication → Emails → Magic Link** template: make sure it includes `{{ .Token }}` so people get a 6-digit code, e.g.
   `Your sign-in code is {{ .Token }}`
2. **Authentication → URL Configuration → Site URL**: set to the Cloudflare address (step 3).
3. Before families use it: **Authentication → Emails → SMTP Settings**, add a real email sender (same one as the afterschool app works).
   Supabase's built-in sender only delivers a few emails per hour.

### 3. Web app (Cloudflare Pages)
1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → `courageyouthsports/sparring-leaderboard`.
2. Framework preset **Vite** (build command `npm run build`, output folder `dist`).
3. **Environment variables**:
   - `VITE_SUPABASE_URL`: Supabase → Project Settings → API (Project URL)
   - `VITE_SUPABASE_ANON_KEY`: the **anon / publishable** key (safe in the browser; data is protected by the database rules).
     Never use the `service_role` / secret key here.
4. Deploy.

### 4. Make yourself the admin
1. Open the site and sign in with your email (it will ask for a school code; stop there).
2. In the Supabase SQL Editor, run (with your real email and name):
   ```sql
   select public.setup_org('Courage Martial Arts', 'you@example.com', 'Your Name');
   ```
   It returns the **school code**. Refresh the site: you're in, and the code is also on the **Admin** page.
3. Share the code with families.

## How the numbers work

**Skill rating.** Everyone starts at 1000. For each match:
expected result `E = 1 / (1 + 10^((opponent − me) / 400))`,
actual result `S = 0.5 × (1 if won) + 0.5 × (my points ÷ total points)`,
change `= 32 × class multiplier × (S − E)` (AAA 1.5, AA 1.3, A+ 1.15, A 1.0, B 0.75, C 0.5).
The opponent moves the same amount the other way. A 5–0 or 10–0 counts as a total shutout; a 5–4 or 10–9 loss barely moves anyone.
The whole history is replayed in date order whenever a result is added, edited or deleted. If two of our students both log the same match, it counts once.
Opponents from other schools get placeholder profiles with their own ratings; if they join later they can claim their profile and keep the history.

**ATA points.** Individual: AAA 20/15/10, AA 15/10/8, A+ 12/8/4, A 8/5/2, B 5/3/1, C 3/2/1 (reduced for rings under 5).
Team: AA 10/8/5; A+, A, B 5/3/1; none at AAA. Only Champion divisions count, and individual points need Leadership/Legacy registration.
Best results counted per event: Super-20, best 2 AA, best 2 A+, best 5 regionals (A and B), best 3 class C. Season ends April 24.
Not handled: half points for adult black belts registering on-site at Nationals/Worlds.

## Development
```
npm install
cp .env.example .env.local   # fill in the two values
npm run dev
npm test                     # point tables, seasons, badges, experience
```
