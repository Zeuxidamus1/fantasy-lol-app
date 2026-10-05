-- Rift Fantasy Supabase schema
-- Run this once in a Supabase SQL editor for the production project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Manager',
  created_at timestamptz not null default now()
);

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner','manager')),
  team_name text not null default 'Fantasy Team' check (char_length(team_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (league_id,user_id)
);

create table if not exists public.rosters (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  slot text not null,
  created_at timestamptz not null default now(),
  primary key (league_id,user_id,player_id),
  unique (league_id,player_id)
);

create table if not exists public.waiver_claims (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  priority integer not null default 1 check (priority > 0),
  status text not null default 'pending' check (status in ('pending','won','lost','canceled')),
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  offer jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','declined','canceled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.league_members
    where league_id=p_league_id and user_id=auth.uid()
  );
$$;

create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  code text;
begin
  loop
    code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    exit when not exists(select 1 from public.leagues where invite_code=code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_league(p_name text,p_settings jsonb default '{}'::jsonb)
returns public.leagues
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.leagues;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.leagues(owner_id,name,invite_code,settings)
  values(auth.uid(),left(trim(p_name),40),public.new_invite_code(),coalesce(p_settings,'{}'::jsonb))
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner','My Team');

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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;
  select id into target from public.leagues where invite_code=upper(trim(p_invite_code));
  if target is null then raise exception 'Invalid invite code'; end if;

  if (
    select count(*) from public.league_members where league_id=target
  ) >= coalesce((
    select nullif((settings->>'managers'),'')::integer from public.leagues where id=target
  ), 12) then
    raise exception 'League is full';
  end if;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(target,auth.uid(),'manager',left(trim(p_team_name),40))
  on conflict (league_id,user_id) do update set team_name=excluded.team_name
  returning * into result;

  return result;
end;
$$;

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.rosters enable row level security;
alter table public.waiver_claims enable row level security;
alter table public.trades enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles for select using (id=auth.uid());
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles self write" on public.profiles for all using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists "league members read leagues" on public.leagues;
create policy "league members read leagues" on public.leagues for select using (owner_id=auth.uid() or public.is_league_member(id));
drop policy if exists "owners update leagues" on public.leagues;
create policy "owners update leagues" on public.leagues for update using (owner_id=auth.uid()) with check (owner_id=auth.uid());

drop policy if exists "members read membership" on public.league_members;
create policy "members read membership" on public.league_members for select using (public.is_league_member(league_id));
drop policy if exists "users update own membership" on public.league_members;
create policy "users update own membership" on public.league_members for update using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists "members read rosters" on public.rosters;
create policy "members read rosters" on public.rosters for select using (public.is_league_member(league_id));
drop policy if exists "users write own roster" on public.rosters;
create policy "users write own roster" on public.rosters for all using (user_id=auth.uid() and public.is_league_member(league_id)) with check (user_id=auth.uid() and public.is_league_member(league_id));

drop policy if exists "members read waivers" on public.waiver_claims;
create policy "members read waivers" on public.waiver_claims for select using (public.is_league_member(league_id));
drop policy if exists "users write own waivers" on public.waiver_claims;
create policy "users write own waivers" on public.waiver_claims for all using (user_id=auth.uid() and public.is_league_member(league_id)) with check (user_id=auth.uid() and public.is_league_member(league_id));

drop policy if exists "members read trades" on public.trades;
create policy "members read trades" on public.trades for select using (public.is_league_member(league_id));
drop policy if exists "users create trades" on public.trades;
create policy "users create trades" on public.trades for insert with check (from_user=auth.uid() and public.is_league_member(league_id));
drop policy if exists "trade parties update trades" on public.trades;
create policy "trade parties update trades" on public.trades for update using ((from_user=auth.uid() or to_user=auth.uid()) and public.is_league_member(league_id));

grant execute on function public.create_league(text,jsonb) to authenticated;
grant execute on function public.join_league(text,text) to authenticated;


create or replace function public.replace_roster(p_league_id uuid,p_players jsonb)
returns setof public.rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb)) <> 'array' then raise exception 'Players must be an array'; end if;
  if jsonb_array_length(coalesce(p_players,'[]'::jsonb)) > 12 then raise exception 'Roster is too large'; end if;

  -- Lock the league roster so two managers cannot claim the same player simultaneously.
  perform 1 from public.leagues where id=p_league_id for update;

  -- Validate duplicates within the submitted roster.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id'
    having count(*) > 1
  ) then
    raise exception 'Duplicate player in roster';
  end if;

  -- Validate that no submitted player belongs to another manager.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r
      on r.league_id=p_league_id
     and r.player_id=x->>'player_id'
     and r.user_id<>auth.uid()
  ) then
    raise exception 'A submitted player is already rostered by another manager';
  end if;

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();

  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb))
  loop
    insert into public.rosters(league_id,user_id,player_id,slot)
    values(
      p_league_id,
      auth.uid(),
      left(coalesce(item->>'player_id',''),100),
      left(coalesce(item->>'slot','BN'),10)
    );
  end loop;

  return query
  select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid()
  order by created_at;
