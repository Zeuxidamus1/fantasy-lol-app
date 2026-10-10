
create or replace function private.draft_pick_preserves_required_roles(
  p_league_id uuid,
  p_manager_id uuid,
  p_candidate_role text,
  p_total_rounds integer
)
returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  with current_picks as (
    select role
    from public.draft_picks
    where league_id=p_league_id and user_id=p_manager_id
  ),
  covered as (
    select count(distinct role)::integer as n
    from (
      select role from current_picks
      union all
      select p_candidate_role
    ) x
    where role in ('TOP','JNG','MID','ADC','SUP')
  ),
  counts as (
    select
      (select count(*) from current_picks)::integer as existing_count,
      (select n from covered)::integer as covered_required
  )
  select (5-covered_required) <= greatest(0,p_total_rounds-(existing_count+1))
  from counts;
$$;

revoke all on function private.draft_pick_preserves_required_roles(uuid,uuid,text,integer)
from public,anon,authenticated;

create or replace function public.make_draft_pick(p_league_id uuid, p_player_id text, p_role text)
returns public.draft_picks
language plpgsql
security definer
set search_path=public
as $$
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_player_id),'') is null then raise exception 'Player is required'; end if;

  select role into actual_role
  from public.fantasy_players
  where id=p_player_id
    and active
    and draftable
    and competitions @> array[public.league_competition_code(p_league_id)]::text[];

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
$$;

create or replace function public.make_bot_draft_pick(p_league_id uuid)
returns public.draft_picks
language plpgsql
security definer
set search_path=public
as $$
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;

  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;
  competition_code:=public.league_competition_code(p_league_id);

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

  select fp.* into picked_player
  from public.fantasy_players fp
  where fp.active
    and fp.draftable
    and fp.competitions @> array[competition_code]::text[]
    and (needed_role is null or fp.role=needed_role)
    and private.draft_pick_preserves_required_roles(p_league_id,bot_id,fp.role,d.total_rounds)
    and not exists(
      select 1 from public.draft_picks p
      where p.league_id=p_league_id and p.player_id=fp.id
    )
  order by random()
  limit 1;

  if picked_player.id is null then
    select fp.* into picked_player
    from public.fantasy_players fp
    where fp.active
      and fp.draftable
      and fp.competitions @> array[competition_code]::text[]
      and private.draft_pick_preserves_required_roles(p_league_id,bot_id,fp.role,d.total_rounds)
      and not exists(
        select 1 from public.draft_picks p
        where p.league_id=p_league_id and p.player_id=fp.id
      )
    order by random()
    limit 1;
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
$$;
