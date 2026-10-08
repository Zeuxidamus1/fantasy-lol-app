
create table if not exists public.player_projections (
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id text not null references public.fantasy_players(id) on delete cascade,
  round_number integer not null,
  expected_games integer not null default 0,
  avg_fp_per_game numeric(12,2) not null default 0,
  recent_avg_fp numeric(12,2) not null default 0,
  projected_fp numeric(12,2) not null default 0,
  generated_at timestamptz not null default now(),
  primary key (league_id,player_id,round_number)
);

create table if not exists public.league_activity (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  kind text not null,
  actor_manager_id uuid,
  actor_manager_type text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.league_history (
  league_id uuid not null references public.leagues(id) on delete cascade,
  season_key text not null,
  competition text not null,
  champion_manager_id uuid,
  champion_manager_type text,
  final_standings jsonb not null default '[]'::jsonb,
  final_bracket jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (league_id,season_key)
);

create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  page text,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.player_projections enable row level security;
alter table public.league_activity enable row level security;
alter table public.league_history enable row level security;
alter table public.client_error_logs enable row level security;
alter table public.platform_admins enable row level security;

drop policy if exists "league members read projections" on public.player_projections;
create policy "league members read projections"
on public.player_projections for select to authenticated
using (exists(select 1 from public.league_members lm
  where lm.league_id=player_projections.league_id and lm.user_id=(select auth.uid())));

drop policy if exists "league members read activity" on public.league_activity;
create policy "league members read activity"
on public.league_activity for select to authenticated
using (exists(select 1 from public.league_members lm
  where lm.league_id=league_activity.league_id and lm.user_id=(select auth.uid())));

drop policy if exists "league members read history" on public.league_history;
create policy "league members read history"
on public.league_history for select to authenticated
using (exists(select 1 from public.league_members lm
  where lm.league_id=league_history.league_id and lm.user_id=(select auth.uid())));

drop policy if exists "users insert own errors" on public.client_error_logs;
create policy "users insert own errors"
on public.client_error_logs for insert to authenticated
with check ((select auth.uid())=user_id);

revoke all on public.player_projections,public.league_activity,public.league_history,public.client_error_logs,public.platform_admins from anon;
grant select on public.player_projections,public.league_activity,public.league_history to authenticated;
grant insert on public.client_error_logs to authenticated;
grant select,insert,update,delete on public.player_projections,public.league_activity,public.league_history,public.client_error_logs,public.platform_admins to service_role;

insert into public.platform_admins(user_id)
select owner_id from public.leagues where id='0cc92c8d-751f-4f77-93f8-9af87f02dfe0'
on conflict do nothing;

create index if not exists player_projections_round_idx on public.player_projections(league_id,round_number,projected_fp desc);
create index if not exists league_activity_recent_idx on public.league_activity(league_id,created_at desc);
create index if not exists client_error_logs_recent_idx on public.client_error_logs(created_at desc);

create or replace function public.refresh_player_projections(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  insert into public.player_projections(
    league_id,player_id,round_number,expected_games,avg_fp_per_game,recent_avg_fp,projected_fp,generated_at
  )
  select
    l.id,
    fp.id,
    fr.round_number,
    coalesce(sched.games,0),
    round(coalesce(hist.avg_fp,0),2),
    round(coalesce(recent.avg_fp,coalesce(hist.avg_fp,0)),2),
    round(coalesce(recent.avg_fp,coalesce(hist.avg_fp,0))*coalesce(sched.games,0),2),
    now()
  from public.leagues l
  join public.fantasy_rounds fr
    on fr.league_id=l.id and now()<fr.ends_at
    and fr.round_number=(
      select min(fr2.round_number) from public.fantasy_rounds fr2
      where fr2.league_id=l.id and now()<fr2.ends_at
    )
  join public.fantasy_players fp
    on public.league_competition_code(l.id)=any(fp.competitions)
  left join lateral (
    select count(*)::integer games
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=fr.competition
      and pm.start_time>=greatest(now(),fr.starts_at) and pm.start_time<fr.ends_at
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
      and (
        (fp.team_id is not null and fp.team_id in (pm.team_a_id,pm.team_b_id))
        or (
          fp.team_id is null and lower(regexp_replace(fp.team,'[^a-zA-Z0-9]+','','g')) in (
            lower(regexp_replace(pm.team_a_name,'[^a-zA-Z0-9]+','','g')),
            lower(regexp_replace(pm.team_b_name,'[^a-zA-Z0-9]+','','g')),
            lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
            lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
          )
        )
      )
  ) sched on true
  left join lateral (
    select avg(fgs.fantasy_points)::numeric avg_fp
    from public.fantasy_game_scores fgs
    where fgs.league_id=l.id and fgs.player_id=fp.id and fgs.finalized
  ) hist on true
  left join lateral (
    select avg(x.fantasy_points)::numeric avg_fp
    from (
      select fgs.fantasy_points
      from public.fantasy_game_scores fgs
      where fgs.league_id=l.id and fgs.player_id=fp.id and fgs.finalized
      order by fgs.source_timestamp desc nulls last
      limit 5
    ) x
  ) recent on true
  where l.status='active' and (p_league_id is null or l.id=p_league_id)
  on conflict (league_id,player_id,round_number) do update set
    expected_games=excluded.expected_games,
    avg_fp_per_game=excluded.avg_fp_per_game,
    recent_avg_fp=excluded.recent_avg_fp,
    projected_fp=excluded.projected_fp,
    generated_at=now();

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_player_projections(uuid) from public,anon,authenticated;
grant execute on function public.refresh_player_projections(uuid) to service_role;

create or replace function public.capture_league_history(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare v_comp text; v_key text;
begin
  select public.league_competition_code(p_league_id) into v_comp;
  if v_comp is null then return 0; end if;
  v_key:=v_comp||'-2026';

  insert into public.league_history(
    league_id,season_key,competition,champion_manager_id,champion_manager_type,
    final_standings,final_bracket,completed_at
  )
  select
    p_league_id,v_key,v_comp,
    lc.manager_id,lc.manager_type,
    coalesce((select jsonb_agg(to_jsonb(ls) order by ls.rank) from public.league_standings ls where ls.league_id=p_league_id),'[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(fp) order by fp.stage,fp.bracket_slot) from public.fantasy_playoffs fp where fp.league_id=p_league_id),'[]'::jsonb),
    lc.finalized_at
  from public.league_champions lc
  where lc.league_id=p_league_id
  on conflict (league_id,season_key) do update set
    champion_manager_id=excluded.champion_manager_id,
    champion_manager_type=excluded.champion_manager_type,
    final_standings=excluded.final_standings,
    final_bracket=excluded.final_bracket,
    completed_at=excluded.completed_at;

  return 1;
end;
$$;

revoke all on function public.capture_league_history(uuid) from public,anon,authenticated;
grant execute on function public.capture_league_history(uuid) to service_role;

create or replace function public.log_roster_activity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
  values(
    new.league_id,'roster_'||new.action,new.user_id,'human',
    jsonb_build_object('player_id',new.player_id,'transaction_id',new.id)
  );
  return new;
end;
$$;

drop trigger if exists log_roster_activity on public.roster_transactions;
create trigger log_roster_activity
after insert on public.roster_transactions
for each row execute function public.log_roster_activity();

do $$
begin
  if exists(select 1 from cron.job where jobname='refresh-player-projections') then perform cron.unschedule('refresh-player-projections'); end if;
  if exists(select 1 from cron.job where jobname='capture-league-history') then perform cron.unschedule('capture-league-history'); end if;
end $$;

select cron.schedule('refresh-player-projections','22 * * * *',$$select public.refresh_player_projections(null);$$);
select cron.schedule('capture-league-history','52 * * * *',$$select public.capture_league_history(league_id) from public.league_champions;$$);

select public.refresh_player_projections(null);
