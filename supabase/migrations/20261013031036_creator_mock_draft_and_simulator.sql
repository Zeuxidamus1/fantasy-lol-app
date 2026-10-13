create table if not exists public.simulation_runs(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.leagues(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check(status in ('draft','ready','running','completed','canceled')),
  duration_minutes integer not null default 35 check(duration_minutes between 5 and 120),
  elapsed_minutes integer not null default 0 check(elapsed_minutes>=0),
  started_at timestamptz,
  ends_at timestamptz,
  match_id text,
  game_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.simulation_player_stats(
  run_id uuid not null references public.simulation_runs(id) on delete cascade,
  player_id text not null references public.fantasy_players(id),
  manager_id uuid not null,
  manager_type text not null check(manager_type in ('human','bot')),
  kills integer not null default 0 check(kills>=0),
  deaths integer not null default 0 check(deaths>=0),
  assists integer not null default 0 check(assists>=0),
  cs integer not null default 0 check(cs>=0),
  win boolean,
  first_blood boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(run_id,player_id)
);

alter table public.simulation_runs enable row level security;
alter table public.simulation_player_stats enable row level security;
revoke all on public.simulation_runs from public,anon,authenticated;
revoke all on public.simulation_player_stats from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null
    and exists(select 1 from public.platform_admins pa where pa.user_id=auth.uid());
$function$;
CREATE OR REPLACE FUNCTION public.create_mock_league()
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.leagues;
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;

  if exists(
    select 1 from public.leagues l
    where l.owner_id=auth.uid()
      and coalesce((l.settings->>'simulation')::boolean,false)
      and l.status in ('pre_draft','drafting','active')
  ) then
    raise exception 'Finish or delete your current mock league before creating another';
  end if;

  insert into public.leagues(owner_id,name,invite_code,status,settings)
  values(
    auth.uid(),
    'Creator Mock Draft',
    public.new_invite_code(),
    'pre_draft',
    jsonb_build_object(
      'managers',2,'humanManagers',1,'botManagers',1,'bench',1,
      'botLeague',true,'botDifficulty','competitive','autoBotLineups',true,
      'simulation',true,'simulationDurationMinutes',35,
      'competition','worlds','competitionSeason',2026,'competitionType','international',
      'fantasyFormat','tournament','draftType','Snake','scoringFormat','Head-to-head',
      'teamSlot',false,'waivers',false,'trades',false,'tradeReview',false,
      'scoring',jsonb_build_object('kills',3,'deaths',-1,'assists',2,'cs',0.02,'win',5,'firstBlood',2)
    )
  )
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner','Creator Team');

  insert into public.league_bots(league_id,team_name,difficulty)
  values(result.id,'Rift Bot','competitive');

  insert into public.simulation_runs(league_id,owner_id,status,duration_minutes)
  values(result.id,auth.uid(),'draft',35);

  return result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_mock_simulation(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.simulation_runs;
  v_league public.leagues;
  v_matchup jsonb;
  v_stats jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;

  select * into v_league
  from public.leagues
  where id=p_league_id
    and owner_id=auth.uid()
    and coalesce((settings->>'simulation')::boolean,false);

  if v_league.id is null then raise exception 'Mock league not found'; end if;

  select * into v_run from public.simulation_runs where league_id=p_league_id;

  select to_jsonb(lm) into v_matchup
  from public.league_matchups lm
  where lm.league_id=p_league_id and lm.round_number=1 and lm.pair_number=1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id',s.player_id,
    'name',fp.name,
    'team',fp.team,
    'role',fp.role,
    'manager_id',s.manager_id,
    'manager_type',s.manager_type,
    'kills',s.kills,'deaths',s.deaths,'assists',s.assists,'cs',s.cs,
    'win',s.win,'first_blood',s.first_blood,
    'fantasy_points',coalesce(fgs.fantasy_points,0)
  ) order by s.manager_type,s.manager_id,fp.role,fp.name),'[]'::jsonb)
  into v_stats
  from public.simulation_player_stats s
  join public.fantasy_players fp on fp.id=s.player_id
  left join public.fantasy_game_scores fgs
    on fgs.league_id=p_league_id and fgs.game_id=v_run.game_id and fgs.player_id=s.player_id
  where s.run_id=v_run.id;

  return jsonb_build_object(
    'league',to_jsonb(v_league),
    'run',to_jsonb(v_run),
    'matchup',coalesce(v_matchup,'{}'::jsonb),
    'stats',v_stats
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.start_mock_simulation(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.simulation_runs;
  v_bot uuid;
  v_match text;
  v_game text;
  v_now timestamptz:=now();
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;

  if not exists(
    select 1 from public.leagues
    where id=p_league_id and owner_id=auth.uid() and status='active'
      and coalesce((settings->>'simulation')::boolean,false)
  ) then raise exception 'Mock league must have a completed draft before simulation starts'; end if;

  if not exists(select 1 from public.league_drafts where league_id=p_league_id and status='complete') then
    raise exception 'Complete the mock draft first';
  end if;

  select * into v_run from public.simulation_runs where league_id=p_league_id for update;
  if v_run.status='running' then raise exception 'Simulation is already running'; end if;
  if v_run.status='completed' then raise exception 'Simulation is already complete'; end if;

  select id into v_bot from public.league_bots where league_id=p_league_id order by created_at limit 1;
  if v_bot is null then raise exception 'Mock bot is missing'; end if;

  v_match:='sim-match-'||replace(v_run.id::text,'-','');
  v_game:='sim-game-'||replace(v_run.id::text,'-','');

  delete from public.fantasy_lineup_locks where league_id=p_league_id;
  delete from public.fantasy_game_scores where league_id=p_league_id;
  delete from public.league_matchups where league_id=p_league_id;
  delete from public.league_standings where league_id=p_league_id;
  delete from public.fantasy_playoffs where league_id=p_league_id;
  delete from public.fantasy_rounds where league_id=p_league_id;
  delete from public.simulation_player_stats where run_id=v_run.id;

  insert into public.pro_matches(
    id,event_id,competition,league_name,league_code,stage,start_time,
    team_a_name,team_b_name,status,strategy,game_count,updated_at
  )
  values(
    v_match,'simulation:'||p_league_id::text,'simulation','Rift Mock Simulator','SIM',
    '35-Minute Test',v_now,'Creator Team','Rift Bot','INPROGRESS','bestOf1',1,v_now
  )
  on conflict(id) do update set status='INPROGRESS',start_time=v_now,updated_at=v_now,result_finalized_at=null,winner_team_id=null;

  insert into public.pro_games(
    id,match_id,game_number,state,started_at,source_timestamp,stats_status,first_blood_status,updated_at
  )
  values(v_game,v_match,1,'in_progress',v_now,v_now,'processing','pending',v_now)
  on conflict(id) do update set state='in_progress',started_at=v_now,completed_at=null,stats_status='processing',updated_at=v_now;

  delete from public.fantasy_lineup_locks where league_id=p_league_id;
  delete from public.league_matchups where league_id=p_league_id;
  delete from public.league_standings where league_id=p_league_id;
  delete from public.fantasy_playoffs where league_id=p_league_id;
  delete from public.fantasy_rounds where league_id=p_league_id;

  insert into public.fantasy_rounds(
    league_id,round_number,starts_at,ends_at,status,competition,stage,label,match_count,period_source,is_postseason
  )
  values(p_league_id,1,v_now,v_now+interval '35 minutes','live','worlds','Simulation','35-Minute Mock Game',1,'schedule',false);

  insert into public.league_matchups(
    league_id,round_number,pair_number,
    home_manager_id,home_manager_type,away_manager_id,away_manager_type,
    home_score,away_score,result,updated_at
  )
  values(p_league_id,1,1,auth.uid(),'human',v_bot,'bot',0,0,'live',v_now);

  insert into public.fantasy_lineup_locks(
    league_id,round_number,manager_id,manager_type,player_id,slot,locked_at,match_id
  )
  select r.league_id,1,r.user_id,r.manager_type,r.player_id,r.slot,v_now,v_match
  from public.rosters r
  where r.league_id=p_league_id and r.slot<>'BN';

  insert into public.simulation_player_stats(run_id,player_id,manager_id,manager_type)
  select v_run.id,r.player_id,r.user_id,r.manager_type
  from public.rosters r
  where r.league_id=p_league_id and r.slot<>'BN';

  update public.simulation_runs
  set status='running',elapsed_minutes=0,started_at=v_now,
      ends_at=v_now+interval '35 minutes',match_id=v_match,game_id=v_game,updated_at=v_now
  where id=v_run.id;

  return public.get_mock_simulation(p_league_id);
end;
$function$;
CREATE OR REPLACE FUNCTION public.advance_mock_simulation(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.simulation_runs;
  l public.leagues;
  v_target integer;
  v_final boolean;
  v_k numeric; v_d numeric; v_a numeric; v_cs numeric; v_w numeric; v_fb numeric;
  v_home numeric; v_away numeric;
  v_winner uuid;
  v_win_manager uuid;
  v_win_type text;
begin
  select * into r from public.simulation_runs where id=p_run_id for update;
  if r.id is null or r.status<>'running' then return; end if;

  select * into l from public.leagues where id=r.league_id;
  if l.id is null then return; end if;

  v_target:=least(
    r.duration_minutes,
    greatest(r.elapsed_minutes+1,floor(extract(epoch from (now()-r.started_at))/60)::integer+1)
  );
  v_final:=v_target>=r.duration_minutes;

  update public.simulation_player_stats s
  set
    cs=cs+(5+floor(random()*7))::integer,
    kills=kills+(case when random()<0.18 then 1 else 0 end),
    deaths=deaths+(case when random()<0.14 then 1 else 0 end),
    assists=assists+(case when random()<0.34 then 1 else 0 end),
    updated_at=now()
  where s.run_id=r.id;

  if v_target>=3 and not exists(
    select 1 from public.simulation_player_stats where run_id=r.id and first_blood
  ) then
    update public.simulation_player_stats
    set first_blood=true,updated_at=now()
    where run_id=r.id and player_id=(
      select player_id from public.simulation_player_stats where run_id=r.id order by random() limit 1
    );
  end if;

  if v_final then
    select manager_id,manager_type into v_win_manager,v_win_type
    from (
      select distinct manager_id,manager_type
      from public.simulation_player_stats
      where run_id=r.id
    ) x order by random() limit 1;

    update public.simulation_player_stats
    set win=(manager_id=v_win_manager and manager_type=v_win_type),updated_at=now()
    where run_id=r.id;
  end if;

  v_k:=coalesce((l.settings->'scoring'->>'kills')::numeric,3);
  v_d:=coalesce((l.settings->'scoring'->>'deaths')::numeric,-1);
  v_a:=coalesce((l.settings->'scoring'->>'assists')::numeric,2);
  v_cs:=coalesce((l.settings->'scoring'->>'cs')::numeric,0.02);
  v_w:=coalesce((l.settings->'scoring'->>'win')::numeric,5);
  v_fb:=coalesce((l.settings->'scoring'->>'firstBlood')::numeric,2);

  insert into public.fantasy_game_scores(
    league_id,game_id,match_id,player_id,fantasy_points,breakdown,scoring_rules,finalized,source_timestamp,updated_at
  )
  select
    r.league_id,r.game_id,r.match_id,s.player_id,
    round(
      s.kills*v_k+s.deaths*v_d+s.assists*v_a+s.cs*v_cs+
      (case when s.win then v_w else 0 end)+(case when s.first_blood then v_fb else 0 end),2
    ),
    jsonb_build_object(
      'kills',s.kills,'deaths',s.deaths,'assists',s.assists,'cs',s.cs,
      'win',coalesce(s.win,false),'firstBlood',s.first_blood
    ),
    l.settings->'scoring',
    v_final,
    now(),now()
  from public.simulation_player_stats s
  where s.run_id=r.id
  on conflict(league_id,game_id,player_id) do update set
    fantasy_points=excluded.fantasy_points,
    breakdown=excluded.breakdown,
    scoring_rules=excluded.scoring_rules,
    finalized=excluded.finalized,
    source_timestamp=excluded.source_timestamp,
    updated_at=now();

  select public.manager_round_score(r.league_id,1,lm.home_manager_id,lm.home_manager_type),
         public.manager_round_score(r.league_id,1,lm.away_manager_id,lm.away_manager_type)
  into v_home,v_away
  from public.league_matchups lm
  where lm.league_id=r.league_id and lm.round_number=1 and lm.pair_number=1;

  if v_final then
    v_winner:=case when v_home>=v_away then
      (select home_manager_id from public.league_matchups where league_id=r.league_id and round_number=1 and pair_number=1)
    else
      (select away_manager_id from public.league_matchups where league_id=r.league_id and round_number=1 and pair_number=1)
    end;

    update public.league_matchups
    set home_score=round(v_home,2),away_score=round(v_away,2),
        result=case when v_home>=v_away then 'home_win' else 'away_win' end,
        winner_manager_id=v_winner,finalized_at=now(),updated_at=now()
    where league_id=r.league_id and round_number=1 and pair_number=1;

    update public.fantasy_rounds set status='final',updated_at=now()
    where league_id=r.league_id and round_number=1;

    update public.pro_games
    set state='completed',completed_at=now(),stats_status='final',stats_ingested_at=now(),
        first_blood_status='final',updated_at=now()
    where id=r.game_id;

    update public.pro_matches
    set status='COMPLETED',result_finalized_at=now(),updated_at=now()
    where id=r.match_id;

    update public.simulation_runs
    set status='completed',elapsed_minutes=duration_minutes,updated_at=now()
    where id=r.id;

    update public.leagues set status='completed' where id=r.league_id;
  else
    update public.league_matchups
    set home_score=round(v_home,2),away_score=round(v_away,2),result='live',winner_manager_id=null,updated_at=now()
    where league_id=r.league_id and round_number=1 and pair_number=1;

    update public.simulation_runs
    set elapsed_minutes=v_target,updated_at=now()
    where id=r.id;
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.advance_mock_simulations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  x record;
  n integer:=0;
begin
  for x in select id from public.simulation_runs where status='running' order by started_at
  loop
    perform public.advance_mock_simulation(x.id);
    n:=n+1;
  end loop;
  return n;
end;
$function$;
CREATE OR REPLACE FUNCTION public.delete_mock_league(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.simulation_runs;
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;
  if not exists(
    select 1 from public.leagues
    where id=p_league_id and owner_id=auth.uid()
      and coalesce((settings->>'simulation')::boolean,false)
  ) then raise exception 'Mock league not found'; end if;

  select * into r from public.simulation_runs where league_id=p_league_id;

  if r.game_id is not null then delete from public.pro_games where id=r.game_id; end if;
  if r.match_id is not null then delete from public.pro_matches where id=r.match_id; end if;
  delete from public.leagues where id=p_league_id;
end;
$function$;

revoke all on function public.is_platform_admin() from public,anon;
grant execute on function public.is_platform_admin() to authenticated,service_role;
revoke all on function public.create_mock_league() from public,anon;
grant execute on function public.create_mock_league() to authenticated,service_role;
revoke all on function public.get_mock_simulation(uuid) from public,anon;
grant execute on function public.get_mock_simulation(uuid) to authenticated,service_role;
revoke all on function public.start_mock_simulation(uuid) from public,anon;
grant execute on function public.start_mock_simulation(uuid) to authenticated,service_role;
revoke all on function public.advance_mock_simulation(uuid) from public,anon,authenticated;
grant execute on function public.advance_mock_simulation(uuid) to service_role;
revoke all on function public.advance_mock_simulations() from public,anon,authenticated;
grant execute on function public.advance_mock_simulations() to service_role;
revoke all on function public.delete_mock_league(uuid) from public,anon;
grant execute on function public.delete_mock_league(uuid) to authenticated,service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='advance-mock-simulations') then
    perform cron.unschedule('advance-mock-simulations');
  end if;
end $$;

select cron.schedule(
  'advance-mock-simulations',
  '* * * * *',
  $$select public.advance_mock_simulations();$$
);
