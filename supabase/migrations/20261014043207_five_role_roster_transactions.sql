-- Reconciles the production migration history for the five-role roster rollout.
--
-- Production applied a short hotfix under this version/name before the consolidated
-- five-role migration was committed to the repository. The final definitions from
-- that hotfix are fully superseded by:
--   20261014044500_five_role_rosters_only.sql
--
-- Keeping this versioned placeholder ensures local/CI migration history matches the
-- live Supabase project without re-running obsolete intermediate function bodies.
select 1;
