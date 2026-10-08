-- Canonical professional schedule model for fantasy competition scoping.

create table if not exists public.pro_teams (
  id text primary key,
  name text not null,
  code text,
  competitions text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pro_matches (
  id text primary key,
  event_id text,
  competition text not null references public.competitions(code),
  league_name text not null,
  league_code text,
  stage text,
  start_time timestamptz,
  team_a_id text references public.pro_teams(id),
  team_a_name text not null,
  team_a_code text,
  team_b_id text references public.pro_teams(id),
  team_b_name text not null,
  team_b_code text,
  status text not null default 'UNSTARTED',
  strategy text,
  game_count integer,
  updated_at timestamptz not null default now()
);

alter table public.fantasy_players
  add column if not exists team_id text references public.pro_teams(id);

create index if not exists pro_matches_competition_time_idx
  on public.pro_matches(competition,start_time);
create index if not exists pro_matches_team_a_idx
  on public.pro_matches(team_a_id,start_time);
create index if not exists pro_matches_team_b_idx
  on public.pro_matches(team_b_id,start_time);
create index if not exists fantasy_players_team_id_idx
  on public.fantasy_players(team_id);

alter table public.pro_teams enable row level security;
alter table public.pro_matches enable row level security;

drop policy if exists "authenticated read pro teams" on public.pro_teams;
create policy "authenticated read pro teams" on public.pro_teams
  for select to authenticated using (true);

drop policy if exists "authenticated read pro matches" on public.pro_matches;
create policy "authenticated read pro matches" on public.pro_matches
  for select to authenticated using (true);

grant select on public.pro_teams to authenticated;
grant select on public.pro_matches to authenticated;
