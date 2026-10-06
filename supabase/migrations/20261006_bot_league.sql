-- Bot League foundation
-- Adds virtual managers without creating fake auth users.

create table if not exists public.league_bots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_name text not null,
  difficulty text not null default 'competitive' check (difficulty in ('casual','competitive','expert')),
  created_at timestamptz not null default now(),
  unique (league_id,team_name)
);

alter table public.league_bots enable row level security;
drop policy if exists "members read league bots" on public.league_bots;
create policy "members read league bots" on public.league_bots
  for select to authenticated using (public.is_league_member(league_id));

alter table public.draft_picks drop constraint if exists draft_picks_user_id_fkey;
alter table public.rosters drop constraint if exists rosters_user_id_fkey;

alter table public.draft_picks
  add column if not exists manager_type text not null default 'human'
  check (manager_type in ('human','bot'));

alter table public.rosters
  add column if not exists manager_type text not null default 'human'
  check (manager_type in ('human','bot'));

create or replace function public.create_bot_league(
  p_name text,
  p_team_name text,
  p_total_managers integer,
  p_human_managers integer,
  p_difficulty text,
  p_settings jsonb default '{}'::jsonb
)
returns public.leagues
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.leagues;
  bot_count integer;
  i integer;
  merged_settings jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;
  if p_total_managers not between 1 and 10 then raise exception 'League size must be between 1 and 10'; end if;
  if p_human_managers not between 1 and p_total_managers then raise exception 'Human managers must be between 1 and league size'; end if;
  if p_difficulty not in ('casual','competitive','expert') then raise exception 'Invalid bot difficulty'; end if;

  bot_count:=p_total_managers-p_human_managers;
  merged_settings:=coalesce(p_settings,'{}'::jsonb) || jsonb_build_object(
    'managers',p_total_managers,
    'humanManagers',p_human_managers,
    'botManagers',bot_count,
    'botLeague',true,
    'botDifficulty',p_difficulty,
    'autoBotLineups',true
  );

  insert into public.leagues(owner_id,name,invite_code,settings)
  values(auth.uid(),left(trim(p_name),40),public.new_invite_code(),merged_settings)
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner',left(trim(p_team_name),40));

  for i in 1..bot_count loop
    insert into public.league_bots(league_id,team_name,difficulty)
    values(result.id,'Bot Manager '||i,p_difficulty);
  end loop;

  return result;
end;
$$;

create or replace function public.join_league(p_invite_code text,p_team_name text default 'My Team')
returns public.league_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  result public.league_members;
  league_settings jsonb;
  human_limit integer;
  human_count integer;
  manager_limit integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;

  select id,settings into target,league_settings
  from public.leagues
  where invite_code=upper(trim(p_invite_code));

  if target is null then raise exception 'Invalid invite code'; end if;

  select count(*) into human_count
  from public.league_members where league_id=target;

  manager_limit:=coalesce(nullif(league_settings->>'managers','')::integer,10);

  if coalesce((league_settings->>'botLeague')::boolean,false) then
    human_limit:=coalesce(nullif(league_settings->>'humanManagers','')::integer,1);
    if human_count>=human_limit then
      raise exception 'This Bot League has no open human manager slots';
    end if;
  elsif human_count>=manager_limit then
    raise exception 'League is full';
  end if;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(target,auth.uid(),'manager',left(trim(p_team_name),40))
  on conflict (league_id,user_id) do update set team_name=excluded.team_name
  returning * into result;

  return result;
end;
$$;

create or replace function public.start_league_draft(p_league_id uuid)
returns public.league_drafts
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.league_drafts;
  expected_count integer;
  actual_count integer;
  rounds integer;
  ordering uuid[];
  active_player_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.leagues
    where id=p_league_id and owner_id=auth.uid() and status='pre_draft'
  ) then
    raise exception 'Only the commissioner can start a pre-draft league';
  end if;

  select coalesce(nullif(settings->>'managers','')::integer,4),
         6 + coalesce(nullif(settings->>'bench','')::integer,1)
    into expected_count,rounds
    from public.leagues where id=p_league_id;

  select
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
    into actual_count;

  if actual_count<>expected_count then
    raise exception 'League needs % managers before drafting; currently has %',expected_count,actual_count;
  end if;

  select count(*) into active_player_count from public.fantasy_players where active;
  if active_player_count < expected_count*rounds then
    raise exception 'Not enough active fantasy players to fill every roster';
  end if;

  select array_agg(manager_id order by sort_order,manager_id) into ordering
  from (
    select user_id as manager_id, 0 as sort_order, joined_at
      from public.league_members where league_id=p_league_id
    union all
    select id as manager_id, 1 as sort_order, created_at
      from public.league_bots where league_id=p_league_id
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
$$;

create or replace function public.make_draft_pick(p_league_id uuid,p_player_id text,p_role text)
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_player_id),'') is null then raise exception 'Player is required'; end if;
  if p_role not in ('TOP','JNG','MID','ADC','SUP') then raise exception 'Invalid player role'; end if;

  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;

  manager_count:=array_length(d.manager_order,1);
  round_idx:=d.current_pick / manager_count;
  within_round:=d.current_pick % manager_count;
  manager_pos:=case when mod(round_idx,2)=0 then within_round+1 else manager_count-within_round end;
  expected_manager:=d.manager_order[manager_pos];

  if exists(select 1 from public.league_bots where league_id=p_league_id and id=expected_manager) then
    raise exception 'A bot manager is on the clock';
  end if;
  if expected_manager<>auth.uid() then raise exception 'It is not your turn'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_player_id) then
    raise exception 'Player has already been drafted';
  end if;

  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,manager_type,player_id,role)
  values(p_league_id,next_pick,round_idx+1,auth.uid(),'human',left(trim(p_player_id),100),p_role)
  returning * into result;

  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts
     set current_pick=next_pick,
         status=case when next_pick>=total_picks then 'complete' else 'drafting' end,
         updated_at=now()
   where league_id=p_league_id;

  if next_pick>=total_picks then
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;

  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;

  manager_count:=array_length(d.manager_order,1);
  round_idx:=d.current_pick / manager_count;
  within_round:=d.current_pick % manager_count;
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
    and (needed_role is null or fp.role=needed_role)
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
      and not exists(
        select 1 from public.draft_picks p
        where p.league_id=p_league_id and p.player_id=fp.id
      )
    order by random()
    limit 1;
  end if;

  if picked_player.id is null then raise exception 'No draftable players remain'; end if;

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

revoke all on function public.create_bot_league(text,text,integer,integer,text,jsonb) from public,anon;
revoke all on function public.make_bot_draft_pick(uuid) from public,anon;
grant execute on function public.create_bot_league(text,text,integer,integer,text,jsonb) to authenticated;
grant execute on function public.make_bot_draft_pick(uuid) to authenticated;
grant select on public.league_bots to authenticated;