end;
$$;

create or replace function public.accept_trade(p_trade_id uuid)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trades;
  send_id text;
  receive_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if t.to_user<>auth.uid() then raise exception 'Only the receiving manager can accept this trade'; end if;
  if t.status<>'pending' then raise exception 'Trade is no longer pending'; end if;

  send_id := nullif(t.offer->>'send_player_id','');
  receive_id := nullif(t.offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;

  if not exists(select 1 from public.rosters where league_id=t.league_id and user_id=t.from_user and player_id=send_id) then
    raise exception 'Offering manager no longer owns the offered player';
  end if;
  if not exists(select 1 from public.rosters where league_id=t.league_id and user_id=t.to_user and player_id=receive_id) then
    raise exception 'Receiving manager no longer owns the requested player';
  end if;

  update public.rosters set user_id=t.to_user
  where league_id=t.league_id and user_id=t.from_user and player_id=send_id;

  update public.rosters set user_id=t.from_user
  where league_id=t.league_id and user_id=t.to_user and player_id=receive_id;

  update public.trades
  set status='accepted', resolved_at=now()
  where id=t.id
  returning * into t;

  return t;
end;
$$;

grant execute on function public.replace_roster(uuid,jsonb) to authenticated;
grant execute on function public.accept_trade(uuid) to authenticated;


-- Security and performance hardening
revoke all on function public.is_league_member(uuid) from public, anon;
revoke all on function public.new_invite_code() from public, anon, authenticated;
revoke all on function public.create_league(text,jsonb) from public, anon;
revoke all on function public.join_league(text,text) from public, anon;
revoke all on function public.replace_roster(uuid,jsonb) from public, anon;
revoke all on function public.accept_trade(uuid) from public, anon;

grant execute on function public.is_league_member(uuid) to authenticated;
grant execute on function public.create_league(text,jsonb) to authenticated;
grant execute on function public.join_league(text,text) to authenticated;
grant execute on function public.replace_roster(uuid,jsonb) to authenticated;
grant execute on function public.accept_trade(uuid) to authenticated;

create index if not exists leagues_owner_id_idx on public.leagues(owner_id);
create index if not exists league_members_user_id_idx on public.league_members(user_id);
create index if not exists rosters_user_id_idx on public.rosters(user_id);
create index if not exists trades_league_id_idx on public.trades(league_id);
create index if not exists trades_from_user_idx on public.trades(from_user);
create index if not exists trades_to_user_idx on public.trades(to_user);
create index if not exists waiver_claims_league_id_idx on public.waiver_claims(league_id);
create index if not exists waiver_claims_user_id_idx on public.waiver_claims(user_id);

drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles self select" on public.profiles
  for select to authenticated using (id=(select auth.uid()));
create policy "profiles self insert" on public.profiles
  for insert to authenticated with check (id=(select auth.uid()));
create policy "profiles self update" on public.profiles
  for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy "profiles self delete" on public.profiles
  for delete to authenticated using (id=(select auth.uid()));

drop policy if exists "league members read leagues" on public.leagues;
drop policy if exists "owners update leagues" on public.leagues;
create policy "league members read leagues" on public.leagues
  for select to authenticated using (owner_id=(select auth.uid()) or public.is_league_member(id));
create policy "owners update leagues" on public.leagues
  for update to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));

