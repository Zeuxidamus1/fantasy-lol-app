-- Persistent live fantasy scoring calculated from professional game statistics.

create table if not exists public.fantasy_game_scores (
  league_id uuid not null references public.leagues(id) on delete cascade,
  game_id text not null references public.pro_games(id) on delete cascade,
  match_id text not null references public.pro_matches(id) on delete cascade,
  player_id text not null references public.fantasy_players(id) on delete cascade,
  fantasy_points numeric(12,2) not null default 0,
  breakdown jsonb not null default '{}'::jsonb,
  scoring_rules jsonb not null default '{}'::jsonb,
  finalized boolean not null default false,
  source_timestamp timestamptz,
  calculated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, game_id, player_id)
);

create index if not exists fantasy_game_scores_league_player_idx
  on public.fantasy_game_scores(league_id, player_id, game_id);
create index if not exists fantasy_game_scores_league_match_idx
  on public.fantasy_game_scores(league_id, match_id);
create index if not exists fantasy_game_scores_live_idx
  on public.fantasy_game_scores(league_id, finalized, updated_at desc);

alter table public.fantasy_game_scores enable row level security;

drop policy if exists "league members read fantasy game scores" on public.fantasy_game_scores;
create policy "league members read fantasy game scores"
on public.fantasy_game_scores
for select
to authenticated
using (
  exists (
    select 1
    from public.league_members lm
    where lm.league_id = fantasy_game_scores.league_id
      and lm.user_id = (select auth.uid())
  )
);

revoke all on public.fantasy_game_scores from anon;
grant select on public.fantasy_game_scores to authenticated;
grant select, insert, update, delete on public.fantasy_game_scores to service_role;

create or replace function public.calculate_fantasy_points(
  p_kills integer,
  p_deaths integer,
  p_assists integer,
  p_cs integer,
  p_win boolean,
  p_first_blood boolean,
  p_rules jsonb
)
returns jsonb
language sql
immutable
set search_path = public
as $$
with r as (
  select
    coalesce((p_rules->>'kills')::numeric, 3) as kills_mult,
    coalesce((p_rules->>'deaths')::numeric, -1) as deaths_mult,
    coalesce((p_rules->>'assists')::numeric, 2) as assists_mult,
    coalesce((p_rules->>'cs')::numeric, 0.02) as cs_mult,
    coalesce((p_rules->>'win')::numeric, 5) as win_mult,
    coalesce((p_rules->>'firstBlood')::numeric, 2) as fb_mult
), c as (
  select
    coalesce(p_kills,0)::numeric as kills,
    coalesce(p_deaths,0)::numeric as deaths,
    coalesce(p_assists,0)::numeric as assists,
    coalesce(p_cs,0)::numeric as cs,
    case when p_win is true then 1::numeric else 0 end as win,
    case when p_first_blood is true then 1::numeric else 0 end as first_blood,
    r.*
  from r
), pts as (
  select *,
    kills*kills_mult as kills_pts,
    deaths*deaths_mult as deaths_pts,
    assists*assists_mult as assists_pts,
    cs*cs_mult as cs_pts,
    win*win_mult as win_pts,
    first_blood*fb_mult as fb_pts
  from c
)
select jsonb_build_object(
  'total', round(kills_pts+deaths_pts+assists_pts+cs_pts+win_pts+fb_pts, 2),
  'breakdown', jsonb_build_object(
    'kills', jsonb_build_object('stat',kills,'multiplier',kills_mult,'points',round(kills_pts,2)),
    'deaths', jsonb_build_object('stat',deaths,'multiplier',deaths_mult,'points',round(deaths_pts,2)),
    'assists', jsonb_build_object('stat',assists,'multiplier',assists_mult,'points',round(assists_pts,2)),
    'cs', jsonb_build_object('stat',cs,'multiplier',cs_mult,'points',round(cs_pts,2)),
    'win', jsonb_build_object('stat',win,'multiplier',win_mult,'points',round(win_pts,2)),
    'firstBlood', jsonb_build_object('stat',first_blood,'multiplier',fb_mult,'points',round(fb_pts,2))
  )
)
from pts;
$$;

revoke all on function public.calculate_fantasy_points(integer,integer,integer,integer,boolean,boolean,jsonb)
from public, anon, authenticated;
grant execute on function public.calculate_fantasy_points(integer,integer,integer,integer,boolean,boolean,jsonb)
to service_role;

create or replace function public.refresh_fantasy_scores_for_game(p_game_id text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected integer := 0;
begin
  insert into public.fantasy_game_scores(
    league_id,game_id,match_id,player_id,fantasy_points,breakdown,scoring_rules,
    finalized,source_timestamp,calculated_at,updated_at
  )
  select
    l.id,
    s.game_id,
    s.match_id,
    s.player_id,
    (calc.payload->>'total')::numeric,
    calc.payload->'breakdown',
    coalesce(l.settings->'scoring','{}'::jsonb),
    s.finalized,
    s.source_timestamp,
    now(),
    now()
  from public.player_game_stats s
  join public.pro_matches pm on pm.id=s.match_id
  join public.leagues l
    on l.status='active'
   and public.league_competition_code(l.id)=public.normalize_competition_code(pm.competition)
  cross join lateral (
    select public.calculate_fantasy_points(
      s.kills,s.deaths,s.assists,s.cs,s.win,s.first_blood,
      coalesce(l.settings->'scoring','{}'::jsonb)
    ) as payload
  ) calc
  where s.game_id=p_game_id
  on conflict (league_id,game_id,player_id) do update set
    match_id=excluded.match_id,
    fantasy_points=excluded.fantasy_points,
    breakdown=excluded.breakdown,
    scoring_rules=excluded.scoring_rules,
    finalized=excluded.finalized,
    source_timestamp=excluded.source_timestamp,
    calculated_at=now(),
    updated_at=now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.refresh_fantasy_scores_for_game(text) from public, anon, authenticated;
grant execute on function public.refresh_fantasy_scores_for_game(text) to service_role;

create or replace function public.refresh_fantasy_scores_after_stat_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.refresh_fantasy_scores_for_game(new.game_id);
  return new;
end;
$$;

drop trigger if exists refresh_fantasy_scores_on_player_stats on public.player_game_stats;
create trigger refresh_fantasy_scores_on_player_stats
after insert or update of kills,deaths,assists,cs,win,first_blood,finalized,source_timestamp
on public.player_game_stats
for each row
execute function public.refresh_fantasy_scores_after_stat_change();

do $$
begin
  if exists(select 1 from cron.job where jobname='sync-match-stats') then
    perform cron.unschedule('sync-match-stats');
  end if;
end $$;

select cron.schedule(
  'sync-match-stats',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-match-stats',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:=jsonb_build_object('limit',8)
  );
  $cron$
);

do $$
declare g record;
begin
  for g in select distinct game_id from public.player_game_stats loop
    perform public.refresh_fantasy_scores_for_game(g.game_id);
  end loop;
end $$;
