CREATE OR REPLACE FUNCTION public.refresh_league_matchups(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  m record;
  v_home numeric;
  v_away numeric;
  v_result text;
  v_winner uuid;
  v_ready boolean;
  v_count integer:=0;
begin
  perform public.lock_due_fantasy_lineups(p_league_id);

  update public.fantasy_rounds fr
  set status=case
      when fr.status='final' then 'final'
      when now()<fr.starts_at then 'upcoming'
      when public.round_scoring_ready(fr.league_id,fr.round_number) then 'final'
      else 'live'
    end,
    updated_at=now()
  where fr.league_id=p_league_id;

  insert into public.data_anomalies(severity,category,entity_type,entity_id,league_id,details)
  select
    case when now()-fr.ends_at>=interval '6 hours' then 'critical' else 'warning' end,
    'round_scoring_delayed',
    'fantasy_round',
    fr.league_id::text||':'||fr.round_number::text,
    fr.league_id,
    jsonb_build_object(
      'round_number',fr.round_number,
      'scheduled_end',fr.ends_at,
      'delay_minutes',floor(extract(epoch from (now()-fr.ends_at))/60)
    )
  from public.fantasy_rounds fr
  where fr.league_id=p_league_id
    and fr.status<>'final'
    and now()>=fr.ends_at+interval '30 minutes'
    and not public.round_scoring_ready(fr.league_id,fr.round_number)
    and not exists(
      select 1 from public.data_anomalies da
      where da.category='round_scoring_delayed'
        and da.entity_type='fantasy_round'
        and da.entity_id=fr.league_id::text||':'||fr.round_number::text
        and da.status='open'
    );

  update public.data_anomalies da
  set status='resolved',resolved_at=now()
  from public.fantasy_rounds fr
  where da.category='round_scoring_delayed'
    and da.entity_type='fantasy_round'
    and da.status='open'
    and da.entity_id=fr.league_id::text||':'||fr.round_number::text
    and fr.league_id=p_league_id
    and public.round_scoring_ready(fr.league_id,fr.round_number);

  for m in
    select lm.*,fr.starts_at,fr.ends_at,fr.status round_status
    from public.league_matchups lm
    join public.fantasy_rounds fr
      on fr.league_id=lm.league_id and fr.round_number=lm.round_number
    where lm.league_id=p_league_id
  loop
    v_ready:=m.finalized_at is not null or public.round_scoring_ready(p_league_id,m.round_number);

    if m.home_manager_id is null or m.away_manager_id is null then
      update public.league_matchups
      set home_score=0,away_score=0,result='bye',
          winner_manager_id=coalesce(m.home_manager_id,m.away_manager_id),
          finalized_at=case when v_ready then coalesce(finalized_at,now()) else finalized_at end,
          updated_at=now()
      where id=m.id;
      v_count:=v_count+1;
      continue;
    end if;

    v_home:=public.manager_round_score(
      p_league_id,m.round_number,m.home_manager_id,m.home_manager_type
    );
    v_away:=public.manager_round_score(
      p_league_id,m.round_number,m.away_manager_id,m.away_manager_type
    );

    if now()<m.starts_at then
      v_result:='upcoming'; v_winner:=null;
    elsif not v_ready then
      v_result:='live'; v_winner:=null;
    elsif v_home>v_away then
      v_result:='home_win'; v_winner:=m.home_manager_id;
    elsif v_away>v_home then
      v_result:='away_win'; v_winner:=m.away_manager_id;
    else
      v_result:='tie'; v_winner:=null;
    end if;

    update public.league_matchups
    set home_score=round(v_home,2),
        away_score=round(v_away,2),
        result=v_result,
        winner_manager_id=v_winner,
        finalized_at=case when v_ready then coalesce(finalized_at,now()) else null end,
        updated_at=now()
    where id=m.id;

    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_playoffs(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  p record;
  fr record;
  v_home numeric;
  v_away numeric;
  v_winner uuid;
  v_winner_type text;
  v_winner_seed integer;
  v_ready boolean;
  v_updates integer:=0;
  sf1 record;
  sf2 record;
begin
  perform public.ensure_playoff_bracket(p_league_id);
  perform public.lock_due_fantasy_lineups(p_league_id);

  for p in
    select * from public.fantasy_playoffs
    where league_id=p_league_id and stage='semifinal'
    order by bracket_slot
  loop
    select * into fr from public.fantasy_rounds
    where league_id=p_league_id and round_number=p.round_number;

    v_home:=public.manager_round_score(p_league_id,p.round_number,p.home_manager_id,p.home_manager_type);
    v_away:=public.manager_round_score(p_league_id,p.round_number,p.away_manager_id,p.away_manager_type);
    v_ready:=p.status='final' or public.round_scoring_ready(p_league_id,p.round_number);

    if now()<fr.starts_at then
      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,status='upcoming',updated_at=now()
      where id=p.id;
    elsif not v_ready then
      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,status='live',updated_at=now()
      where id=p.id;
    else
      if v_home>v_away or (v_home=v_away and p.home_seed<p.away_seed) then
        v_winner:=p.home_manager_id; v_winner_type:=p.home_manager_type; v_winner_seed:=p.home_seed;
      else
        v_winner:=p.away_manager_id; v_winner_type:=p.away_manager_type; v_winner_seed:=p.away_seed;
      end if;
      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,winner_manager_id=v_winner,status='final',
          finalized_at=coalesce(finalized_at,now()),updated_at=now()
      where id=p.id;
    end if;
    v_updates:=v_updates+1;
  end loop;

  select * into sf1 from public.fantasy_playoffs
  where league_id=p_league_id and stage='semifinal' and bracket_slot=1;
  select * into sf2 from public.fantasy_playoffs
  where league_id=p_league_id and stage='semifinal' and bracket_slot=2;

  if sf1.status='final' and sf2.status='final' then
    update public.fantasy_playoffs c
    set home_manager_id=sf1.winner_manager_id,
        home_manager_type=case when sf1.winner_manager_id=sf1.home_manager_id then sf1.home_manager_type else sf1.away_manager_type end,
        home_seed=case when sf1.winner_manager_id=sf1.home_manager_id then sf1.home_seed else sf1.away_seed end,
        away_manager_id=sf2.winner_manager_id,
        away_manager_type=case when sf2.winner_manager_id=sf2.home_manager_id then sf2.home_manager_type else sf2.away_manager_type end,
        away_seed=case when sf2.winner_manager_id=sf2.home_manager_id then sf2.home_seed else sf2.away_seed end,
        updated_at=now()
    where c.league_id=p_league_id
      and c.stage='championship'
      and c.bracket_slot=1
      and c.status<>'final';
  end if;

  for p in
    select * from public.fantasy_playoffs
    where league_id=p_league_id and stage='championship'
      and home_manager_id is not null and away_manager_id is not null
  loop
    select * into fr from public.fantasy_rounds
    where league_id=p_league_id and round_number=p.round_number;

    v_home:=public.manager_round_score(p_league_id,p.round_number,p.home_manager_id,p.home_manager_type);
    v_away:=public.manager_round_score(p_league_id,p.round_number,p.away_manager_id,p.away_manager_type);
    v_ready:=p.status='final' or public.round_scoring_ready(p_league_id,p.round_number);

    if now()<fr.starts_at then
      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,status='upcoming',updated_at=now()
      where id=p.id;
    elsif not v_ready then
      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,status='live',updated_at=now()
      where id=p.id;
    else
      if v_home>v_away or (v_home=v_away and p.home_seed<p.away_seed) then
        v_winner:=p.home_manager_id; v_winner_type:=p.home_manager_type; v_winner_seed:=p.home_seed;
      else
        v_winner:=p.away_manager_id; v_winner_type:=p.away_manager_type; v_winner_seed:=p.away_seed;
      end if;

      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,winner_manager_id=v_winner,status='final',
          finalized_at=coalesce(finalized_at,now()),updated_at=now()
      where id=p.id;

      insert into public.league_champions(
        league_id,manager_id,manager_type,seed,championship_score,runner_up_manager_id,finalized_at
      )
      values(
        p_league_id,v_winner,v_winner_type,v_winner_seed,
        case when v_winner=p.home_manager_id then v_home else v_away end,
        case when v_winner=p.home_manager_id then p.away_manager_id else p.home_manager_id end,
        now()
      )
      on conflict (league_id) do update set
        manager_id=excluded.manager_id,
        manager_type=excluded.manager_type,
        seed=excluded.seed,
        championship_score=excluded.championship_score,
        runner_up_manager_id=excluded.runner_up_manager_id,
        finalized_at=excluded.finalized_at;
    end if;

    v_updates:=v_updates+1;
  end loop;

  return v_updates;
end;
$function$;

CREATE OR REPLACE FUNCTION public.round_scoring_ready(p_league_id uuid, p_round_number integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  fr public.fantasy_rounds;
  v_competition text;
begin
  select * into fr
  from public.fantasy_rounds
  where league_id=p_league_id and round_number=p_round_number;

  if fr.league_id is null or now()<fr.ends_at then
    return false;
  end if;

  v_competition:=public.league_competition_code(p_league_id);

  if exists(
    select 1
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=v_competition
      and pm.start_time>=fr.starts_at
      and pm.start_time<fr.ends_at
      and upper(coalesce(pm.status,'')) not in ('COMPLETED','CANCELED','CANCELLED','POSTPONED')
  ) then
    return false;
  end if;

  if exists(
    select 1
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=v_competition
      and pm.start_time>=fr.starts_at
      and pm.start_time<fr.ends_at
      and upper(coalesce(pm.status,''))='COMPLETED'
      and not exists(
        select 1 from public.pro_games pg where pg.match_id=pm.id
      )
  ) then
    return false;
  end if;

  if exists(
    select 1
    from public.pro_games pg
    join public.pro_matches pm on pm.id=pg.match_id
    where public.normalize_competition_code(pm.competition)=v_competition
      and pm.start_time>=fr.starts_at
      and pm.start_time<fr.ends_at
      and upper(coalesce(pm.status,''))='COMPLETED'
      and (
        pg.stats_status<>'final'
        or lower(coalesce(pg.state,'')) not in ('completed','unneeded','final')
      )
  ) then
    return false;
  end if;

  if exists(
    select 1
    from public.player_game_stats pgs
    join public.pro_matches pm on pm.id=pgs.match_id
    where public.normalize_competition_code(pm.competition)=v_competition
      and pm.start_time>=fr.starts_at
      and pm.start_time<fr.ends_at
      and upper(coalesce(pm.status,''))='COMPLETED'
      and pgs.finalized=false
  ) then
    return false;
  end if;

  if exists(
    select 1
    from public.fantasy_game_scores fgs
    join public.pro_matches pm on pm.id=fgs.match_id
    where fgs.league_id=p_league_id
      and pm.start_time>=fr.starts_at
      and pm.start_time<fr.ends_at
      and upper(coalesce(pm.status,''))='COMPLETED'
      and fgs.finalized=false
  ) then
    return false;
  end if;

  return true;
end;
$function$;
revoke all on function public.round_scoring_ready(uuid,integer) from public,anon,authenticated;
grant execute on function public.round_scoring_ready(uuid,integer) to service_role;
revoke all on function public.refresh_league_matchups(uuid) from public,anon,authenticated;
grant execute on function public.refresh_league_matchups(uuid) to service_role;
revoke all on function public.refresh_playoffs(uuid) from public,anon,authenticated;
grant execute on function public.refresh_playoffs(uuid) to service_role;
