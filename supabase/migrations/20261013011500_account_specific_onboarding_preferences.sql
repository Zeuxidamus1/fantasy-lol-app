create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_dismissed boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "users read own preferences" on public.user_preferences;
create policy "users read own preferences" on public.user_preferences
  for select to authenticated
  using (user_id=(select auth.uid()));

drop policy if exists "users insert own preferences" on public.user_preferences;
create policy "users insert own preferences" on public.user_preferences
  for insert to authenticated
  with check (user_id=(select auth.uid()));

drop policy if exists "users update own preferences" on public.user_preferences;
create policy "users update own preferences" on public.user_preferences
  for update to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

insert into public.user_preferences(user_id)
select id from auth.users
on conflict (user_id) do nothing;

update public.user_preferences p
set onboarding_dismissed=true, updated_at=now()
where exists (
  select 1 from public.league_members lm where lm.user_id=p.user_id
);