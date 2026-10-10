
-- Opt out of permissive defaults for future public objects.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- Remove broad inherited table privileges.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  loop
    execute format('revoke all privileges on table public.%I from anon, authenticated',r.relname);
  end loop;
end $$;

-- Browser read surface: authenticated only, subject to RLS.
grant select on public.competitions,
  public.draft_picks,
  public.fantasy_game_scores,
  public.fantasy_lineup_locks,
  public.fantasy_players,
  public.fantasy_playoffs,
  public.fantasy_rounds,
  public.fantasy_score_corrections,
  public.league_activity,
  public.league_bots,
  public.league_champions,
  public.league_drafts,
  public.league_history,
  public.league_matchups,
  public.league_members,
  public.league_standings,
  public.leagues,
  public.notifications,
  public.player_competition_status,
  public.player_game_stats,
  public.player_projections,
  public.pro_games,
  public.pro_matches,
  public.pro_teams,
  public.profiles,
  public.roster_transactions,
  public.rosters,
  public.trades,
  public.waiver_claims,
  public.waiver_priority
to authenticated;

-- The browser writes only its own profile and client error rows directly.
grant insert,update,delete on public.profiles to authenticated;
grant insert on public.client_error_logs to authenticated;

-- No normal browser role should access internal telemetry/admin tables directly.
revoke all on public.data_source_health,
  public.data_anomalies,
  public.integrity_check_results,
  public.platform_admins
from anon, authenticated;

-- Anonymous browser database access is unnecessary; signed-out UI uses static assets.
revoke all on all tables in schema public from anon;

-- Keep only intentional browser RPCs callable.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',r.sig);
  end loop;
end $$;

grant execute on function public.accept_trade(uuid) to authenticated;
grant execute on function public.cancel_waiver(uuid) to authenticated;
grant execute on function public.create_bot_league(text,text,integer,integer,text,jsonb) to authenticated;
grant execute on function public.create_league(text,jsonb) to authenticated;
grant execute on function public.create_trade(uuid,uuid,jsonb) to authenticated;
grant execute on function public.create_waiver(uuid,text,integer,text) to authenticated;
grant execute on function public.delete_league(uuid) to authenticated;
grant execute on function public.join_league(text,text) to authenticated;
grant execute on function public.make_bot_draft_pick(uuid) to authenticated;
grant execute on function public.make_draft_pick(uuid,text,text) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.remove_league_member(uuid,uuid) to authenticated;
grant execute on function public.replace_roster(uuid,jsonb) to authenticated;
grant execute on function public.resolve_trade(uuid,text) to authenticated;
grant execute on function public.review_trade(uuid,boolean) to authenticated;
grant execute on function public.start_league_draft(uuid) to authenticated;
grant execute on function public.update_league_settings(uuid,text,jsonb) to authenticated;
grant execute on function public.update_team_name(uuid,text) to authenticated;

-- Service role retains backend access.
grant all privileges on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Remove obsolete public policy surfaces for backend-only telemetry.
drop policy if exists "authenticated users read data source health" on public.data_source_health;

-- Explicitly deny direct access to internal RLS-only tables; RLS remains defense in depth.
revoke all on public.data_source_health,public.data_anomalies,public.integrity_check_results,public.platform_admins from authenticated,anon;
