# Rift Fantasy

Rift Fantasy is a mobile-first fantasy League of Legends esports application hosted on GitHub Pages with Supabase-backed shared leagues, live fantasy scoring, head-to-head matchups, standings, lineup locking, waivers, trades, playoffs, bot managers, projections, notifications, league history, and automated data-integrity checks.

## Data architecture

Professional schedule and roster data is synchronized into Supabase. Fantasy scoring uses persisted professional game statistics and league-specific scoring rules. Independent provider validation runs only in the backend and never controls fantasy scores or exposes provider diagnostics to normal users.

The public website does not display API health, cron jobs, source names, internal IDs, anomaly records, provider tokens, or other backend telemetry.

## Local validation

Node 24+ is used for repository and browser checks.

```bash
npm run check
npm run smoke
npm run e2e
npm run preflight
npm run release:check
```

`npm run release:check` is the complete release gate.

## Deployment

- `staging` is the code-rehearsal branch.
- `main` is the production branch.
- Both branches run the full validation workflow.
- Supabase database changes are deployed only from timestamped files in `supabase/migrations/`.
- The production backend workflow runs a migration dry-run before any database change.
- Edge Function settings are tracked in `supabase/config.toml`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full release process and [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) for the final public-launch requirements.

## Security

Only browser-safe Supabase publishable configuration belongs in `backend-config.js`.

Never commit:

- Supabase database passwords or connection strings
- Supabase secret/service-role keys
- Supabase access tokens
- LoL Esports provider secrets
- PandaScore tokens
- other backend credentials

Provider tokens belong in GitHub Actions secrets or Supabase Edge Function Secrets as appropriate.

## Source of truth

For an existing Supabase environment, `supabase/migrations/` is authoritative.

Do not apply `supabase/schema.sql` directly to production. It is retained as a legacy/reference snapshot only.
