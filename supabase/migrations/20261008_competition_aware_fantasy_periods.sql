-- Competition-aware fantasy periods built from the selected pro competition schedule.

alter table public.fantasy_rounds
  add column if not exists competition text,
  add column if not exists stage text,
  add column if not exists label text,
  add column if not exists match_count integer not null default 0,
  add column if not exists period_source text not null default 'schedule';

create or replace function public.rebuild_competition_rounds(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_competition text;
  v_draft_completed timestamptz;
  v_finalized_count integer;
  v_created integer:=0;
begin
  select public.league_competition_code(p_league_id),d.updated_at
  into v_competition,v_draft_completed
  from public.league_drafts d
  where d.league_id=p_league_id and d.status='complete';

  if v_competition is null or v_draft_completed is null then return 0; end if;

  select count(*) into v_finalized_count
  from public.fantasy_rounds
  where league_id=p_league_id and status='final';

  delete from public.league_matchups lm
  using public.fantasy_rounds fr
  where lm.league_id=p_league_id
    and fr.league_id=lm.league_id
    and fr.round_number=lm.round_number
    and fr.status<>'final';

  delete from public.fantasy_rounds
  where league_id=p_league_id and status<>'final';

  with eligible as (
    select pm.id,pm.start_time,nullif(trim(pm.stage),'') stage,
      lag(pm.start_time) over(order by pm.start_time,pm.id) prev_start,
      lag(nullif(trim(pm.stage),'')) over(order by pm.start_time,pm.id) prev_stage
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=v_competition
      and pm.start_time>=v_draft_completed
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
  ),
  marked as (
    select *,
      case
        when prev_start is null then 1
        when coalesce(stage,'') is distinct from coalesce(prev_stage,'') then 1
        when start_time-prev_start>interval '48 hours' then 1
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
    select grp,min(start_time) first_match,max(start_time) last_match,
           min(stage) stage,count(*)::integer match_count
    from grouped
    group by grp
  ),
  bounded as (
    select *,lead(first_match) over(order by first_match) next_period_start
    from periods
  ),
  numbered as (
    select row_number() over(order by first_match)::integer+v_finalized_count round_number,
           greatest(first_match,v_draft_completed) starts_at,
           coalesce(next_period_start,last_match+interval '12 hours') ends_at,
           stage,match_count
    from bounded
  )
  insert into public.fantasy_rounds(
    league_id,round_number,starts_at,ends_at,status,
    competition,stage,label,match_count,period_source,created_at,updated_at
  )
  select p_league_id,n.round_number,n.starts_at,n.ends_at,
    case
      when now()<n.starts_at then 'upcoming'
      when now()>=n.ends_at then 'final'
      else 'live'
    end,
    v_competition,n.stage,
    coalesce(n.stage,'Competition')||' · Round '||n.round_number,
    n.match_count,'pro_schedule',now(),now()
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
    updated_at=now();

  get diagnostics v_created=row_count;
  return v_created;
end;
$$;

revoke all on function public.rebuild_competition_rounds(uuid) from public,anon,authenticated;
grant execute on function public.rebuild_competition_rounds(uuid) to service_role;

create or replace function public.ensure_league_matchups(p_league_id uuid,p_rounds integer default 52)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_ids uuid[]; v_types text[]; v_count integer; r record;
  v_cycle integer; v_pair integer; v_a_idx integer; v_b_idx integer;
  v_a uuid; v_b uuid; v_a_type text; v_b_type text; v_created integer:=0;
begin
  select array_agg(manager_id order by sort_order,joined_at,manager_id),
         array_agg(manager_type order by sort_order,joined_at,manager_id)
  into v_ids,v_types
  from (
    select lm.user_id manager_id,'human'::text manager_type,0 sort_order,lm.joined_at
    from public.league_members lm where lm.league_id=p_league_id
    union all
    select lb.id,'bot'::text,1,lb.created_at
    from public.league_bots lb where lb.league_id=p_league_id
  ) managers;

  v_count:=coalesce(array_length(v_ids,1),0);
  if v_count<2 then return 0; end if;

  if mod(v_count,2)=1 then
    v_ids:=array_append(v_ids,null::uuid);
    v_types:=array_append(v_types,null::text);
    v_count:=v_count+1;
  end if;

  for r in
    select round_number,starts_at,ends_at,status
    from public.fantasy_rounds
    where league_id=p_league_id
    order by round_number
    limit greatest(1,least(p_rounds,52))
  loop
    v_cycle:=mod(r.round_number-1,v_count-1);

    for v_pair in 1..(v_count/2) loop
      if v_pair=1 then
        v_a_idx:=v_count; v_b_idx:=v_cycle+1;
      else
        v_a_idx:=mod(v_cycle+(v_pair-1),v_count-1)+1;
        v_b_idx:=mod(v_cycle-(v_pair-1)+(v_count-1)*4,v_count-1)+1;
      end if;

      v_a:=v_ids[v_a_idx]; v_b:=v_ids[v_b_idx];
      v_a_type:=v_types[v_a_idx]; v_b_type:=v_types[v_b_idx];

      insert into public.league_matchups(
        league_id,round_number,pair_number,
        home_manager_id,home_manager_type,away_manager_id,away_manager_type,
        result,updated_at
      )
      values(
        p_league_id,r.round_number,v_pair,v_a,v_a_type,v_b,v_b_type,
        case
          when v_a is null or v_b is null then 'bye'
          when r.status='upcoming' then 'upcoming'
          when r.status='live' then 'live'
          else 'tie'
        end,
        now()
      )
      on conflict (league_id,round_number,pair_number) do update set
        home_manager_id=excluded.home_manager_id,
        home_manager_type=excluded.home_manager_type,
        away_manager_id=excluded.away_manager_id,
        away_manager_type=excluded.away_manager_type,
        result=case when league_matchups.finalized_at is not null then league_matchups.result else excluded.result end,
        updated_at=now();

      v_created:=v_created+1;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.ensure_league_matchups(uuid,integer) from public,anon,authenticated;
grant execute on function public.ensure_league_matchups(uuid,integer) to service_role;

create or replace function public.refresh_competition_calendars()
returns integer
language plpgsql
set search_path=public
as $$
declare l record; v_count integer:=0;
begin
  for l in
    select distinct d.league_id
    from public.league_drafts d
    join public.leagues le on le.id=d.league_id
    where d.status='complete' and le.status='active'
  loop
    perform public.rebuild_competition_rounds(l.league_id);
    perform public.ensure_league_matchups(l.league_id,52);
    perform public.refresh_league_matchups(l.league_id);
    perform public.refresh_league_standings(l.league_id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.refresh_competition_calendars() from public,anon,authenticated;
grant execute on function public.refresh_competition_calendars() to service_role;

create or replace function public.create_matchups_after_draft()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status='complete' and old.status is distinct from new.status then
    perform public.rebuild_competition_rounds(new.league_id);
    perform public.ensure_league_matchups(new.league_id,52);
    perform public.refresh_league_matchups(new.league_id);
    perform public.refresh_league_standings(new.league_id);
  end if;
  return new;
end;
$$;

create or replace function public.refresh_competition_calendars_after_schedule_change()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  perform public.refresh_competition_calendars();
  return null;
end;
$$;

drop trigger if exists refresh_fantasy_periods_on_pro_schedule on public.pro_matches;
create trigger refresh_fantasy_periods_on_pro_schedule
after insert or update of competition,stage,start_time,status
on public.pro_matches
for each statement
execute function public.refresh_competition_calendars_after_schedule_change();

do $$
begin
  if exists(select 1 from cron.job where jobname='refresh-competition-calendars') then
    perform cron.unschedule('refresh-competition-calendars');
  end if;
end $$;

select cron.schedule(
  'refresh-competition-calendars',
  '17 * * * *',
  $$select public.refresh_competition_calendars();$$
);

select public.refresh_competition_calendars();