drop policy if exists "members read membership" on public.league_members;
drop policy if exists "users update own membership" on public.league_members;
create policy "members read membership" on public.league_members
  for select to authenticated using (public.is_league_member(league_id));
create policy "users update own membership" on public.league_members
  for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

drop policy if exists "members read rosters" on public.rosters;
drop policy if exists "users write own roster" on public.rosters;
create policy "members read rosters" on public.rosters
  for select to authenticated using (public.is_league_member(league_id));
create policy "users insert own roster" on public.rosters
  for insert to authenticated with check (user_id=(select auth.uid()) and public.is_league_member(league_id));
create policy "users update own roster" on public.rosters
  for update to authenticated using (user_id=(select auth.uid()) and public.is_league_member(league_id))
  with check (user_id=(select auth.uid()) and public.is_league_member(league_id));
create policy "users delete own roster" on public.rosters
  for delete to authenticated using (user_id=(select auth.uid()) and public.is_league_member(league_id));

drop policy if exists "members read waivers" on public.waiver_claims;
drop policy if exists "users write own waivers" on public.waiver_claims;
create policy "members read waivers" on public.waiver_claims
  for select to authenticated using (public.is_league_member(league_id));
create policy "users insert own waivers" on public.waiver_claims
  for insert to authenticated with check (user_id=(select auth.uid()) and public.is_league_member(league_id));
create policy "users update own waivers" on public.waiver_claims
  for update to authenticated using (user_id=(select auth.uid()) and public.is_league_member(league_id))
  with check (user_id=(select auth.uid()) and public.is_league_member(league_id));
create policy "users delete own waivers" on public.waiver_claims
  for delete to authenticated using (user_id=(select auth.uid()) and public.is_league_member(league_id));

drop policy if exists "members read trades" on public.trades;
drop policy if exists "users create trades" on public.trades;
drop policy if exists "trade parties update trades" on public.trades;
create policy "members read trades" on public.trades
  for select to authenticated using (public.is_league_member(league_id));
create policy "users create trades" on public.trades
  for insert to authenticated with check (from_user=(select auth.uid()) and public.is_league_member(league_id));
create policy "trade parties update trades" on public.trades
  for update to authenticated using ((from_user=(select auth.uid()) or to_user=(select auth.uid())) and public.is_league_member(league_id))
  with check ((from_user=(select auth.uid()) or to_user=(select auth.uid())) and public.is_league_member(league_id));


-- Server-enforced mutation hardening
drop policy if exists "users update own membership" on public.league_members;

drop policy if exists "users write own roster" on public.rosters;
drop policy if exists "users insert own roster" on public.rosters;
drop policy if exists "users update own roster" on public.rosters;
drop policy if exists "users delete own roster" on public.rosters;

drop policy if exists "users write own waivers" on public.waiver_claims;
drop policy if exists "users insert own waivers" on public.waiver_claims;
drop policy if exists "users update own waivers" on public.waiver_claims;
drop policy if exists "users delete own waivers" on public.waiver_claims;

drop policy if exists "users create trades" on public.trades;
drop policy if exists "trade parties update trades" on public.trades;

create or replace function public.create_waiver(p_league_id uuid,p_player_id text,p_priority integer default 1)
returns public.waiver_claims
language plpgsql
security definer
set search_path = public
as $$
declare result public.waiver_claims;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if nullif(trim(p_player_id),'') is null then raise exception 'Player is required'; end if;
  if coalesce(p_priority,0) < 1 then raise exception 'Priority must be positive'; end if;
  insert into public.waiver_claims(league_id,user_id,player_id,priority,status)
  values(p_league_id,auth.uid(),left(trim(p_player_id),100),p_priority,'pending')
  returning * into result;
  return result;
