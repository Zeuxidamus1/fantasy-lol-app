-- Professional game-level stat ingestion for fantasy scoring.

create table if not exists public.pro_games (
  id text primary key,
  match_id text not null references public.pro_matches(id) on delete cascade,
  game_number integer,
  state text not null default 'unstarted',
  blue_team_id text references public.pro_teams(id),
  red_team_id text references public.pro_teams(id),
  winner_team_id text references public.pro_teams(id),
  patch_version text,
  started_at timestamptz,
  completed_at timestamptz,
  source_timestamp timestamptz,
  stats_status text not null default 'pending'
    check (stats_status in ('pending','processing','final','error')),
  first_blood_player_id text,
  first_blood_status text not null default 'pending'
    check (first_blood_status in ('pending','final','unavailable')),
  stats_ingested_at timestamptz,
  updated_at timestamptz not null default now(),
  ingest_error text
);

create table if not exists public.player_game_stats (
  game_id text not null references public.pro_games(id) on delete cascade,
  match_id text not null references public.pro_matches(id) on delete cascade,
  player_id text not null references public.fantasy_players(id),
  participant_id integer not null check (participant_id between 1 and 10),
  team_id text references public.pro_teams(id),
  opponent_team_id text references public.pro_teams(id),
  role text not null check (role in ('TOP','JNG','MID','ADC','SUP')),
  summoner_name text not null,
  champion_id text,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  cs integer not null default 0,
  win boolean,
  first_blood boolean,
  total_gold integer,
  total_gold_earned integer,
  wards_placed integer,
  wards_destroyed integer,
  kill_participation numeric,
  champion_damage_share numeric,
  source_timestamp timestamptz,
  finalized boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (game_id,player_id)
);

alter table public.pro_matches
  add column if not exists winner_team_id text references public.pro_teams(id),
  add column if not exists team_a_game_wins integer,
  add column if not exists team_b_game_wins integer,
  add column if not exists result_finalized_at timestamptz;

create index if not exists pro_games_match_idx on public.pro_games(match_id,game_number);
create index if not exists pro_games_status_idx on public.pro_games(stats_status,state);
create index if not exists pro_games_match_state_idx on public.pro_games(match_id,state,stats_status);
create index if not exists player_game_stats_player_idx on public.player_game_stats(player_id,game_id);
create index if not exists player_game_stats_match_idx on public.player_game_stats(match_id);

alter table public.pro_games enable row level security;
alter table public.player_game_stats enable row level security;

drop policy if exists "authenticated read pro games" on public.pro_games;
create policy "authenticated read pro games" on public.pro_games
  for select to authenticated using (true);

drop policy if exists "authenticated read player game stats" on public.player_game_stats;
create policy "authenticated read player game stats" on public.player_game_stats
  for select to authenticated using (true);

grant select on public.pro_games to authenticated;
grant select on public.player_game_stats to authenticated;
