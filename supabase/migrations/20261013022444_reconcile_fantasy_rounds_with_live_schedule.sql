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
revoke all on function public.rebuild_competition_rounds(uuid) from public,anon,authenticated;
grant execute on function public.rebuild_competition_rounds(uuid) to service_role;
revoke all on function public.reconcile_active_league_schedules() from public,anon,authenticated;
grant execute on function public.reconcile_active_league_schedules() to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='reconcile-fantasy-schedules') then
    perform cron.unschedule('reconcile-fantasy-schedules');
  end if;
end $$;

select cron.schedule(
  'reconcile-fantasy-schedules',
  '*/10 * * * *',
  $$select public.reconcile_active_league_schedules();$$
);