end;
$$;

create or replace function public.cancel_waiver(p_claim_id uuid)
returns public.waiver_claims
language plpgsql
security definer
set search_path = public
as $$
declare result public.waiver_claims;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.waiver_claims set status='canceled'
   where id=p_claim_id and user_id=auth.uid() and status='pending'
   returning * into result;
  if result.id is null then raise exception 'Pending waiver claim not found'; end if;
  return result;
end;
$$;

create or replace function public.create_trade(p_league_id uuid,p_to_user uuid,p_offer jsonb)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.trades;
  send_id text;
  receive_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_to_user is null or p_to_user=auth.uid() then raise exception 'Choose another league manager'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_to_user) then
    raise exception 'Trade recipient is not in this league';
  end if;

  send_id := nullif(p_offer->>'send_player_id','');
  receive_id := nullif(p_offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;

  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=auth.uid() and player_id=send_id) then
    raise exception 'You no longer own the offered player';
  end if;
  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=p_to_user and player_id=receive_id) then
    raise exception 'The other manager no longer owns the requested player';
  end if;

  insert into public.trades(league_id,from_user,to_user,offer,status)
  values(p_league_id,auth.uid(),p_to_user,p_offer,'pending')
  returning * into result;
  return result;
end;
$$;

create or replace function public.resolve_trade(p_trade_id uuid,p_status text)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare result public.trades;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('declined','canceled') then raise exception 'Invalid trade status'; end if;

  update public.trades
     set status=p_status,resolved_at=now()
   where id=p_trade_id
     and status='pending'
     and ((p_status='canceled' and from_user=auth.uid()) or (p_status='declined' and to_user=auth.uid()))
   returning * into result;

  if result.id is null then raise exception 'Pending trade not found or action not allowed'; end if;
  return result;
end;
$$;

revoke all on function public.create_waiver(uuid,text,integer) from public, anon;
revoke all on function public.cancel_waiver(uuid) from public, anon;
revoke all on function public.create_trade(uuid,uuid,jsonb) from public, anon;
revoke all on function public.resolve_trade(uuid,text) from public, anon;

grant execute on function public.create_waiver(uuid,text,integer) to authenticated;
grant execute on function public.cancel_waiver(uuid) to authenticated;
grant execute on function public.create_trade(uuid,uuid,jsonb) to authenticated;
grant execute on function public.resolve_trade(uuid,text) to authenticated;


-- Shared league settings, lifecycle, and live snake draft
alter table public.leagues
  add column if not exists status text not null default 'pre_draft'
  check (status in ('pre_draft','drafting','active','completed'));

