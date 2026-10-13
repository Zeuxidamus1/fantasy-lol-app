-- Creator Lab test modes:
-- 5-minute Quick Test (default) or 35-minute Full Simulation.
-- Both exercise the same scoring/finalization flow. Quick Test compresses
-- full-game stat generation into five scoring ticks.

CREATE OR REPLACE FUNCTION public.create_mock_league(
  p_competition text DEFAULT 'worlds'::text,
  p_duration_minutes integer DEFAULT 5
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  result public.leagues;
  v_competition text;
  v_duration integer;
  v_meta record;
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;

  v_competition:=public.normalize_competition_code(p_competition);
  if v_competition is null then raise exception 'Choose a valid tournament'; end if;

  v_duration:=case when p_duration_minutes=35 then 35 else 5 end;

  select * into v_meta
  from public.list_mock_competitions()
  where code=v_competition;

  if v_meta.code is null or not v_meta.available then
    raise exception '% does not currently have enough eligible players for a 2-team mock draft',upper(v_competition);
  end if;

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
    'Creator Mock Draft · '||v_meta.display_name,
    public.new_invite_code(),
    'pre_draft',
    jsonb_build_object(
      'managers',2,'humanManagers',1,'botManagers',1,'bench',1,
      'botLeague',true,'botDifficulty','competitive','autoBotLineups',true,
      'simulation',true,'simulationDurationMinutes',v_duration,
      'competition',v_competition,'competitionSeason',2026,
      'competitionType',coalesce((select competition_type from public.competitions where code=v_competition),'international'),
      'fantasyFormat',case when v_competition in ('worlds','msi','first_stand') then 'tournament' else 'season' end,
      'draftType','Snake','scoringFormat','Head-to-head',
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
  values(result.id,auth.uid(),'draft',v_duration);

  return result;
end;
$function$;

revoke all on function public.create_mock_league(text,integer) from public,anon;
grant execute on function public.create_mock_league(text,integer) to authenticated,service_role;

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
  v_scale numeric;
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
  v_scale:=case when r.duration_minutes<=5 then 7 else 1 end;

  if r.duration_minutes<=5 then
    update public.simulation_player_stats s
    set
      cs=cs+greatest(20,round((5+floor(random()*7))*v_scale)::integer),
      kills=kills+floor(random()*3.5)::integer,
      deaths=deaths+floor(random()*3.0)::integer,
      assists=assists+floor(random()*5.5)::integer,
      updated_at=now()
    where s.run_id=r.id;
  else
    update public.simulation_player_stats s
    set
      cs=cs+(5+floor(random()*7))::integer,
      kills=kills+(case when random()<0.18 then 1 else 0 end),
      deaths=deaths+(case when random()<0.14 then 1 else 0 end),
      assists=assists+(case when random()<0.34 then 1 else 0 end),
      updated_at=now()
    where s.run_id=r.id;
  end if;

  if v_target >= (case when r.duration_minutes<=5 then 1 else 3 end)
     and not exists(
       select 1 from public.simulation_player_stats where run_id=r.id and first_blood
     )
  then
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

  select
    coalesce(sum(fgs.fantasy_points) filter(
      where s.manager_id=lm.home_manager_id and s.manager_type=lm.home_manager_type
    ),0),
    coalesce(sum(fgs.fantasy_points) filter(
      where s.manager_id=lm.away_manager_id and s.manager_type=lm.away_manager_type
    ),0)
  into v_home,v_away
  from public.league_matchups lm
  cross join public.simulation_player_stats s
  join public.fantasy_game_scores fgs
    on fgs.league_id=r.league_id
   and fgs.game_id=r.game_id
   and fgs.player_id=s.player_id
  where lm.league_id=r.league_id
    and lm.round_number=1
    and lm.pair_number=1
    and s.run_id=r.id
  group by lm.home_manager_id,lm.home_manager_type,lm.away_manager_id,lm.away_manager_type;

  v_home:=coalesce(v_home,0);
  v_away:=coalesce(v_away,0);

  if v_final then
    v_winner:=case
      when v_home>v_away then
        (select home_manager_id from public.league_matchups where league_id=r.league_id and round_number=1 and pair_number=1)
      when v_away>v_home then
        (select away_manager_id from public.league_matchups where league_id=r.league_id and round_number=1 and pair_number=1)
      else null
    end;

    update public.league_matchups
    set home_score=round(v_home,2),away_score=round(v_away,2),
        result=case
          when v_home>v_away then 'home_win'
          when v_away>v_home then 'away_win'
          else 'tie'
        end,
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

revoke all on function public.advance_mock_simulation(uuid) from public,anon,authenticated;
grant execute on function public.advance_mock_simulation(uuid) to service_role;
