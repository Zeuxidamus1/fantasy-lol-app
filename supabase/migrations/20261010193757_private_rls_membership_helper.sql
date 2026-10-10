
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated,service_role;

create or replace function private.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.league_members lm
    where lm.league_id=p_league_id
      and lm.user_id=(select auth.uid())
  );
$$;

revoke all on function private.is_league_member(uuid) from public,anon;
grant execute on function private.is_league_member(uuid) to authenticated,service_role;

drop policy if exists "members read draft picks" on public.draft_picks;
create policy "members read draft picks"
on public.draft_picks for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "members read league bots" on public.league_bots;
create policy "members read league bots"
on public.league_bots for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "members read league drafts" on public.league_drafts;
create policy "members read league drafts"
on public.league_drafts for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "members read membership" on public.league_members;
create policy "members read membership"
on public.league_members for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "league members read leagues" on public.leagues;
create policy "league members read leagues"
on public.leagues for select to authenticated
using (
  owner_id=(select auth.uid())
  or private.is_league_member(id)
);

drop policy if exists "members read roster transactions" on public.roster_transactions;
create policy "members read roster transactions"
on public.roster_transactions for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "members read rosters" on public.rosters;
create policy "members read rosters"
on public.rosters for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "members read trades" on public.trades;
create policy "members read trades"
on public.trades for select to authenticated
using (private.is_league_member(league_id));

drop policy if exists "members read waivers" on public.waiver_claims;
create policy "members read waivers"
on public.waiver_claims for select to authenticated
using (private.is_league_member(league_id));

revoke execute on function public.is_league_member(uuid) from public,anon,authenticated;