create table if not exists public.league_drafts (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','drafting','complete')),
  manager_order uuid[] not null default '{}',
  current_pick integer not null default 0,
  total_rounds integer not null default 6,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.draft_picks (
  league_id uuid not null references public.leagues(id) on delete cascade,
  pick_number integer not null,
  round_number integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (league_id,pick_number),
  unique (league_id,player_id)
);

alter table public.league_drafts enable row level security;
alter table public.draft_picks enable row level security;

drop policy if exists "members read league drafts" on public.league_drafts;
create policy "members read league drafts" on public.league_drafts
  for select to authenticated using (public.is_league_member(league_id));

drop policy if exists "members read draft picks" on public.draft_picks;
create policy "members read draft picks" on public.draft_picks
  for select to authenticated using (public.is_league_member(league_id));

create or replace function public.update_league_settings(p_league_id uuid,p_name text,p_settings jsonb)
returns public.leagues
language plpgsql
security definer
set search_path=public
as $$
declare result public.leagues;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid()) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  if exists(select 1 from public.leagues where id=p_league_id and status<>'pre_draft') then
    raise exception 'League settings are locked after the draft starts';
  end if;
  update public.leagues
     set name=left(coalesce(nullif(trim(p_name),''),name),40),
         settings=coalesce(p_settings,'{}'::jsonb)
   where id=p_league_id
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid()) then
    raise exception 'Only the commissioner can start the draft';
  end if;
  select coalesce(nullif(settings->>'managers','')::integer,4),
         5 + coalesce(nullif(settings->>'bench','')::integer,1)
    into expected_count,rounds from public.leagues where id=p_league_id;
  select count(*),array_agg(user_id order by joined_at,user_id)
    into actual_count,ordering from public.league_members where league_id=p_league_id;
  if actual_count<>expected_count then
    raise exception 'League needs % managers before drafting; currently has %',expected_count,actual_count;
  end if;
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
  expected_user uuid;
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
  expected_user:=d.manager_order[manager_pos];
  if expected_user<>auth.uid() then raise exception 'It is not your turn'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_player_id) then
    raise exception 'Player has already been drafted';
  end if;
  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,player_id,role)
  values(p_league_id,next_pick,round_idx+1,auth.uid(),left(trim(p_player_id),100),p_role)
  returning * into result;
  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts
     set current_pick=next_pick,
         status=case when next_pick>=total_picks then 'complete' else 'drafting' end,
         updated_at=now()
   where league_id=p_league_id;
  if next_pick>=total_picks then
    delete from public.rosters where league_id=p_league_id;
    insert into public.rosters(league_id,user_id,player_id,slot)
    select league_id,user_id,player_id,
           case when row_number() over(partition by user_id,role order by pick_number)=1 then role else 'BN' end
      from public.draft_picks where league_id=p_league_id;
    update public.leagues set status='active' where id=p_league_id;
  end if;
  return result;
end;
$$;

revoke all on function public.update_league_settings(uuid,text,jsonb) from public,anon;
revoke all on function public.start_league_draft(uuid) from public,anon;
revoke all on function public.make_draft_pick(uuid,text,text) from public,anon;
grant execute on function public.update_league_settings(uuid,text,jsonb) to authenticated;
grant execute on function public.start_league_draft(uuid) to authenticated;
grant execute on function public.make_draft_pick(uuid,text,text) to authenticated;


-- Shared roster transaction history
create table if not exists public.roster_transactions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('add','drop')),
  player_id text not null,
  created_at timestamptz not null default now()
);

alter table public.roster_transactions enable row level security;
drop policy if exists "members read roster transactions" on public.roster_transactions;
create policy "members read roster transactions" on public.roster_transactions
  for select to authenticated using (public.is_league_member(league_id));

create index if not exists roster_transactions_league_id_idx on public.roster_transactions(league_id);
create index if not exists roster_transactions_user_id_idx on public.roster_transactions(user_id);

create or replace function public.replace_roster(p_league_id uuid,p_players jsonb)
returns setof public.rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then
    raise exception 'Roster moves are only available after the draft is complete';
  end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb)) <> 'array' then raise exception 'Players must be an array'; end if;
  if jsonb_array_length(coalesce(p_players,'[]'::jsonb)) > 12 then raise exception 'Roster is too large'; end if;

  perform 1 from public.leagues where id=p_league_id for update;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id' having count(*) > 1
  ) then raise exception 'Duplicate player in roster'; end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r on r.league_id=p_league_id
      and r.player_id=x->>'player_id'
      and r.user_id<>auth.uid()
  ) then raise exception 'A submitted player is already rostered by another manager'; end if;

  insert into public.roster_transactions(league_id,user_id,action,player_id)
  select p_league_id,auth.uid(),'drop',r.player_id
    from public.rosters r
   where r.league_id=p_league_id and r.user_id=auth.uid()
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
       where x->>'player_id'=r.player_id
     );

  insert into public.roster_transactions(league_id,user_id,action,player_id)
  select p_league_id,auth.uid(),'add',x->>'player_id'
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
   where nullif(x->>'player_id','') is not null
     and not exists (
       select 1 from public.rosters r
       where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
     );

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();

  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb))
  loop
    insert into public.rosters(league_id,user_id,player_id,slot)
    values(p_league_id,auth.uid(),left(coalesce(item->>'player_id',''),100),left(coalesce(item->>'slot','BN'),10));
  end loop;

  return query
  select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid()
  order by created_at;
