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
  simulation_mode boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.leagues
    where id=p_league_id and owner_id=auth.uid() and status='pre_draft'
  ) then raise exception 'Only the commissioner can start a pre-draft league'; end if;

  select coalesce(nullif(settings->>'managers','')::integer,4),
         coalesce(nullif(settings->>'bench','')::integer,1),
         6+coalesce(nullif(settings->>'bench','')::integer,1),
         coalesce(public.normalize_competition_code(settings->>'competition'),'worlds'),
         coalesce((settings->>'simulation')::boolean,false)
  into expected_count,bench_count,rounds,competition_code,simulation_mode
  from public.leagues where id=p_league_id;

  if simulation_mode then
    select floor(count(*)::numeric/nullif(rounds,0))::integer into max_managers
    from public.list_mock_draft_pool(p_league_id);
  else
    max_managers:=public.competition_manager_capacity(competition_code,bench_count);
  end if;
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

  if simulation_mode then
    select count(*) into eligible_player_count
    from public.list_mock_draft_pool(p_league_id);
  else
    select count(*) into eligible_player_count
    from public.fantasy_players fp
    where fp.active
      and fp.draftable
      and fp.competitions @> array[competition_code]::text[]
      and public.player_is_competition_available(fp.id,competition_code);
  end if;

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

