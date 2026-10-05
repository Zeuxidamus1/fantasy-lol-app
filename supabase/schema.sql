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
    code := upper(substr(encode(gen_random_bytes(8),'hex'),1,8));
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
  select id into target from public.leagues where invite_code=upper(trim(p_invite_code));
  if target is null then raise exception 'Invalid invite code'; end if;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(target,auth.uid(),'manager',left(coalesce(nullif(trim(p_team_name),''),'My Team'),40))
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
