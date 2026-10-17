-- Creator Booth data bank
-- Run this ONCE in Supabase -> SQL Editor -> New query -> paste everything -> Run.
-- Safe to run again later: it only creates what is missing.
--
-- These tables are private. Nobody can read or change them with the public (anon) key that sits in the
-- website. Only your own server code (api/bank.js, api/admin.js, api/cron-sync.js) can, using the
-- SUPABASE_SERVICE_KEY you add in Vercel.

create table if not exists public.bank_matches (
  id          text primary key,                 -- league|season|home|away  (cups and Inter Miami also include the date)
  league      text not null check (league in ('EPL','LALIGA','SERIEA','BUNDESLIGA','LIGUE1','SPL','UCL','UEL','UECL','INTERMIAMI')),
  comp_name   text,                             -- competition as the source named it (Inter Miami plays in several)
  season      int  not null check (season between 1990 and 2100),   -- the year the season STARTS: 2025 = 2025/26
  round       text,
  date        date not null,
  time        text,                             -- listed kick-off time, local, as the source gave it
  kickoff     timestamptz,                      -- exact kick-off from API-Football when known
  home        text not null,
  away        text not null,
  hg          int  check (hg between 0 and 40), -- goals at full time (after extra time if it went there)
  ag          int  check (ag between 0 and 40),
  ht_h        int,
  ht_a        int,
  status      text not null default 'scheduled' check (status in ('scheduled','finished','postponed','cancelled')),
  note        text,                             -- e.g. "penalties 4-3"
  source      text not null default 'paste',    -- openfootball | api-football | paste | manual
  verified    boolean not null default false,   -- true once you confirmed it yourself in the admin page
  conflict    jsonb,                            -- another source claimed a different score: {hg, ag, source, at}
  updated_at  timestamptz not null default now(),
  constraint bank_finished_has_score check (status <> 'finished' or (hg is not null and ag is not null))
);
create index if not exists bank_matches_league_season on public.bank_matches (league, season, date);
create index if not exists bank_matches_home on public.bank_matches (league, home);
create index if not exists bank_matches_away on public.bank_matches (league, away);
create index if not exists bank_matches_status on public.bank_matches (status, date);

create table if not exists public.bank_aliases (          -- spellings that mean the same club
  alias      text primary key,                            -- simplified spelling
  canonical  text not null,                               -- the name we show
  created_at timestamptz not null default now()
);

create table if not exists public.bank_facts (            -- hand-checked facts: honours, awards, anything you want the AI to know
  id         bigserial primary key,
  title      text not null,
  body       text not null,
  tags       text[] not null default '{}',                -- words in a question that should bring this fact in
  as_of      date,
  source     text,
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_log (              -- what the daily job and imports did
  id      bigserial primary key,
  at      timestamptz not null default now(),
  kind    text not null,
  ok      boolean not null default true,
  summary text,
  detail  jsonb
);
create index if not exists bank_log_at on public.bank_log (at desc);

create table if not exists public.bank_inbox (            -- matches waiting for a club name to be mapped
  id       bigserial primary key,
  key      text not null unique,
  at       timestamptz not null default now(),
  league   text,
  season   int,
  team     text,
  row      jsonb,
  reason   text,
  resolved boolean not null default false
);

-- keep updated_at honest
create or replace function public.bank_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists bank_matches_touch on public.bank_matches;
create trigger bank_matches_touch before update on public.bank_matches for each row execute function public.bank_touch();

-- summaries the admin page reads
create or replace view public.bank_summary with (security_invoker = true) as
select league, season,
       count(*)                                                        as total,
       count(*) filter (where status = 'finished')                     as finished,
       count(*) filter (where status = 'scheduled')                    as scheduled,
       count(*) filter (where status = 'scheduled' and date < current_date) as gaps,
       count(*) filter (where status = 'postponed')                    as postponed,
       count(*) filter (where conflict is not null)                    as conflicts,
       count(*) filter (where verified)                                as verified,
       max(date) filter (where status = 'finished')                    as last_result,
       min(date)                                                       as first_date,
       max(date)                                                       as last_date
from public.bank_matches group by league, season;

create or replace view public.bank_clubs with (security_invoker = true) as
select league, club, max(season) as last_season, count(*) as matches
from (select league, home as club, season from public.bank_matches
      union all
      select league, away as club, season from public.bank_matches) t
group by league, club;

-- lock everything: no public access at all
alter table public.bank_matches enable row level security;
alter table public.bank_aliases enable row level security;
alter table public.bank_facts   enable row level security;
alter table public.bank_log     enable row level security;
alter table public.bank_inbox   enable row level security;
revoke all on public.bank_matches, public.bank_aliases, public.bank_facts, public.bank_log, public.bank_inbox, public.bank_summary, public.bank_clubs from anon, authenticated;
revoke all on sequence public.bank_facts_id_seq, public.bank_log_id_seq, public.bank_inbox_id_seq from anon, authenticated;