end;
$$;

create index if not exists draft_picks_user_id_idx on public.draft_picks(user_id);


-- League settings validation
create or replace function public.create_league(p_name text,p_settings jsonb default '{}'::jsonb)
returns public.leagues
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.leagues;
  manager_count integer;
  bench_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;
  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  bench_count:=coalesce(nullif(p_settings->>'bench','')::integer,1);
  if manager_count not in (2,4,6,8,10,12) then raise exception 'Invalid manager count'; end if;
  if bench_count not between 1 and 5 then raise exception 'Invalid bench count'; end if;

  insert into public.leagues(owner_id,name,invite_code,settings)
  values(auth.uid(),left(trim(p_name),40),public.new_invite_code(),coalesce(p_settings,'{}'::jsonb))
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner','My Team');

  return result;
end;
$$;

create or replace function public.update_league_settings(p_league_id uuid,p_name text,p_settings jsonb)
returns public.leagues
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.leagues;
  manager_count integer;
  bench_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid()) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  if exists(select 1 from public.leagues where id=p_league_id and status<>'pre_draft') then
    raise exception 'League settings are locked after the draft starts';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;

  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  bench_count:=coalesce(nullif(p_settings->>'bench','')::integer,1);
  if manager_count not in (2,4,6,8,10,12) then raise exception 'Invalid manager count'; end if;
  if bench_count not between 1 and 5 then raise exception 'Invalid bench count'; end if;
  if manager_count < (select count(*) from public.league_members where league_id=p_league_id) then
    raise exception 'Manager count cannot be lower than current league membership';
  end if;

  update public.leagues
     set name=left(trim(p_name),40),
         settings=coalesce(p_settings,'{}'::jsonb)
   where id=p_league_id
   returning * into result;
  return result;
end;
$$;


create or replace function public.update_team_name(p_league_id uuid,p_team_name text)
returns public.league_members
language plpgsql
security definer
set search_path=public
as $$
declare result public.league_members;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;
  update public.league_members
     set team_name=left(trim(p_team_name),40)
   where league_id=p_league_id and user_id=auth.uid()
   returning * into result;
  if result.user_id is null then raise exception 'League membership required'; end if;
  return result;
end;
$$;
revoke all on function public.update_team_name(uuid,text) from public,anon;
grant execute on function public.update_team_name(uuid,text) to authenticated;


-- Enforce active-league roster, waiver, trade, and draft legality
create or replace function public.replace_roster(p_league_id uuid,p_players jsonb)
returns setof public.rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  roster_limit integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then
    raise exception 'Roster moves are only available after the draft is complete';
  end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb)) <> 'array' then raise exception 'Players must be an array'; end if;
  select 5+coalesce(nullif(settings->>'bench','')::integer,1) into roster_limit from public.leagues where id=p_league_id;
  if jsonb_array_length(coalesce(p_players,'[]'::jsonb)) > roster_limit then raise exception 'Roster exceeds league limit of %',roster_limit; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x where coalesce(x->>'slot','BN') not in ('TOP','JNG','MID','ADC','SUP','BN')) then raise exception 'Invalid roster slot'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x where coalesce(x->>'slot','BN')<>'BN' group by x->>'slot' having count(*)>1) then raise exception 'Only one starter is allowed per role'; end if;
  perform 1 from public.leagues where id=p_league_id for update;
  if exists (select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x group by x->>'player_id' having count(*) > 1) then raise exception 'Duplicate player in roster'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r on r.league_id=p_league_id and r.player_id=x->>'player_id' and r.user_id<>auth.uid()
  ) then raise exception 'A submitted player is already rostered by another manager'; end if;

  insert into public.roster_transactions(league_id,user_id,action,player_id)
  select p_league_id,auth.uid(),'drop',r.player_id from public.rosters r
   where r.league_id=p_league_id and r.user_id=auth.uid()
     and not exists (select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x where x->>'player_id'=r.player_id);

  insert into public.roster_transactions(league_id,user_id,action,player_id)
  select p_league_id,auth.uid(),'add',x->>'player_id' from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
   where nullif(x->>'player_id','') is not null
     and not exists (select 1 from public.rosters r where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id');

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();
  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb))
  loop
    insert into public.rosters(league_id,user_id,player_id,slot)
    values(p_league_id,auth.uid(),left(coalesce(item->>'player_id',''),100),left(coalesce(item->>'slot','BN'),10));
  end loop;
  return query select * from public.rosters where league_id=p_league_id and user_id=auth.uid() order by created_at;
