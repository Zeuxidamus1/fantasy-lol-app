CREATE OR REPLACE FUNCTION public.competition_manager_capacity(p_competition text, p_bench integer DEFAULT 1)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select public.normalize_competition_code(p_competition) as competition_code,
           greatest(0,coalesce(p_bench,1)) as bench_count
  ),
  pool as (
    select fp.role
    from public.fantasy_players fp, params p
    where fp.active
      and fp.draftable
      and fp.competitions @> array[p.competition_code]::text[]
      and public.player_is_competition_available(fp.id,p.competition_code)
  )
  select greatest(
    0,
    least(
      10,
      count(*)::integer / (6 + (select bench_count from params)),
      count(*) filter(where role='TOP'),
      count(*) filter(where role='JNG'),
      count(*) filter(where role='MID'),
      count(*) filter(where role='ADC'),
      count(*) filter(where role='SUP')
    )::integer
  )
  from pool;
$function$;

CREATE OR REPLACE FUNCTION public.start_league_draft(p_league_id uuid)
 RETURNS league_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.league_drafts;
  expected_count integer;
  actual_count integer;
  rounds integer;
  bench_count integer;
  max_managers integer;
  ordering uuid[];
  eligible_player_count integer;
  competition_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.leagues
    where id=p_league_id and owner_id=auth.uid() and status='pre_draft'
  ) then raise exception 'Only the commissioner can start a pre-draft league'; end if;

  select coalesce(nullif(settings->>'managers','')::integer,4),
         coalesce(nullif(settings->>'bench','')::integer,1),
         6+coalesce(nullif(settings->>'bench','')::integer,1),
         coalesce(public.normalize_competition_code(settings->>'competition'),'worlds')
  into expected_count,bench_count,rounds,competition_code
  from public.leagues where id=p_league_id;

  max_managers:=public.competition_manager_capacity(competition_code,bench_count);
  if max_managers<1 then
    raise exception '% is not open for fantasy drafting yet because there is no complete eligible player pool',upper(competition_code);
  end if;
  if expected_count>max_managers then
    raise exception 'This % draft currently supports up to % managers with % bench spot(s)',upper(competition_code),max_managers,bench_count;
  end if;

  select
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
  into actual_count;

  if actual_count<>expected_count then
    raise exception 'League needs % managers before drafting; currently has %',expected_count,actual_count;
  end if;

  select count(*) into eligible_player_count
  from public.fantasy_players fp
  where fp.active
    and fp.draftable
    and fp.competitions @> array[competition_code]::text[]
    and public.player_is_competition_available(fp.id,competition_code);

  if eligible_player_count<expected_count*rounds then
    raise exception 'Not enough % players to fill every roster: % eligible players for % required picks',
      upper(competition_code),eligible_player_count,expected_count*rounds;
  end if;

  select array_agg(manager_id order by sort_order,joined_at,manager_id) into ordering
  from (
    select user_id as manager_id,0 as sort_order,joined_at from public.league_members where league_id=p_league_id
    union all
    select id as manager_id,1 as sort_order,created_at as joined_at from public.league_bots where league_id=p_league_id
  ) managers;

  delete from public.draft_picks where league_id=p_league_id;

  insert into public.league_drafts(league_id,status,manager_order,current_pick,total_rounds,started_at,updated_at)
  values(p_league_id,'drafting',ordering,0,rounds,now(),now())
  on conflict (league_id) do update
    set status='drafting',manager_order=excluded.manager_order,current_pick=0,total_rounds=excluded.total_rounds,started_at=now(),updated_at=now()
  returning * into result;

  update public.leagues set status='drafting' where id=p_league_id;
  return result;
end;
$function$;
revoke all on function public.competition_manager_capacity(text,integer) from public,anon;
grant execute on function public.competition_manager_capacity(text,integer) to authenticated,service_role;
revoke all on function public.start_league_draft(uuid) from public,anon;
grant execute on function public.start_league_draft(uuid) to authenticated,service_role;
