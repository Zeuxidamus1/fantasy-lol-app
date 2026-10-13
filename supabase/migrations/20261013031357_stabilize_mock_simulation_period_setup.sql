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

revoke all on function public.start_mock_simulation(uuid) from public,anon;
grant execute on function public.start_mock_simulation(uuid) to authenticated,service_role;
