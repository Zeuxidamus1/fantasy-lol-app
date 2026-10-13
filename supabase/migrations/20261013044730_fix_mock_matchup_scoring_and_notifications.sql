-- Keep Creator Lab simulations isolated from real tournament schedule reconciliation
-- and make mock matchup scoring independent of generic lineup-lock aggregation.

CREATE OR REPLACE FUNCTION public.rebuild_competition_rounds(p_league_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_competition text;
  v_draft_completed timestamptz;
  v_finalized_count integer;
  v_finalized_through timestamptz;
  v_schedule_floor timestamptz;
  v_created integer:=0;
begin
  if exists(
    select 1
    from public.leagues l
    where l.id=p_league_id
      and coalesce((l.settings->>'simulation')::boolean,false)
  ) then
    return 0;
  end if;

  select public.league_competition_code(p_league_id), d.updated_at
  into v_competition, v_draft_completed
  from public.league_drafts d
  where d.league_id=p_league_id and d.status='complete';

  if v_competition is null or v_draft_completed is null then
    return 0;
  end if;

  select count(*),max(ends_at)
  into v_finalized_count,v_finalized_through
  from public.fantasy_rounds
  where league_id=p_league_id and status='final';

  v_schedule_floor:=greatest(
    v_draft_completed,
    coalesce(v_finalized_through,v_draft_completed)
  );

  delete from public.league_matchups lm
  using public.fantasy_rounds fr
  where lm.league_id=p_league_id
    and fr.league_id=lm.league_id
    and fr.round_number=lm.round_number
    and fr.status<>'final';

  delete from public.fantasy_rounds
  where league_id=p_league_id and status<>'final';

  with eligible as (
    select
      pm.id,
      pm.start_time,
      nullif(trim(pm.stage),'') stage,
      lag(pm.start_time) over(order by pm.start_time,pm.id) prev_start,
      lag(nullif(trim(pm.stage),'')) over(order by pm.start_time,pm.id) prev_stage
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=v_competition
      and pm.start_time>=v_schedule_floor
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
  ),
  marked as (
    select *,
      case
        when prev_start is null then 1
        when coalesce(stage,'') is distinct from coalesce(prev_stage,'') then 1
        when start_time-prev_start > interval '48 hours' then 1
        else 0
      end boundary
    from eligible
  ),
  grouped as (
    select *,
      sum(boundary) over(order by start_time,id rows unbounded preceding) grp
    from marked
  ),
  periods as (
    select
      grp,
      min(start_time) first_match,
      max(start_time) last_match,
      min(stage) stage,
      count(*)::integer match_count
    from grouped
    group by grp
  ),
  bounded as (
    select *,
      lead(first_match) over(order by first_match) next_period_start
    from periods
  ),
  numbered as (
    select
      row_number() over(order by first_match)::integer + v_finalized_count round_number,
      greatest(first_match,v_draft_completed) starts_at,
      coalesce(next_period_start,last_match+interval '12 hours') ends_at,
      stage,
      match_count
    from bounded
  )
  insert into public.fantasy_rounds(
    league_id,round_number,starts_at,ends_at,status,
    competition,stage,label,match_count,period_source,is_postseason,created_at,updated_at
  )
  select
    p_league_id,
    n.round_number,
    n.starts_at,
    n.ends_at,
    case
      when now()<n.starts_at then 'upcoming'
      when now()>=n.ends_at then 'final'
      else 'live'
    end,
    v_competition,
    n.stage,
    coalesce(n.stage,'Competition')||' · Round '||n.round_number,
    n.match_count,
    'pro_schedule',
    public.round_is_postseason(public.league_fantasy_format(p_league_id),n.stage),
    now(),now()
  from numbered n
  where n.ends_at>n.starts_at
  on conflict (league_id,round_number) do update set
    starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,
    status=excluded.status,
    competition=excluded.competition,
    stage=excluded.stage,
    label=excluded.label,
    match_count=excluded.match_count,
    period_source=excluded.period_source,
    is_postseason=public.round_is_postseason(public.league_fantasy_format(p_league_id),excluded.stage),
    updated_at=now();

  get diagnostics v_created=row_count;
  return v_created;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_competition_calendars()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  l record;
  v_count integer:=0;
begin
  for l in
    select distinct d.league_id
    from public.league_drafts d
    join public.leagues le on le.id=d.league_id
    where d.status='complete'
      and le.status='active'
      and not coalesce((le.settings->>'simulation')::boolean,false)
  loop
    perform public.rebuild_competition_rounds(l.league_id);
    perform public.ensure_league_matchups(l.league_id,52);
    perform public.refresh_league_matchups(l.league_id);
    perform public.refresh_league_standings(l.league_id);
    v_count:=v_count+1;
  end loop;

  perform public.finish_completed_leagues();
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_matchups_after_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if new.status='complete' and old.status is distinct from new.status then
    if not exists(
      select 1
      from public.leagues l
      where l.id=new.league_id
        and coalesce((l.settings->>'simulation')::boolean,false)
    ) then
      perform public.rebuild_competition_rounds(new.league_id);
      perform public.ensure_league_matchups(new.league_id,52);
      perform public.refresh_league_matchups(new.league_id);
      perform public.refresh_league_standings(new.league_id);
    end if;
  end if;
  return new;
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

    update public.fantasy_rounds
    set status='final',updated_at=now()
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