CREATE OR REPLACE FUNCTION public.make_draft_pick(p_league_id uuid, p_player_id text, p_role text)
 RETURNS draft_picks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.league_drafts;
  result public.draft_picks;
  manager_count integer;
  round_idx integer;
  within_round integer;
  manager_pos integer;
  expected_manager uuid;
  next_pick integer;
  total_picks integer;
  actual_role text;
  simulation_mode boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_player_id),'') is null then raise exception 'Player is required'; end if;

  select coalesce((settings->>'simulation')::boolean,false)
  into simulation_mode
  from public.leagues where id=p_league_id;

  select fp.role into actual_role
  from public.fantasy_players fp
  where fp.id=p_player_id
    and fp.active
    and fp.draftable
    and (
      (
        simulation_mode
        and public.player_is_mock_competition_eligible(
          p_player_id,
          public.league_competition_code(p_league_id)
        )
      )
      or (
        not simulation_mode
        and fp.competitions @> array[public.league_competition_code(p_league_id)]::text[]
        and public.player_is_competition_available(
          p_player_id,
          public.league_competition_code(p_league_id)
        )
      )
    );

  if actual_role is null then raise exception 'Player is not currently draftable for this league competition'; end if;
  if p_role<>actual_role then raise exception 'Player role does not match the official fantasy roster'; end if;

  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;

  manager_count:=array_length(d.manager_order,1);
  round_idx:=d.current_pick/manager_count;
  within_round:=d.current_pick%manager_count;
  manager_pos:=case when mod(round_idx,2)=0 then within_round+1 else manager_count-within_round end;
  expected_manager:=d.manager_order[manager_pos];

  if exists(select 1 from public.league_bots where league_id=p_league_id and id=expected_manager)
    then raise exception 'A bot manager is on the clock'; end if;
  if expected_manager<>auth.uid() then raise exception 'It is not your turn'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_player_id)
    then raise exception 'Player has already been drafted'; end if;

  if simulation_mode and exists(
    select 1
    from public.draft_picks dp
    join public.fantasy_players drafted on drafted.id=dp.player_id
    join public.fantasy_players candidate on candidate.id=p_player_id
    where dp.league_id=p_league_id
      and lower(drafted.name)=lower(candidate.name)
      and drafted.role=candidate.role
      and lower(regexp_replace(coalesce(drafted.team,''),'[^a-zA-Z0-9]+','','g'))
          =lower(regexp_replace(coalesce(candidate.team,''),'[^a-zA-Z0-9]+','','g'))
  ) then
    raise exception 'Player has already been drafted';
  end if;

  if not private.draft_pick_preserves_required_roles(
    p_league_id,auth.uid(),actual_role,d.total_rounds
  ) then
    raise exception 'Draft a missing starting position now so your final roster can fill TOP, JNG, MID, ADC, and SUP';
  end if;

  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,manager_type,player_id,role)
  values(p_league_id,next_pick,round_idx+1,auth.uid(),'human',p_player_id,actual_role)
  returning * into result;

  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts
    set current_pick=next_pick,
        status=case when next_pick>=total_picks then 'complete' else 'drafting' end,
        updated_at=now()
  where league_id=p_league_id;

  if next_pick>=total_picks then
    if exists(
      select 1
      from (
        select m.manager_id,r.role
        from (
          select unnest(d.manager_order) manager_id
        ) m
        cross join (values('TOP'),('JNG'),('MID'),('ADC'),('SUP')) r(role)
      ) req
      where not exists(
        select 1 from public.draft_picks dp
        where dp.league_id=p_league_id
          and dp.user_id=req.manager_id
          and dp.role=req.role
      )
    ) then
      raise exception 'Draft cannot complete because at least one manager is missing a required starting position';
    end if;

    delete from public.rosters where league_id=p_league_id;
    insert into public.rosters(league_id,user_id,manager_type,player_id,slot)
    select league_id,user_id,manager_type,player_id,
      case when row_number() over(partition by user_id,role order by pick_number)=1 then role else 'BN' end
    from public.draft_picks where league_id=p_league_id;
    update public.leagues set status='active' where id=p_league_id;
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.make_bot_draft_pick(p_league_id uuid)
 RETURNS draft_picks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.league_drafts;
  result public.draft_picks;
  manager_count integer;
  round_idx integer;
  within_round integer;
  manager_pos integer;
  bot_id uuid;
  bot_difficulty text;
  next_pick integer;
  total_picks integer;
  picked_player public.fantasy_players;
  needed_role text;
  competition_code text;
  simulation_mode boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;

  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;
  competition_code:=public.league_competition_code(p_league_id);
  select coalesce((settings->>'simulation')::boolean,false)
  into simulation_mode
  from public.leagues where id=p_league_id;

  manager_count:=array_length(d.manager_order,1);
  round_idx:=d.current_pick/manager_count;
  within_round:=d.current_pick%manager_count;
  manager_pos:=case when mod(round_idx,2)=0 then within_round+1 else manager_count-within_round end;
  bot_id:=d.manager_order[manager_pos];

  select difficulty into bot_difficulty
  from public.league_bots where league_id=p_league_id and id=bot_id;
  if bot_difficulty is null then raise exception 'A human manager is on the clock'; end if;

  select role into needed_role
  from (values ('TOP',1),('JNG',2),('MID',3),('ADC',4),('SUP',5)) r(role,ord)
  where not exists(
    select 1 from public.draft_picks p
    where p.league_id=p_league_id and p.user_id=bot_id and p.role=r.role
  )
  order by ord
  limit 1;

  if bot_difficulty='casual' then needed_role:=null; end if;

  if simulation_mode then
    select fp.* into picked_player
    from public.list_mock_draft_pool(p_league_id) pool
    join public.fantasy_players fp on fp.id=pool.id
    where (needed_role is null or fp.role=needed_role)
      and private.draft_pick_preserves_required_roles(p_league_id,bot_id,fp.role,d.total_rounds)
      and not exists(
        select 1
        from public.draft_picks p
        join public.fantasy_players drafted on drafted.id=p.player_id
        where p.league_id=p_league_id
          and lower(drafted.name)=lower(fp.name)
          and drafted.role=fp.role
          and lower(regexp_replace(coalesce(drafted.team,''),'[^a-zA-Z0-9]+','','g'))
              =lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g'))
      )
    order by random()
    limit 1;
  else
    select fp.* into picked_player
    from public.fantasy_players fp
    where fp.active
      and fp.draftable
      and fp.competitions @> array[competition_code]::text[]
      and public.player_is_competition_available(fp.id,competition_code)
      and (needed_role is null or fp.role=needed_role)
      and private.draft_pick_preserves_required_roles(p_league_id,bot_id,fp.role,d.total_rounds)
      and not exists(
        select 1 from public.draft_picks p
        where p.league_id=p_league_id and p.player_id=fp.id
      )
    order by random()
    limit 1;
  end if;

  if picked_player.id is null then
    if simulation_mode then
      select fp.* into picked_player
      from public.list_mock_draft_pool(p_league_id) pool
      join public.fantasy_players fp on fp.id=pool.id
      where private.draft_pick_preserves_required_roles(p_league_id,bot_id,fp.role,d.total_rounds)
        and not exists(
          select 1
          from public.draft_picks p
          join public.fantasy_players drafted on drafted.id=p.player_id
          where p.league_id=p_league_id
            and lower(drafted.name)=lower(fp.name)
            and drafted.role=fp.role
            and lower(regexp_replace(coalesce(drafted.team,''),'[^a-zA-Z0-9]+','','g'))
                =lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g'))
        )
      order by random()
      limit 1;
    else
      select fp.* into picked_player
      from public.fantasy_players fp
      where fp.active
        and fp.draftable
        and fp.competitions @> array[competition_code]::text[]
        and public.player_is_competition_available(fp.id,competition_code)
        and private.draft_pick_preserves_required_roles(p_league_id,bot_id,fp.role,d.total_rounds)
        and not exists(
          select 1 from public.draft_picks p
          where p.league_id=p_league_id and p.player_id=fp.id
        )
      order by random()
      limit 1;
    end if;
  end if;

  if picked_player.id is null then
    raise exception 'No eligible draftable player can complete this manager''s required starting positions';
  end if;

  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,manager_type,player_id,role)
  values(p_league_id,next_pick,round_idx+1,bot_id,'bot',picked_player.id,picked_player.role)
  returning * into result;

  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts
    set current_pick=next_pick,
        status=case when next_pick>=total_picks then 'complete' else 'drafting' end,
        updated_at=now()
  where league_id=p_league_id;

  if next_pick>=total_picks then
    if exists(
      select 1
      from (
        select m.manager_id,r.role
        from (select unnest(d.manager_order) manager_id) m
        cross join (values('TOP'),('JNG'),('MID'),('ADC'),('SUP')) r(role)
      ) req
      where not exists(
        select 1 from public.draft_picks dp
        where dp.league_id=p_league_id
          and dp.user_id=req.manager_id
          and dp.role=req.role
      )
    ) then
      raise exception 'Draft cannot complete because at least one manager is missing a required starting position';
    end if;

    delete from public.rosters where league_id=p_league_id;
    insert into public.rosters(league_id,user_id,manager_type,player_id,slot)
    select league_id,user_id,manager_type,player_id,
      case when row_number() over(partition by user_id,role order by pick_number)=1 then role else 'BN' end
    from public.draft_picks where league_id=p_league_id;
    update public.leagues set status='active' where id=p_league_id;
  end if;

  return result;
end;
$function$;

revoke all on function public.start_league_draft(uuid) from public,anon;
grant execute on function public.start_league_draft(uuid) to authenticated,service_role;
revoke all on function public.make_draft_pick(uuid,text,text) from public,anon;
grant execute on function public.make_draft_pick(uuid,text,text) to authenticated,service_role;
revoke all on function public.make_bot_draft_pick(uuid) from public,anon;
grant execute on function public.make_bot_draft_pick(uuid) to authenticated,service_role;