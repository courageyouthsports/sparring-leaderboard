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

-- Current skill rating per competitor per discipline (rebuilt from all matches).
create table if not exists public.ratings (
  competitor_id  uuid not null references public.competitors(id) on delete cascade,
  discipline     text not null check (discipline in ('sparring', 'combat')),
  rating         numeric not null,
  peak           numeric not null,
  matches        int not null,
  wins           int not null,
  primary key (competitor_id, discipline)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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

drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings for select
  using (exists (select 1 from competitors c where c.id = competitor_id and is_member(c.org_id)));

-- ---------------------------------------------------------------------------
-- Rating engine
--   Everyone starts at 1000, separately for sparring and combat sparring.
--   Expected  E = 1 / (1 + 10^((opponent - me) / 400))
--   Result    S = 0.5 x (1 if won) + 0.5 x (my points / total points)
--   Change    = 32 x tier multiplier x (S - E); the opponent moves by the same amount the other way.
--   Tier multipliers: AAA 1.5, AA 1.3, A+ 1.15, A 1.0, B 0.75, C 0.5
-- The whole history is replayed in date order every time a result changes, so edits and
-- deletes are always reflected correctly. If both students in a match logged it, it counts once.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_ratings(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m record;
  ra numeric; rb numeric; e numeric; s numeric; mult numeric; d numeric; tot int;
begin
  create temp table if not exists _r (
    cid uuid, disc text, rating numeric, n int, w int, peak numeric,
    primary key (cid, disc)
  ) on commit drop;
  truncate _r;

  update matches x set rating_before = null, rating_after = null, opp_rating_before = null, opp_rating_after = null
  from entries en join tournaments t on t.id = en.tournament_id
  where en.id = x.entry_id and t.org_id = p_org;

  for m in
    select x.id, x.opponent_id, x.my_score, x.opp_score, x.won,
           en.competitor_id as cid, en.discipline as disc, t.tier
    from matches x
    join entries en on en.id = x.entry_id
    join tournaments t on t.id = en.tournament_id
    where t.org_id = p_org
      and not exists (   -- skip the second copy of a match both students logged
        select 1 from matches y join entries e2 on e2.id = y.entry_id
        where e2.tournament_id = en.tournament_id and e2.discipline = en.discipline
          and e2.competitor_id = x.opponent_id and y.opponent_id = en.competitor_id
          and y.my_score = x.opp_score and y.opp_score = x.my_score and y.won <> x.won
          and y.id < x.id)
    order by t.event_date, en.created_at, en.id, x.round_no, x.id
  loop
    insert into _r values (m.cid, m.disc, 1000, 0, 0, 1000) on conflict do nothing;
    insert into _r values (m.opponent_id, m.disc, 1000, 0, 0, 1000) on conflict do nothing;
    select rating into ra from _r where cid = m.cid and disc = m.disc;
    select rating into rb from _r where cid = m.opponent_id and disc = m.disc;

    tot  := m.my_score + m.opp_score;
    s    := 0.5 * (case when m.won then 1 else 0 end)
          + 0.5 * (case when tot > 0 then m.my_score::numeric / tot else 0.5 end);
    e    := 1 / (1 + power(10::numeric, (rb - ra) / 400));
    mult := case m.tier when 'AAA' then 1.5 when 'AA' then 1.3 when 'A+' then 1.15
                        when 'A' then 1.0 when 'B' then 0.75 else 0.5 end;
    d    := 32 * mult * (s - e);

    update _r set rating = rating + d, n = n + 1, w = w + (case when m.won then 1 else 0 end),
                  peak = greatest(peak, rating + d)
      where cid = m.cid and disc = m.disc;
    update _r set rating = rating - d, n = n + 1, w = w + (case when m.won then 0 else 1 end),
                  peak = greatest(peak, rating - d)
      where cid = m.opponent_id and disc = m.disc;

    update matches set rating_before = round(ra, 1), rating_after = round(ra + d, 1),
                       opp_rating_before = round(rb, 1), opp_rating_after = round(rb - d, 1)
      where id = m.id;
  end loop;

  -- give the skipped duplicate copies the same numbers, seen from the other side
  update matches y set rating_before = x.opp_rating_before, rating_after = x.opp_rating_after,
                       opp_rating_before = x.rating_before, opp_rating_after = x.rating_after
  from matches x, entries ex, entries ey, tournaments t
  where ex.id = x.entry_id and ey.id = y.entry_id and t.id = ey.tournament_id and t.org_id = p_org
    and y.rating_before is null and x.rating_before is not null
    and ex.tournament_id = ey.tournament_id and ex.discipline = ey.discipline
    and ey.competitor_id = x.opponent_id and y.opponent_id = ex.competitor_id
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
  v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
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
  if p_role not in ('admin', 'member') then raise exception 'Unknown role.'; end if;
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
begin
  select org_id into v_org from competitors where id = v_comp and not is_placeholder;
  if v_org is null then raise exception 'Competitor not found.'; end if;
  if not can_manage(v_comp) then raise exception 'You can only log results for your own competitors.'; end if;
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
      ring_size = nullif(p->>'ring_size', '')::int
    where id = v_entry;
  else
    if exists (select 1 from entries where competitor_id = v_comp and tournament_id = v_tid
                 and discipline = v_disc and team = v_team) then
      raise exception 'This event is already logged for that tournament. Edit the existing result instead.';
    end if;
    insert into entries (competitor_id, tournament_id, discipline, team, team_name, champion, division,
                         placement, ring_size, created_by)
      values (v_comp, v_tid, v_disc, v_team, coalesce(trim(p->>'team_name'), ''),
              coalesce((p->>'champion')::boolean, true), coalesce(trim(p->>'division'), ''),
              nullif(p->>'placement', '')::int, nullif(p->>'ring_size', '')::int, auth.uid())
      returning id into v_entry;
  end if;

  for v_m in select * from jsonb_array_elements(p->'matches') loop
    v_round := v_round + 1;
    -- opponent: existing profile, or a new placeholder (reusing one with the same name + school)
    if nullif(v_m->>'opponent_id', '') is not null then
      select id into v_opp from competitors where id = (v_m->>'opponent_id')::uuid and org_id = v_org;
      if v_opp is null then raise exception 'Opponent in match % not found.', v_round; end if;
    else
      if length(trim(coalesce(v_m->'opponent'->>'first_name', ''))) = 0
         or length(trim(coalesce(v_m->'opponent'->>'last_name', ''))) = 0 then
        raise exception 'Opponent name is missing in match %.', v_round;
      end if;
      select id into v_opp from competitors
        where org_id = v_org
          and lower(first_name) = lower(trim(v_m->'opponent'->>'first_name'))
          and lower(last_name)  = lower(trim(v_m->'opponent'->>'last_name'))
          and lower(school)     = lower(coalesce(trim(v_m->'opponent'->>'school'), ''))
        order by is_placeholder limit 1;
      if v_opp is null then
        insert into competitors (org_id, first_name, last_name, school, state, is_placeholder, created_by)
          values (v_org, trim(v_m->'opponent'->>'first_name'), trim(v_m->'opponent'->>'last_name'),
                  coalesce(trim(v_m->'opponent'->>'school'), ''),
                  upper(coalesce(trim(v_m->'opponent'->>'state'), '')), true, auth.uid())
          returning id into v_opp;
      end if;
    end if;
    if v_opp = v_comp then raise exception 'A competitor cannot be their own opponent (match %).', v_round; end if;

    v_my := (v_m->>'my_score')::int;
    v_their := (v_m->>'opp_score')::int;
    if v_my is null or v_their is null then raise exception 'Scores are missing in match %.', v_round; end if;
    if v_my > v_their then v_won := true;
    elsif v_my < v_their then v_won := false;
    else
      v_won := (v_m->>'won')::boolean;  -- tied score: decided by sudden victory / penalty
      if v_won is null then raise exception 'Match % is tied: say who won.', v_round; end if;
    end if;

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

create or replace function public.current_challenge(p_org uuid)
returns table (id uuid, title text, description text, xp int, week_start date)
language plpgsql stable security definer set search_path = public as $$
declare v_n int; v_week date := current_week_start(); v_i int;
begin
  if not is_member(p_org) then raise exception 'You are not part of this school.'; end if;
  select count(*) into v_n from challenges c where c.org_id = p_org and c.active;
  if v_n = 0 then return; end if;
  v_i := (((v_week - date '2026-11-23') / 7) % v_n + v_n) % v_n;
  return query
    select c.id, c.title, c.description, c.xp, v_week from challenges c
    where c.org_id = p_org and c.active
    order by c.sort_order, c.created_at, c.id
    offset v_i limit 1;
end;
$$;

create or replace function public.log_challenge(p_competitor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ch record;
begin
  select org_id into v_org from competitors where id = p_competitor and not is_placeholder;
  if v_org is null then raise exception 'Competitor not found.'; end if;
  if not can_manage(p_competitor) then raise exception 'You can only log challenges for your own competitors.'; end if;
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
    (p_org, 'Combo king', 'Land a clean jab, cross, round kick on the target 10 times in a row without dropping your guard.', 50, 1),
    (p_org, 'Light feet', 'Stay on the balls of your feet for a full 2-minute round. No flat-footing, no crossing your feet.', 50, 2),
    (p_org, 'Head hunter', 'Score 5 controlled head kicks in partner drills, each one chambered and pulled back.', 50, 3),
    (p_org, 'Counter strike', 'Block or slip your partner''s attack and counter within one second, 10 times.', 50, 4),
    (p_org, 'Edge of the ring', 'Spar a round where you get pushed to the edge and angle back to the center every time without stepping out.', 50, 5),
    (p_org, 'Both sides', 'Throw every technique in a 2-minute drill from your weaker side.', 50, 6),
    (p_org, 'Jump in', 'Land 3 jumping kicks to the body in partner drills, both feet off the floor.', 50, 7),
    (p_org, 'Ring respect', 'Bow in, shake hands and thank every partner you spar this week. Your instructor will notice.', 50, 8),
    (p_org, 'Combat control', 'Finish a combat sparring round with zero illegal strikes and no dropped weapon.', 50, 9),
    (p_org, 'Two-minute engine', 'Keep moving and throwing for a full 2-minute round. No resting, no backing out of the ring.', 50, 10),
    (p_org, 'Coach for a round', 'Help a newer student with one technique during class until they can do it on their own.', 50, 11),
    (p_org, 'Shutout drill', 'Win a drill round against a partner without letting them score.', 50, 12);
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
  v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  insert into orgs (name, join_code) values (trim(p_name), v_code) returning id into v_org;
  insert into members (org_id, user_id, role, display_name) values (v_org, v_user, 'admin', trim(p_display_name));
  perform add_starter_challenges(v_org);
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: signed-in users may call the functions; nobody may write tables directly.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select on public.orgs, public.members, public.competitors, public.competitor_private,
  public.competitor_managers, public.tournaments, public.entries, public.matches, public.ratings,
  public.challenges, public.challenge_completions
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
  public.delete_challenge(uuid), public.seed_starter_challenges(uuid), public.set_title(uuid, text)
  to authenticated;
-- recompute_ratings and setup_org are only run by the functions above or from the SQL editor.
