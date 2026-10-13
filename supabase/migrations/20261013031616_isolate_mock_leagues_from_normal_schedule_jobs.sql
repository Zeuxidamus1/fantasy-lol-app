CREATE OR REPLACE FUNCTION public.lock_due_fantasy_lineups(p_league_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_count integer:=0;
begin
  delete from public.fantasy_lineup_locks fll
  using public.pro_matches pm
  where fll.match_id=pm.id
    and (p_league_id is null or fll.league_id=p_league_id)
    and not exists(
      select 1 from public.leagues lx
      where lx.id=fll.league_id
        and coalesce((lx.settings->>'simulation')::boolean,false)
    )
    and (
      upper(coalesce(pm.status,'')) in ('CANCELED','CANCELLED','POSTPONED')
      or pm.start_time>now()
    )
    and not exists(
      select 1
      from public.pro_games pg
      where pg.match_id=pm.id
        and (
          pg.started_at is not null
          or lower(coalesce(pg.state,'')) in ('in_progress','live','completed','final')
        )
    );

  insert into public.fantasy_lineup_locks(
    league_id,round_number,manager_id,manager_type,player_id,slot,locked_at,match_id
  )
  select r.league_id,fr.round_number,r.user_id,r.manager_type,r.player_id,r.slot,
         greatest(pm.start_time,fr.starts_at),pm.id
  from public.rosters r
  join public.leagues l on l.id=r.league_id
  join public.fantasy_players fp on fp.id=r.player_id
  join public.fantasy_rounds fr
    on fr.league_id=r.league_id
   and now()>=fr.starts_at
   and now()<fr.ends_at
  join lateral (
    select pm.id,pm.start_time
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=fr.competition
      and pm.start_time>=fr.starts_at and pm.start_time<fr.ends_at
      and pm.start_time<=now()
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
      and (
        (fp.team_id is not null and fp.team_id in (pm.team_a_id,pm.team_b_id))
        or (
          fp.team_id is null
          and lower(regexp_replace(fp.team,'[^a-zA-Z0-9]+','','g'))
            in (
              lower(regexp_replace(pm.team_a_name,'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(pm.team_b_name,'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
            )
        )
      )
    order by pm.start_time,pm.id
    limit 1
  ) pm on true
  where (p_league_id is null or r.league_id=p_league_id)
    and not coalesce((l.settings->>'simulation')::boolean,false)
  on conflict (league_id,round_number,manager_id,manager_type,player_id) do nothing;

  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_active_league_schedules()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  l record;
  v_count integer:=0;
begin
  for l in
    select id
    from public.leagues
    where status='active'
      and not coalesce((settings->>'simulation')::boolean,false)
    order by id
  loop
    perform public.rebuild_competition_rounds(l.id);
    perform public.ensure_league_matchups(l.id,52);
    perform public.refresh_league_matchups(l.id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.reconcile_active_league_schedules() from public,anon,authenticated;
grant execute on function public.reconcile_active_league_schedules() to service_role;
revoke all on function public.lock_due_fantasy_lineups(uuid) from public,anon,authenticated;
grant execute on function public.lock_due_fantasy_lineups(uuid) to service_role;
