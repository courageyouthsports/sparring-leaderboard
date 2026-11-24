-- Sparring Leaderboard database
-- Run this whole file once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: it drops and recreates the functions, and only creates tables that don't exist yet.
--
-- Everything belongs to a school ("org"), so other schools can be added later.
-- People never write to tables directly: every change goes through the functions at the bottom,
-- which check who is asking. Reads are limited by the row security rules.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,
  created_at  timestamptz not null default now()
);

-- People who can sign in. A parent or student account; admins manage the school.
create table if not exists public.members (
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'member' check (role in ('admin', 'member')),
  display_name  text not null default '',
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Competitors: our students, plus placeholder profiles for opponents from other schools.
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('admin', 'instructor', 'member'));

create table if not exists public.competitors (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  first_name      text not null,
  last_name       text not null,
  school          text not null default '',
  state           text not null default '',
  gender          text check (gender in ('M', 'F')),
  birth_year      int check (birth_year between 1900 and 2100),
  belt            text,
  leadership      boolean not null default false,  -- registered in ATA Leadership / Legacy (needed for ranking points)
  is_placeholder  boolean not null default false,  -- an opponent who hasn't joined
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists competitors_org_idx on public.competitors(org_id);

-- Starting ratings from ATA state standings (see import_standings below). Only a head start: normal Elo after that.
alter table public.competitors add column if not exists seed_sparring numeric;
alter table public.competitors add column if not exists seed_combat numeric;
alter table public.competitors add column if not exists city text not null default '';
alter table public.competitors add column if not exists ranking_note text not null default '';

-- ATA numbers live in their own table so only the family and admins can ever read them.
create table if not exists public.competitor_private (
  competitor_id  uuid primary key references public.competitors(id) on delete cascade,
  ata_number     text not null unique
);

-- Which accounts can log results for which competitor (a parent and/or the student).
create table if not exists public.competitor_managers (
  competitor_id  uuid not null references public.competitors(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  primary key (competitor_id, user_id)
);

create table if not exists public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  event_date  date not null,
  tier        text not null check (tier in ('AAA', 'AA', 'A+', 'A', 'B', 'C')),
  location    text not null default '',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists tournaments_unique_idx on public.tournaments(org_id, lower(name), event_date);

-- One competitor's results in one event at one tournament.
create table if not exists public.entries (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.competitors(id) on delete cascade,
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  discipline     text not null check (discipline in ('sparring', 'combat')),
  team           boolean not null default false,       -- team sparring / team combat
  team_name      text not null default '',
  champion       boolean not null default true,        -- Champion division (false = Recreational)
  division       text not null default '',
  placement      int check (placement between 1 and 3),  -- null = did not place
  ring_size      int check (ring_size between 1 and 64),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (competitor_id, tournament_id, discipline, team)
);

-- Each match (or, for teams, the student's own bout in a team match).
-- Approval workflow (added after the first release; safe to re-run).
alter table public.entries add column if not exists status text not null default 'approved';
alter table public.entries drop constraint if exists entries_status_check;
alter table public.entries add constraint entries_status_check check (status in ('pending', 'approved', 'rejected'));
alter table public.entries add column if not exists submission_id uuid;      -- entries logged together as one tournament day
alter table public.entries add column if not exists review_note text not null default '';
alter table public.entries add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.entries add column if not exists reviewed_at timestamptz;
create index if not exists entries_status_idx on public.entries(status);

create table if not exists public.matches (
  id                 uuid primary key default gen_random_uuid(),
  entry_id           uuid not null references public.entries(id) on delete cascade,
  round_no           int not null default 1,
  opponent_id        uuid not null references public.competitors(id) on delete cascade,
  my_score           int not null check (my_score between 0 and 99),
  opp_score          int not null check (opp_score between 0 and 99),
  won                boolean not null,
  team_score         int check (team_score between 0 and 999),
  opp_team_score     int check (opp_team_score between 0 and 999),
  team_won           boolean,
  -- filled in by recompute_ratings():
  rating_before      numeric,
  rating_after       numeric,
  opp_rating_before  numeric,
  opp_rating_after   numeric
);
create index if not exists matches_entry_idx on public.matches(entry_id);
create index if not exists matches_opponent_idx on public.matches(opponent_id);

-- In-class sparring: a student logs a class they attended, with any matches and the weekly challenge.
create table if not exists public.class_logs (
  id              uuid primary key default gen_random_uuid(),
  competitor_id   uuid not null references public.competitors(id) on delete cascade,
  class_date      date not null,
  challenge_done  boolean not null default false,
  note            text not null default '',
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note     text not null default '',
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (competitor_id, class_date)
);
create table if not exists public.class_matches (
  id                 uuid primary key default gen_random_uuid(),
  class_log_id       uuid not null references public.class_logs(id) on delete cascade,
  round_no           int not null default 1,
  discipline         text not null default 'sparring' check (discipline in ('sparring', 'combat')),
  opponent_id        uuid not null references public.competitors(id) on delete cascade,
  my_score           int not null check (my_score between 0 and 99),
  opp_score          int not null check (opp_score between 0 and 99),
  won                boolean not null,
  rating_before      numeric,
  rating_after       numeric,
  opp_rating_before  numeric,
  opp_rating_after   numeric
);
create index if not exists class_matches_log_idx on public.class_matches(class_log_id);

-- Current skill rating per competitor per discipline (rebuilt from all matches).
create table if not exists public.ratings (
  competitor_id  uuid not null references public.competitors(id) on delete cascade,
  discipline     text not null,
  rating         numeric not null,
  peak           numeric not null,
  matches        int not null,
  wins           int not null,
  primary key (competitor_id, discipline)
);

alter table public.ratings drop constraint if exists ratings_discipline_check;
alter table public.ratings add constraint ratings_discipline_check check (discipline in ('sparring', 'combat', 'class'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Instructors and admins approve results.
create or replace function public.is_approver(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = p_org and user_id = auth.uid() and role in ('admin', 'instructor'));
$$;

create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = p_org and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_manage(p_competitor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from competitor_managers where competitor_id = p_competitor and user_id = auth.uid())
      or exists (select 1 from competitors c where c.id = p_competitor and is_admin(c.org_id));
$$;

-- ---------------------------------------------------------------------------
-- Row security: who can read what. All writes go through the functions below.
-- ---------------------------------------------------------------------------

alter table public.orgs                enable row level security;
alter table public.members             enable row level security;
alter table public.competitors         enable row level security;
alter table public.competitor_private  enable row level security;
alter table public.competitor_managers enable row level security;
alter table public.tournaments         enable row level security;
alter table public.entries             enable row level security;
alter table public.matches             enable row level security;
alter table public.ratings             enable row level security;

drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select using (is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (is_member(org_id));

drop policy if exists competitors_read on public.competitors;
create policy competitors_read on public.competitors for select using (is_member(org_id));

drop policy if exists private_read on public.competitor_private;
create policy private_read on public.competitor_private for select using (can_manage(competitor_id));

drop policy if exists managers_read on public.competitor_managers;
create policy managers_read on public.competitor_managers for select
  using (user_id = auth.uid() or exists (select 1 from competitors c where c.id = competitor_id and is_admin(c.org_id)));

drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select using (is_member(org_id));

drop policy if exists entries_read on public.entries;
create policy entries_read on public.entries for select
  using (exists (select 1 from competitors c where c.id = competitor_id and is_member(c.org_id)));

drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select
  using (exists (select 1 from entries e join competitors c on c.id = e.competitor_id
                 where e.id = entry_id and is_member(c.org_id)));

alter table public.class_logs    enable row level security;
alter table public.class_matches enable row level security;

drop policy if exists class_logs_read on public.class_logs;
create policy class_logs_read on public.class_logs for select
  using (exists (select 1 from competitors c where c.id = competitor_id and is_member(c.org_id)));

drop policy if exists class_matches_read on public.class_matches;
create policy class_matches_read on public.class_matches for select
  using (exists (select 1 from class_logs l join competitors c on c.id = l.competitor_id
                 where l.id = class_log_id and is_member(c.org_id)));

drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings for select
  using (exists (select 1 from competitors c where c.id = competitor_id and is_member(c.org_id)));

-- ---------------------------------------------------------------------------
-- Rating engine
--   Everyone starts at 1000, separately for sparring, combat sparring and class matches.
--   Expected  E = 1 / (1 + 10^((opponent - me) / 400))
--   Result    S = 0.5 x (1 if won) + 0.5 x (my points / total points)
--   Change    = 32 x tier multiplier x (S - E); the opponent moves by the same amount the other way.
--   Tier multipliers: AAA 1.5, AA 1.3, A+ 1.15, A 1.0, B 0.75, C 0.5, class matches 0.5
-- The whole history is replayed in date order every time a result changes, so edits and
-- deletes are always reflected correctly. If both students in a match logged it, it counts once.
-- ---------------------------------------------------------------------------

-- Where a competitor's rating starts: their state-standings head start, or 1000. Class ratings always start at 1000.
create or replace function public.start_rating(p_id uuid, p_disc text) returns numeric
language sql stable set search_path = public as $$
  select coalesce((select case p_disc when 'sparring' then seed_sparring when 'combat' then seed_combat end
                   from competitors where id = p_id), 1000);
$$;

-- One Elo step on the working table _r. Returns {my rating before, their rating before, change}.
create or replace function public.elo_step(p_me uuid, p_opp uuid, p_disc text, p_my int, p_their int,
                                           p_won boolean, p_mult numeric) returns numeric[]
language plpgsql set search_path = public as $$
declare ra numeric; rb numeric; e numeric; s numeric; d numeric; tot int := p_my + p_their;
begin
  insert into _r values (p_me, p_disc, start_rating(p_me, p_disc), 0, 0, start_rating(p_me, p_disc)) on conflict do nothing;
  insert into _r values (p_opp, p_disc, start_rating(p_opp, p_disc), 0, 0, start_rating(p_opp, p_disc)) on conflict do nothing;
  select rating into ra from _r where cid = p_me and disc = p_disc;
  select rating into rb from _r where cid = p_opp and disc = p_disc;
  s := 0.5 * (case when p_won then 1 else 0 end) + 0.5 * (case when tot > 0 then p_my::numeric / tot else 0.5 end);
  e := 1 / (1 + power(10::numeric, (rb - ra) / 400));
  d := 32 * p_mult * (s - e);
  update _r set rating = rating + d, n = n + 1, w = w + (case when p_won then 1 else 0 end), peak = greatest(peak, rating + d)
    where cid = p_me and disc = p_disc;
  update _r set rating = rating - d, n = n + 1, w = w + (case when p_won then 0 else 1 end), peak = greatest(peak, rating - d)
    where cid = p_opp and disc = p_disc;
  return array[ra, rb, d];
end;
$$;

-- Only approved results count. Class matches build a separate "class" rating (multiplier 0.5).
create or replace function public.recompute_ratings(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m record; r numeric[]; mult numeric;
begin
  create temp table if not exists _r (
    cid uuid, disc text, rating numeric, n int, w int, peak numeric,
    primary key (cid, disc)
  ) on commit drop;
  truncate _r;

  update matches x set rating_before = null, rating_after = null, opp_rating_before = null, opp_rating_after = null
  from entries en join tournaments t on t.id = en.tournament_id
  where en.id = x.entry_id and t.org_id = p_org;

  -- tournament matches
  for m in
    select x.id, x.opponent_id, x.my_score, x.opp_score, x.won,
           en.competitor_id as cid, en.discipline as disc, t.tier
    from matches x
    join entries en on en.id = x.entry_id
    join tournaments t on t.id = en.tournament_id
    where t.org_id = p_org and en.status = 'approved'
      and not exists (   -- skip the second copy of a match both students logged
        select 1 from matches y join entries e2 on e2.id = y.entry_id
        where e2.status = 'approved' and e2.tournament_id = en.tournament_id and e2.discipline = en.discipline
          and e2.competitor_id = x.opponent_id and y.opponent_id = en.competitor_id
          and y.my_score = x.opp_score and y.opp_score = x.my_score and y.won <> x.won
          and y.id < x.id)
    order by t.event_date, en.created_at, en.id, x.round_no, x.id
  loop
    mult := case m.tier when 'AAA' then 1.5 when 'AA' then 1.3 when 'A+' then 1.15
                        when 'A' then 1.0 when 'B' then 0.75 else 0.5 end;
    r := elo_step(m.cid, m.opponent_id, m.disc, m.my_score, m.opp_score, m.won, mult);
    update matches set rating_before = round(r[1], 1), rating_after = round(r[1] + r[3], 1),
                       opp_rating_before = round(r[2], 1), opp_rating_after = round(r[2] - r[3], 1)
      where id = m.id;
  end loop;

  update matches y set rating_before = x.opp_rating_before, rating_after = x.opp_rating_after,
                       opp_rating_before = x.rating_before, opp_rating_after = x.rating_after
  from matches x, entries ex, entries ey, tournaments t
  where ex.id = x.entry_id and ey.id = y.entry_id and t.id = ey.tournament_id and t.org_id = p_org
    and ex.status = 'approved' and ey.status = 'approved'
    and y.rating_before is null and x.rating_before is not null
    and ex.tournament_id = ey.tournament_id and ex.discipline = ey.discipline
    and ey.competitor_id = x.opponent_id and y.opponent_id = ex.competitor_id
    and y.my_score = x.opp_score and y.opp_score = x.my_score;

  -- class matches (one combined class rating)
  update class_matches x set rating_before = null, rating_after = null, opp_rating_before = null, opp_rating_after = null
  from class_logs cl join competitors c on c.id = cl.competitor_id
  where cl.id = x.class_log_id and c.org_id = p_org;

  for m in
    select x.id, x.opponent_id, x.my_score, x.opp_score, x.won, cl.competitor_id as cid
    from class_matches x
    join class_logs cl on cl.id = x.class_log_id
    join competitors c on c.id = cl.competitor_id
    where c.org_id = p_org and cl.status = 'approved'
      and not exists (
        select 1 from class_matches y join class_logs c2 on c2.id = y.class_log_id
        where c2.status = 'approved' and c2.class_date = cl.class_date
          and c2.competitor_id = x.opponent_id and y.opponent_id = cl.competitor_id
          and y.my_score = x.opp_score and y.opp_score = x.my_score and y.won <> x.won
          and y.id < x.id)
    order by cl.class_date, cl.created_at, cl.id, x.round_no, x.id
  loop
    r := elo_step(m.cid, m.opponent_id, 'class', m.my_score, m.opp_score, m.won, 0.5);
    update class_matches set rating_before = round(r[1], 1), rating_after = round(r[1] + r[3], 1),
                             opp_rating_before = round(r[2], 1), opp_rating_after = round(r[2] - r[3], 1)
      where id = m.id;
  end loop;

  update class_matches y set rating_before = x.opp_rating_before, rating_after = x.opp_rating_after,
                             opp_rating_before = x.rating_before, opp_rating_after = x.rating_after
  from class_matches x, class_logs cx, class_logs cy, competitors c
  where cx.id = x.class_log_id and cy.id = y.class_log_id and c.id = cy.competitor_id and c.org_id = p_org
    and cx.status = 'approved' and cy.status = 'approved'
    and y.rating_before is null and x.rating_before is not null
    and cx.class_date = cy.class_date
    and cy.competitor_id = x.opponent_id and y.opponent_id = cx.competitor_id
    and y.my_score = x.opp_score and y.opp_score = x.my_score;

  delete from ratings where competitor_id in (select id from competitors where org_id = p_org);
  insert into ratings (competitor_id, discipline, rating, peak, matches, wins)
    select cid, disc, round(rating, 1), round(peak, 1), n, w from _r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup and membership
-- ---------------------------------------------------------------------------

-- Run once in the SQL editor after signing in to the app once with your email:
--   select public.setup_org('Courage Martial Arts', 'you@example.com', 'Your Name');
-- It returns the school's join code.
create or replace function public.setup_org(p_name text, p_email text, p_display_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_org uuid; v_code text;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account for %. Sign in to the app once with that email first, then run this again.', p_email;
  end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into orgs (name, join_code) values (trim(p_name), v_code) returning id into v_org;
  insert into members (org_id, user_id, role, display_name) values (v_org, v_user, 'admin', trim(p_display_name));
  return v_code;
end;
$$;

create or replace function public.join_org(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if length(trim(coalesce(p_display_name, ''))) = 0 then raise exception 'Please enter your name.'; end if;
  select id into v_org from orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'That school code was not found. Check it with your instructor.'; end if;
  insert into members (org_id, user_id, display_name) values (v_org, auth.uid(), trim(p_display_name))
    on conflict (org_id, user_id) do update set display_name = excluded.display_name;
  return v_org;
end;
$$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_org) then raise exception 'Only an admin can do that.'; end if;
  if p_role not in ('admin', 'instructor', 'member') then raise exception 'Unknown role.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access.'; end if;
  update members set role = p_role where org_id = p_org and user_id = p_user;
end;
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_org) then raise exception 'Only an admin can do that.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from competitor_managers cm using competitors c
    where c.id = cm.competitor_id and c.org_id = p_org and cm.user_id = p_user;
  delete from members where org_id = p_org and user_id = p_user;
end;
$$;

-- Lets an admin give another family account access to a competitor (e.g. the second parent).
create or replace function public.add_manager(p_competitor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from competitors where id = p_competitor;
  if not is_admin(v_org) then raise exception 'Only an admin can do that.'; end if;
  if not exists (select 1 from members where org_id = v_org and user_id = p_user) then
    raise exception 'That account is not part of this school.';
  end if;
  insert into competitor_managers values (p_competitor, p_user) on conflict do nothing;
end;
$$;

create or replace function public.remove_manager(p_competitor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from competitors where id = p_competitor;
  if not is_admin(v_org) then raise exception 'Only an admin can do that.'; end if;
  delete from competitor_managers where competitor_id = p_competitor and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Competitors
-- ---------------------------------------------------------------------------

-- p: {org_id, first_name, last_name, school, state, gender, birth_year, belt, leadership,
--     ata_number, claim_placeholder_id?}
-- claim_placeholder_id turns an existing opponent placeholder into this student, keeping their past matches.
create or replace function public.create_competitor(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := (p->>'org_id')::uuid;
  v_id uuid;
  v_ata text := upper(regexp_replace(coalesce(p->>'ata_number', ''), '\s', '', 'g'));
  v_claim uuid := nullif(p->>'claim_placeholder_id', '')::uuid;
begin
  if not is_member(v_org) then raise exception 'You are not part of this school.'; end if;
  if length(trim(coalesce(p->>'first_name', ''))) = 0 or length(trim(coalesce(p->>'last_name', ''))) = 0 then
    raise exception 'First and last name are required.';
  end if;
  if length(v_ata) = 0 then raise exception 'ATA number is required.'; end if;
  if exists (select 1 from competitor_private where ata_number = v_ata) then
    raise exception 'That ATA number is already registered. Ask your instructor to link your account to it.';
  end if;

  if v_claim is not null then
    if not exists (select 1 from competitors where id = v_claim and org_id = v_org and is_placeholder) then
      raise exception 'That opponent profile can no longer be claimed.';
    end if;
    v_id := v_claim;
    update competitors set is_placeholder = false, created_by = auth.uid() where id = v_id;
  else
    insert into competitors (org_id, first_name, last_name, created_by)
      values (v_org, trim(p->>'first_name'), trim(p->>'last_name'), auth.uid())
      returning id into v_id;
  end if;

  update competitors set
    first_name = trim(p->>'first_name'),
    last_name  = trim(p->>'last_name'),
    school     = coalesce(trim(p->>'school'), ''),
    state      = upper(coalesce(trim(p->>'state'), '')),
    gender     = nullif(p->>'gender', ''),
    birth_year = nullif(p->>'birth_year', '')::int,
    belt       = nullif(p->>'belt', ''),
    leadership = coalesce((p->>'leadership')::boolean, false)
  where id = v_id;

  insert into competitor_private values (v_id, v_ata);
  insert into competitor_managers values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end;
$$;

-- p: {id, first_name, last_name, school, state, gender, birth_year, belt, leadership, ata_number?}
create or replace function public.update_competitor(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_ata text := upper(regexp_replace(coalesce(p->>'ata_number', ''), '\s', '', 'g'));
begin
  if not can_manage(v_id) then raise exception 'You can only edit your own competitors.'; end if;
  update competitors set
    first_name = coalesce(nullif(trim(p->>'first_name'), ''), first_name),
    last_name  = coalesce(nullif(trim(p->>'last_name'), ''), last_name),
    school     = coalesce(trim(p->>'school'), school),
    state      = upper(coalesce(trim(p->>'state'), state)),
    gender     = nullif(p->>'gender', ''),
    birth_year = nullif(p->>'birth_year', '')::int,
    belt       = nullif(p->>'belt', ''),
    leadership = coalesce((p->>'leadership')::boolean, leadership)
  where id = v_id;
  if length(v_ata) > 0 then
    if exists (select 1 from competitor_private where ata_number = v_ata and competitor_id <> v_id) then
      raise exception 'That ATA number is already registered to someone else.';
    end if;
    insert into competitor_private values (v_id, v_ata)
      on conflict (competitor_id) do update set ata_number = excluded.ata_number;
  end if;
end;
$$;

-- Admin: fix an opponent placeholder's name/school.
create or replace function public.update_placeholder(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_org uuid;
begin
  select org_id into v_org from competitors where id = v_id and is_placeholder;
  if v_org is null or not is_admin(v_org) then raise exception 'Only an admin can edit opponent profiles.'; end if;
  update competitors set
    first_name = coalesce(nullif(trim(p->>'first_name'), ''), first_name),
    last_name  = coalesce(nullif(trim(p->>'last_name'), ''), last_name),
    school     = coalesce(trim(p->>'school'), school),
    state      = upper(coalesce(trim(p->>'state'), state))
  where id = v_id;
end;
$$;

-- Admin: merge a duplicate opponent placeholder into another profile (all its matches move over).
create or replace function public.merge_competitor(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from competitors where id = p_from and is_placeholder;
  if v_org is null then raise exception 'Only opponent profiles (not students) can be merged away.'; end if;
  if not is_admin(v_org) then raise exception 'Only an admin can merge profiles.'; end if;
  if p_from = p_into or not exists (select 1 from competitors where id = p_into and org_id = v_org) then
    raise exception 'Pick a different profile to merge into.';
  end if;
  update matches set opponent_id = p_into where opponent_id = p_from;
  delete from matches x using entries e where e.id = x.entry_id and e.competitor_id = x.opponent_id;
  delete from competitors where id = p_from;
  perform recompute_ratings(v_org);
end;
$$;

-- ---------------------------------------------------------------------------
-- Logging results
-- ---------------------------------------------------------------------------

-- Find an opponent by id, or reuse/create a placeholder by name + school. Used by tournament and class logging.
create or replace function public.resolve_opponent(p_org uuid, m jsonb, p_round int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_opp uuid;
begin
  if nullif(m->>'opponent_id', '') is not null then
    select id into v_opp from competitors where id = (m->>'opponent_id')::uuid and org_id = p_org;
    if v_opp is null then raise exception 'Opponent in match % not found.', p_round; end if;
    return v_opp;
  end if;
  if length(trim(coalesce(m->'opponent'->>'first_name', ''))) = 0
     or length(trim(coalesce(m->'opponent'->>'last_name', ''))) = 0 then
    raise exception 'Opponent name is missing in match %.', p_round;
  end if;
  select id into v_opp from competitors
    where org_id = p_org
      and lower(first_name) = lower(trim(m->'opponent'->>'first_name'))
      and lower(last_name)  = lower(trim(m->'opponent'->>'last_name'))
      and lower(school)     = lower(coalesce(trim(m->'opponent'->>'school'), ''))
    order by is_placeholder limit 1;
  if v_opp is null then
    insert into competitors (org_id, first_name, last_name, school, state, is_placeholder, created_by)
      values (p_org, trim(m->'opponent'->>'first_name'), trim(m->'opponent'->>'last_name'),
              coalesce(trim(m->'opponent'->>'school'), ''),
              upper(coalesce(trim(m->'opponent'->>'state'), '')), true, auth.uid())
      returning id into v_opp;
  end if;
  return v_opp;
end;
$$;

-- Win/loss from the score; a tied score needs "won" (sudden victory / penalty).
create or replace function public.match_won(m jsonb, p_round int) returns boolean
language plpgsql immutable as $$
declare v_my int := (m->>'my_score')::int; v_their int := (m->>'opp_score')::int;
begin
  if v_my is null or v_their is null then raise exception 'Scores are missing in match %.', p_round; end if;
  if v_my > v_their then return true; end if;
  if v_my < v_their then return false; end if;
  if (m->>'won') is null then raise exception 'Match % is tied: say who won.', p_round; end if;
  return (m->>'won')::boolean;
end;
$$;

-- Results from families start as 'pending' until an instructor approves them; instructors' and admins' own entries are approved.
-- p: {
--   entry_id?               -- set to replace an existing entry (edit)
--   competitor_id,
--   tournament: {id} or {name, event_date, tier, location},
--   discipline: 'sparring' | 'combat', team: bool, team_name,
--   champion: bool, division, placement: 1|2|3|null, ring_size,
--   matches: [{ opponent_id } or { opponent: {first_name, last_name, school, state} },
--              my_score, opp_score, won?, team_score?, opp_team_score?, team_won? ]
-- }
create or replace function public.log_entry(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid := (p->>'competitor_id')::uuid;
  v_org uuid;
  v_t jsonb := p->'tournament';
  v_tid uuid;
  v_entry uuid := nullif(p->>'entry_id', '')::uuid;
  v_m jsonb;
  v_opp uuid;
  v_my int; v_their int; v_won boolean;
  v_round int := 0;
  v_disc text := p->>'discipline';
  v_team boolean := coalesce((p->>'team')::boolean, false);
  v_status text; v_reviewer uuid; v_reviewed timestamptz;
begin
  select org_id into v_org from competitors where id = v_comp and not is_placeholder;
  if v_org is null then raise exception 'Competitor not found.'; end if;
  if not can_manage(v_comp) then raise exception 'You can only log results for your own competitors.'; end if;
  if is_approver(v_org) then v_status := 'approved'; v_reviewer := auth.uid(); v_reviewed := now();
  else v_status := 'pending'; end if;
  if v_disc not in ('sparring', 'combat') then raise exception 'Pick sparring or combat sparring.'; end if;
  if jsonb_array_length(coalesce(p->'matches', '[]'::jsonb)) = 0 then raise exception 'Add at least one match.'; end if;

  -- tournament: existing one, or find/create by name + date
  if v_t ? 'id' and nullif(v_t->>'id', '') is not null then
    select id into v_tid from tournaments where id = (v_t->>'id')::uuid and org_id = v_org;
    if v_tid is null then raise exception 'Tournament not found.'; end if;
  else
    if length(trim(coalesce(v_t->>'name', ''))) = 0 or nullif(v_t->>'event_date', '') is null then
      raise exception 'Tournament name and date are required.';
    end if;
    if (v_t->>'tier') not in ('AAA', 'AA', 'A+', 'A', 'B', 'C') then raise exception 'Pick the tournament class.'; end if;
    select id into v_tid from tournaments
      where org_id = v_org and lower(name) = lower(trim(v_t->>'name')) and event_date = (v_t->>'event_date')::date;
    if v_tid is null then
      insert into tournaments (org_id, name, event_date, tier, location, created_by)
        values (v_org, trim(v_t->>'name'), (v_t->>'event_date')::date, v_t->>'tier',
                coalesce(trim(v_t->>'location'), ''), auth.uid())
        returning id into v_tid;
    end if;
  end if;

  -- entry: replace (edit) or new
  if v_entry is not null then
    if not exists (select 1 from entries where id = v_entry and competitor_id = v_comp) then
      raise exception 'That result was not found.';
    end if;
    delete from matches where entry_id = v_entry;
    update entries set tournament_id = v_tid, discipline = v_disc, team = v_team,
      team_name = coalesce(trim(p->>'team_name'), ''), champion = coalesce((p->>'champion')::boolean, true),
      division = coalesce(trim(p->>'division'), ''), placement = nullif(p->>'placement', '')::int,
      ring_size = nullif(p->>'ring_size', '')::int,
      status = v_status, review_note = '', reviewed_by = v_reviewer, reviewed_at = v_reviewed
    where id = v_entry;
  else
    if exists (select 1 from entries where competitor_id = v_comp and tournament_id = v_tid
                 and discipline = v_disc and team = v_team) then
      raise exception 'This event is already logged for that tournament. Edit the existing result instead.';
    end if;
    insert into entries (competitor_id, tournament_id, discipline, team, team_name, champion, division,
                         placement, ring_size, created_by, status, submission_id, reviewed_by, reviewed_at)
      values (v_comp, v_tid, v_disc, v_team, coalesce(trim(p->>'team_name'), ''),
              coalesce((p->>'champion')::boolean, true), coalesce(trim(p->>'division'), ''),
              nullif(p->>'placement', '')::int, nullif(p->>'ring_size', '')::int, auth.uid(),
              v_status, nullif(p->>'submission_id', '')::uuid, v_reviewer, v_reviewed)
      returning id into v_entry;
  end if;

  for v_m in select * from jsonb_array_elements(p->'matches') loop
    v_round := v_round + 1;
    v_opp := resolve_opponent(v_org, v_m, v_round);
    if v_opp = v_comp then raise exception 'A competitor cannot be their own opponent (match %).', v_round; end if;
    v_my := (v_m->>'my_score')::int;
    v_their := (v_m->>'opp_score')::int;
    v_won := match_won(v_m, v_round);

    insert into matches (entry_id, round_no, opponent_id, my_score, opp_score, won,
                         team_score, opp_team_score, team_won)
      values (v_entry, v_round, v_opp, v_my, v_their, v_won,
              nullif(v_m->>'team_score', '')::int, nullif(v_m->>'opp_team_score', '')::int,
              case when v_team then
                coalesce((v_m->>'team_won')::boolean,
                         case when (v_m->>'team_score')::int > (v_m->>'opp_team_score')::int then true
                              when (v_m->>'team_score')::int < (v_m->>'opp_team_score')::int then false end)
              end);
  end loop;

  perform recompute_ratings(v_org);
  return v_entry;
end;
$$;

create or replace function public.delete_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_org uuid;
begin
  select e.competitor_id, c.org_id into v_comp, v_org
    from entries e join competitors c on c.id = e.competitor_id where e.id = p_entry;
  if v_comp is null then raise exception 'That result was not found.'; end if;
  if not can_manage(v_comp) then raise exception 'You can only delete your own results.'; end if;
  delete from entries where id = p_entry;
  delete from tournaments t where t.org_id = v_org
    and not exists (select 1 from entries e where e.tournament_id = t.id);
  perform recompute_ratings(v_org);
end;
$$;

-- Admin: delete a whole student profile and their results.
create or replace function public.delete_competitor(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from competitors where id = p_id;
  if v_org is null or not is_admin(v_org) then raise exception 'Only an admin can delete a profile.'; end if;
  delete from competitors where id = p_id;
  perform recompute_ratings(v_org);
end;
$$;

-- ---------------------------------------------------------------------------
-- Weekly challenges and titles
--   One challenge is active each week (Monday to Sunday, Indiana time). They rotate through the
--   school's active challenges in order. Completing it gives XP and that week's badge.
--   Titles are earned in the app (see src/lib/achievements.js); a family picks one to show.
-- ---------------------------------------------------------------------------

alter table public.competitors add column if not exists title text;
alter table public.competitors drop constraint if exists competitors_title_check;
alter table public.competitors add constraint competitors_title_check check (title is null or title in (
  'unbroken', 'iron-wall', 'double-gold', 'giant-killer', 'road-warrior', 'centurion',
  'medalist', 'champion-of-champions', 'mythic', 'legend', 'dedicated'));

create table if not exists public.challenges (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  xp           int not null default 50 check (xp between 0 and 500),
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists challenges_org_idx on public.challenges(org_id);

create table if not exists public.challenge_completions (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.competitors(id) on delete cascade,
  challenge_id   uuid references public.challenges(id) on delete set null,
  title          text not null,          -- kept even if the challenge is later edited or removed
  xp             int not null,
  week_start     date not null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (competitor_id, week_start)
);
alter table public.challenge_completions add column if not exists class_log_id uuid references public.class_logs(id) on delete cascade;

alter table public.challenges            enable row level security;
alter table public.challenge_completions enable row level security;

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select using (is_member(org_id));

drop policy if exists completions_read on public.challenge_completions;
create policy completions_read on public.challenge_completions for select
  using (exists (select 1 from competitors c where c.id = competitor_id and is_member(c.org_id)));

-- Monday of the current week, in Indiana time.
create or replace function public.current_week_start() returns date
language sql stable as $$
  select date_trunc('week', (now() at time zone 'America/Indiana/Indianapolis'))::date;
$$;

-- The challenge for the week starting p_week (a Monday). Rotates through active challenges in order.
create or replace function public.challenge_for_week(p_org uuid, p_week date)
returns table (id uuid, title text, description text, xp int, week_start date)
language plpgsql stable security definer set search_path = public as $$
declare v_n int; v_i int;
begin
  select count(*) into v_n from challenges c where c.org_id = p_org and c.active;
  if v_n = 0 then return; end if;
  v_i := (((p_week - date '2026-11-23') / 7) % v_n + v_n) % v_n;
  return query
    select c.id, c.title, c.description, c.xp, p_week from challenges c
    where c.org_id = p_org and c.active
    order by c.sort_order, c.created_at, c.id
    offset v_i limit 1;
end;
$$;

create or replace function public.current_challenge(p_org uuid)
returns table (id uuid, title text, description text, xp int, week_start date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_org) then raise exception 'You are not part of this school.'; end if;
  return query select * from challenge_for_week(p_org, current_week_start());
end;
$$;

create or replace function public.log_challenge(p_competitor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ch record;
begin
  select org_id into v_org from competitors where id = p_competitor and not is_placeholder;
  if v_org is null then raise exception 'Competitor not found.'; end if;
  if not is_approver(v_org) then raise exception 'Log the challenge as part of a class; an instructor approves it.'; end if;
  select * into v_ch from current_challenge(v_org);
  if v_ch.id is null then raise exception 'There is no challenge this week.'; end if;
  if exists (select 1 from challenge_completions where competitor_id = p_competitor and week_start = v_ch.week_start) then
    raise exception 'This week’s challenge is already logged.';
  end if;
  insert into challenge_completions (competitor_id, challenge_id, title, xp, week_start, created_by)
    values (p_competitor, v_ch.id, v_ch.title, v_ch.xp, v_ch.week_start, auth.uid());
end;
$$;

create or replace function public.delete_challenge_completion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comp uuid;
begin
  select competitor_id into v_comp from challenge_completions where id = p_id;
  if v_comp is null then raise exception 'That challenge entry was not found.'; end if;
  if not can_manage(v_comp) then raise exception 'You can only change your own competitors.'; end if;
  delete from challenge_completions where id = p_id;
end;
$$;

-- Admin: add or edit a challenge. p: {id?, org_id, title, description, xp, active, sort_order}
create or replace function public.save_challenge(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_org uuid := (p->>'org_id')::uuid;
begin
  if v_id is not null then select org_id into v_org from challenges where id = v_id; end if;
  if v_org is null or not is_admin(v_org) then raise exception 'Only an admin can edit challenges.'; end if;
  if length(trim(coalesce(p->>'title', ''))) = 0 then raise exception 'Give the challenge a name.'; end if;
  if v_id is null then
    insert into challenges (org_id, title, description, xp, active, sort_order)
      values (v_org, trim(p->>'title'), coalesce(trim(p->>'description'), ''),
              coalesce((p->>'xp')::int, 50), coalesce((p->>'active')::boolean, true),
              coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 1 from challenges where org_id = v_org)))
      returning id into v_id;
  else
    update challenges set title = trim(p->>'title'), description = coalesce(trim(p->>'description'), ''),
      xp = coalesce((p->>'xp')::int, xp), active = coalesce((p->>'active')::boolean, active),
      sort_order = coalesce((p->>'sort_order')::int, sort_order)
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_challenge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from challenges where id = p_id;
  if v_org is null or not is_admin(v_org) then raise exception 'Only an admin can remove challenges.'; end if;
  delete from challenges where id = p_id;
end;
$$;

-- Starter challenges, added once when a school is set up (or from the Admin page if the list is empty).
create or replace function public.add_starter_challenges(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from challenges where org_id = p_org) then return; end if;
  insert into challenges (org_id, title, description, xp, sort_order) values
    (p_org, 'Head hunter', 'Score a head kick in a sparring match.', 50, 1),
    (p_org, 'Combat crack', 'Score a 2-point strike to the head or weapon arm in a combat sparring match.', 50, 2),
    (p_org, 'Air time', 'Score a jumping kick in a sparring match: both feet off the floor.', 50, 3),
    (p_org, 'Counter strike', 'Score a point right after blocking or slipping your opponent''s attack in a sparring match.', 50, 4),
    (p_org, 'No drop', 'Finish a combat sparring match without dropping your weapon and with no warnings.', 50, 5),
    (p_org, 'Shutout', 'Win a sparring or combat match without giving up a point.', 50, 6),
    (p_org, 'Combo point', 'Score with a combination of 3 or more techniques in a sparring match.', 50, 7),
    (p_org, 'Combat jump', 'Score with a jumping strike in a combat sparring match.', 50, 8),
    (p_org, 'Center ring', 'Finish a sparring match without stepping out of bounds once.', 50, 9),
    (p_org, 'Comeback', 'Win a sparring or combat match after being behind on points.', 50, 10),
    (p_org, 'Parry and score', 'Parry your opponent''s weapon and score on the counter in a combat sparring match.', 50, 11),
    (p_org, 'Clean fight', 'Win a sparring match with no warnings or penalty points.', 50, 12);
end;
$$;

create or replace function public.seed_starter_challenges(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_org) then raise exception 'Only an admin can do that.'; end if;
  perform add_starter_challenges(p_org);
end;
$$;

create or replace function public.set_title(p_competitor uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage(p_competitor) then raise exception 'You can only change your own competitors.'; end if;
  update competitors set title = nullif(p_title, '') where id = p_competitor;
end;
$$;

-- setup_org also adds the starter challenges.
create or replace function public.setup_org(p_name text, p_email text, p_display_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_org uuid; v_code text;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account for %. Sign in to the app once with that email first, then run this again.', p_email;
  end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into orgs (name, join_code) values (trim(p_name), v_code) returning id into v_org;
  insert into members (org_id, user_id, role, display_name) values (v_org, v_user, 'admin', trim(p_display_name));
  perform add_starter_challenges(v_org);
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approvals: tournament days and class logs
-- ---------------------------------------------------------------------------

-- Swap the original practice-drill starter challenges for match-based ones, if a school still has them unchanged.
do $$
declare o record;
begin
  for o in select org_id from challenges group by org_id
           having count(*) = 12 and bool_and(title in ('Combo king', 'Light feet', 'Head hunter', 'Counter strike',
             'Edge of the ring', 'Both sides', 'Jump in', 'Ring respect', 'Combat control', 'Two-minute engine',
             'Coach for a round', 'Shutout drill'))
  loop
    delete from challenges where org_id = o.org_id;
    perform add_starter_challenges(o.org_id);
  end loop;
end $$;

-- A whole tournament day at once. p: {competitor_id, tournament: {...}, events: [ {discipline, team, ...matches} ]}
create or replace function public.log_tournament_day(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sub uuid := gen_random_uuid(); v_ev jsonb; v_first boolean := true; v_tid uuid; v_entry uuid;
begin
  if jsonb_array_length(coalesce(p->'events', '[]'::jsonb)) = 0 then raise exception 'Add at least one event.'; end if;
  for v_ev in select * from jsonb_array_elements(p->'events') loop
    v_entry := log_entry(v_ev || jsonb_build_object(
      'competitor_id', p->>'competitor_id',
      'tournament', case when v_first then p->'tournament' else jsonb_build_object('id', v_tid) end,
      'submission_id', v_sub));
    if v_first then select tournament_id into v_tid from entries where id = v_entry; v_first := false; end if;
  end loop;
  return v_sub;
end;
$$;

-- Instructor/admin: approve or reject tournament results (one event, or a whole day by passing all its ids).
create or replace function public.review_entries(p_ids uuid[], p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select distinct c.org_id into v_org from entries e join competitors c on c.id = e.competitor_id where e.id = any(p_ids) limit 1;
  if v_org is null then raise exception 'Nothing to review.'; end if;
  if not is_approver(v_org) then raise exception 'Only an instructor can approve results.'; end if;
  if exists (select 1 from entries e join competitors c on c.id = e.competitor_id where e.id = any(p_ids) and c.org_id <> v_org) then
    raise exception 'Those results belong to different schools.';
  end if;
  update entries set status = case when p_approve then 'approved' else 'rejected' end,
    review_note = coalesce(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = any(p_ids);
  perform recompute_ratings(v_org);
end;
$$;

-- A class the student attended, with any in-class matches and whether they did the weekly challenge.
-- p: {class_log_id?, competitor_id, class_date, challenge_done, note,
--     matches: [{opponent_id | opponent: {...}, discipline, my_score, opp_score, won?}]}
create or replace function public.log_class(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid := (p->>'competitor_id')::uuid; v_org uuid; v_id uuid := nullif(p->>'class_log_id', '')::uuid;
  v_date date := (p->>'class_date')::date; v_m jsonb; v_round int := 0; v_opp uuid; v_approved boolean;
begin
  select org_id into v_org from competitors where id = v_comp and not is_placeholder;
  if v_org is null then raise exception 'Competitor not found.'; end if;
  if not can_manage(v_comp) then raise exception 'You can only log classes for your own competitors.'; end if;
  if v_date is null then raise exception 'Pick the class date.'; end if;
  if v_date > (now() at time zone 'America/Indiana/Indianapolis')::date then raise exception 'That date is in the future.'; end if;
  v_approved := is_approver(v_org);

  if v_id is not null then
    if not exists (select 1 from class_logs where id = v_id and competitor_id = v_comp) then raise exception 'That class was not found.'; end if;
    delete from class_matches where class_log_id = v_id;
    delete from challenge_completions where class_log_id = v_id;
    update class_logs set class_date = v_date, challenge_done = coalesce((p->>'challenge_done')::boolean, false),
      note = coalesce(trim(p->>'note'), ''), status = case when v_approved then 'approved' else 'pending' end,
      review_note = '', reviewed_by = case when v_approved then auth.uid() end, reviewed_at = case when v_approved then now() end
    where id = v_id;
  else
    if exists (select 1 from class_logs where competitor_id = v_comp and class_date = v_date) then
      raise exception 'That class is already logged. Edit it instead.';
    end if;
    insert into class_logs (competitor_id, class_date, challenge_done, note, status, reviewed_by, reviewed_at, created_by)
      values (v_comp, v_date, coalesce((p->>'challenge_done')::boolean, false), coalesce(trim(p->>'note'), ''),
              case when v_approved then 'approved' else 'pending' end,
              case when v_approved then auth.uid() end, case when v_approved then now() end, auth.uid())
      returning id into v_id;
  end if;

  for v_m in select * from jsonb_array_elements(coalesce(p->'matches', '[]'::jsonb)) loop
    v_round := v_round + 1;
    v_opp := resolve_opponent(v_org, v_m, v_round);
    if v_opp = v_comp then raise exception 'A student cannot be their own opponent (match %).', v_round; end if;
    insert into class_matches (class_log_id, round_no, discipline, opponent_id, my_score, opp_score, won)
      values (v_id, v_round, coalesce(nullif(v_m->>'discipline', ''), 'sparring'), v_opp,
              (v_m->>'my_score')::int, (v_m->>'opp_score')::int, match_won(v_m, v_round));
  end loop;

  if v_approved then perform credit_class(v_id); end if;
  perform recompute_ratings(v_org);
  return v_id;
end;
$$;

-- When a class is approved, credit the weekly challenge for that class's week (once per week).
create or replace function public.credit_class(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l record; v_org uuid; ch record; v_week date;
begin
  select * into l from class_logs where id = p_id;
  delete from challenge_completions where class_log_id = p_id;
  if l.status <> 'approved' or not l.challenge_done then return; end if;
  select org_id into v_org from competitors where id = l.competitor_id;
  v_week := date_trunc('week', l.class_date)::date;
  select * into ch from challenge_for_week(v_org, v_week);
  if ch.id is null then return; end if;
  insert into challenge_completions (competitor_id, challenge_id, title, xp, week_start, created_by, class_log_id)
    values (l.competitor_id, ch.id, ch.title, ch.xp, v_week, l.created_by, p_id)
    on conflict (competitor_id, week_start) do nothing;
end;
$$;

create or replace function public.review_class(p_ids uuid[], p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select distinct c.org_id into v_org from class_logs l join competitors c on c.id = l.competitor_id where l.id = any(p_ids) limit 1;
  if v_org is null then raise exception 'Nothing to review.'; end if;
  if not is_approver(v_org) then raise exception 'Only an instructor can approve classes.'; end if;
  if exists (select 1 from class_logs l join competitors c on c.id = l.competitor_id where l.id = any(p_ids) and c.org_id <> v_org) then
    raise exception 'Those classes belong to different schools.';
  end if;
  update class_logs set status = case when p_approve then 'approved' else 'rejected' end,
    review_note = coalesce(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = any(p_ids);
  foreach v_id in array p_ids loop perform credit_class(v_id); end loop;
  perform recompute_ratings(v_org);
end;
$$;

create or replace function public.delete_class_log(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_org uuid;
begin
  select l.competitor_id, c.org_id into v_comp, v_org from class_logs l join competitors c on c.id = l.competitor_id where l.id = p_id;
  if v_comp is null then raise exception 'That class was not found.'; end if;
  if not can_manage(v_comp) then raise exception 'You can only delete your own classes.'; end if;
  delete from class_logs where id = p_id;
  perform recompute_ratings(v_org);
end;
$$;

-- ---------------------------------------------------------------------------
-- State standings import
--   Run from the SQL editor with rows copied from ATA's state standings (sparring and combat weapons).
--   Each ranked person becomes an opponent profile with a head-start rating, or, if they're already in the
--   app by name, gets the head start added. Head start by state place:
--     1st 1150, 2nd-3rd 1125, 4th-10th 1100 (lower places get none).
--   rows: [{event: 'S'|'C', gender: 'BOYS'|'GIRLS'|'MEN'|'WOMEN', rank, age, place, name, points, city}]
-- ---------------------------------------------------------------------------
create or replace function public.import_standings(p_org uuid, p_state text, p_season text, rows jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_first text; v_last text; v_id uuid; v_place int; v_seed numeric; v_n_new int := 0; v_n_upd int := 0;
  v_gender text; v_note text; v_city text;
begin
  -- Not granted to app users: run it from the Supabase SQL editor.
  for r in select * from jsonb_array_elements(rows) loop
    v_place := (r->>'place')::int;
    v_seed := case when v_place = 1 then 1150 when v_place <= 3 then 1125 when v_place <= 10 then 1100 end;
    v_first := initcap(split_part(trim(r->>'name'), ' ', 1));
    v_last := initcap(trim(substr(trim(r->>'name'), length(split_part(trim(r->>'name'), ' ', 1)) + 1)));
    if v_last = '' then continue; end if;
    v_gender := case when r->>'gender' in ('BOYS', 'MEN') then 'M' when r->>'gender' in ('GIRLS', 'WOMEN') then 'F' end;
    v_city := initcap(split_part(coalesce(r->>'city', ''), ',', 1));
    v_note := p_state || ' #' || v_place || ' ' || case when r->>'event' = 'S' then 'sparring' else 'combat' end
              || ', ' || initcap(r->>'gender') || ' ' || coalesce(r->>'rank', '') || ', ' || lower(coalesce(r->>'age', ''))
              || ' (' || p_season || ')';

    select id into v_id from competitors
      where org_id = p_org and lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last)
      order by is_placeholder, created_at limit 1;
    if v_id is null then
      insert into competitors (org_id, first_name, last_name, state, gender, city, is_placeholder)
        values (p_org, v_first, v_last, upper(p_state), v_gender, v_city, true) returning id into v_id;
      v_n_new := v_n_new + 1;
    else
      v_n_upd := v_n_upd + 1;
    end if;

    update competitors set
      seed_sparring = case when r->>'event' = 'S' and v_seed is not null then greatest(coalesce(seed_sparring, 0), v_seed) else seed_sparring end,
      seed_combat   = case when r->>'event' = 'C' and v_seed is not null then greatest(coalesce(seed_combat, 0), v_seed) else seed_combat end,
      city = case when city = '' then v_city else city end,
      gender = coalesce(gender, v_gender),
      ranking_note = case when ranking_note = '' then v_note
                          when position(v_note in ranking_note) > 0 then ranking_note
                          else ranking_note || '; ' || v_note end
    where id = v_id;
  end loop;
  perform recompute_ratings(p_org);
  return v_n_new || ' new opponent profiles, ' || v_n_upd || ' rows matched someone already in the app';
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: signed-in users may call the functions; nobody may write tables directly.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select on public.orgs, public.members, public.competitors, public.competitor_private,
  public.competitor_managers, public.tournaments, public.entries, public.matches, public.ratings,
  public.challenges, public.challenge_completions, public.class_logs, public.class_matches
  to authenticated;

revoke all on all functions in schema public from public, anon;
grant execute on function
  public.is_member(uuid), public.is_admin(uuid), public.can_manage(uuid),
  public.join_org(text, text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.add_manager(uuid, uuid), public.remove_manager(uuid, uuid),
  public.create_competitor(jsonb), public.update_competitor(jsonb), public.update_placeholder(jsonb),
  public.merge_competitor(uuid, uuid), public.log_entry(jsonb), public.delete_entry(uuid),
  public.delete_competitor(uuid), public.current_week_start(), public.current_challenge(uuid),
  public.log_challenge(uuid), public.delete_challenge_completion(uuid), public.save_challenge(jsonb),
  public.delete_challenge(uuid), public.seed_starter_challenges(uuid), public.set_title(uuid, text),
  public.is_approver(uuid), public.log_tournament_day(jsonb), public.review_entries(uuid[], boolean, text),
  public.log_class(jsonb), public.review_class(uuid[], boolean, text), public.delete_class_log(uuid)
  to authenticated;
-- recompute_ratings and setup_org are only run by the functions above or from the SQL editor.
