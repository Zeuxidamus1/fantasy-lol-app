-- Tighten browser-facing grants after the public-repository security audit.

-- Signed-out users do not need database access. Keep the player directory
-- authenticated-only so a future grant cannot accidentally make it public.
drop policy if exists "fantasy players public read" on public.fantasy_players;
create policy "authenticated read fantasy players"
on public.fantasy_players
for select
to authenticated
using (true);

revoke all privileges on table public.fantasy_players from anon;
grant select on table public.fantasy_players to authenticated;

-- user_preferences was created after the broad grant-hardening migration.
-- Remove PostgreSQL's non-CRUD defaults and grant only the intended CRUD surface.
revoke all privileges on table public.user_preferences from anon, authenticated;
grant select, insert, update on table public.user_preferences to authenticated;

-- Internal creator/operations tables stay RPC/service-role only.
revoke all privileges on table
  public.simulation_runs,
  public.simulation_player_stats,
  public.platform_admins,
  public.data_source_health,
  public.data_anomalies,
  public.integrity_check_results
from anon, authenticated;

-- No browser role should gain sequence access.
revoke usage, select on all sequences in schema public from anon, authenticated;
