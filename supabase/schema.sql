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