end;
$$;

create or replace function public.create_waiver(p_league_id uuid,p_player_id text,p_priority integer default 1)
returns public.waiver_claims
language plpgsql
security definer
set search_path = public
as $$
declare result public.waiver_claims;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then raise exception 'Waivers open after the draft is complete'; end if;
  if nullif(trim(p_player_id),'') is null then raise exception 'Player is required'; end if;
  if coalesce(p_priority,0) < 1 then raise exception 'Priority must be positive'; end if;
  if exists(select 1 from public.rosters where league_id=p_league_id and player_id=p_player_id) then raise exception 'Player is already rostered'; end if;
  if exists(select 1 from public.waiver_claims where league_id=p_league_id and user_id=auth.uid() and player_id=p_player_id and status='pending') then raise exception 'You already have a pending claim for this player'; end if;
  insert into public.waiver_claims(league_id,user_id,player_id,priority,status)
  values(p_league_id,auth.uid(),left(trim(p_player_id),100),p_priority,'pending')
  returning * into result;
  return result;
end;
$$;

create or replace function public.create_trade(p_league_id uuid,p_to_user uuid,p_offer jsonb)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.trades;
  send_id text;
  receive_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then raise exception 'Trading opens after the draft is complete'; end if;
  if p_to_user is null or p_to_user=auth.uid() then raise exception 'Choose another league manager'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_to_user) then raise exception 'Trade recipient is not in this league'; end if;
  send_id := nullif(p_offer->>'send_player_id','');
  receive_id := nullif(p_offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;
  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=auth.uid() and player_id=send_id) then raise exception 'You no longer own the offered player'; end if;
  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=p_to_user and player_id=receive_id) then raise exception 'The other manager no longer owns the requested player'; end if;
  insert into public.trades(league_id,from_user,to_user,offer,status)
  values(p_league_id,auth.uid(),p_to_user,p_offer,'pending')
  returning * into result;
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
  expected_user uuid;
  next_pick integer;
  total_picks integer;
  my_pick_count integer;
  my_distinct_roles integer;
  picks_left integer;
  role_already_filled boolean;
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
  expected_user:=d.manager_order[manager_pos];
  if expected_user<>auth.uid() then raise exception 'It is not your turn'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_player_id) then raise exception 'Player has already been drafted'; end if;
  select count(*),count(distinct role) into my_pick_count,my_distinct_roles from public.draft_picks where league_id=p_league_id and user_id=auth.uid();
  picks_left:=d.total_rounds-my_pick_count;
  select exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=auth.uid() and role=p_role) into role_already_filled;
  if picks_left <= (5-my_distinct_roles) and role_already_filled then raise exception 'You must fill a missing starting role with this pick'; end if;
  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,player_id,role)
  values(p_league_id,next_pick,round_idx+1,auth.uid(),left(trim(p_player_id),100),p_role)
  returning * into result;
  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts
     set current_pick=next_pick,
         status=case when next_pick>=total_picks then 'complete' else 'drafting' end,
         updated_at=now()
   where league_id=p_league_id;
  if next_pick>=total_picks then
    delete from public.rosters where league_id=p_league_id;
    insert into public.rosters(league_id,user_id,player_id,slot)
    select league_id,user_id,player_id,
           case when row_number() over(partition by user_id,role order by pick_number)=1 then role else 'BN' end
      from public.draft_picks where league_id=p_league_id;
    update public.leagues set status='active' where id=p_league_id;
  end if;
  return result;
end;
$$;
