# Rift Fantasy

Rift Fantasy is a mobile-first fantasy League of Legends esports prototype hosted on GitHub Pages.

## Current capabilities

The app includes a home dashboard, fantasy roster management, player profiles, a mock snake draft, pro match schedules, league setup, demo matchups and standings, waiver claim simulation, add/drop transactions, a local trade simulator, and browser-persisted settings.

## Data and scoring status

Pro schedule and roster data can be refreshed from the LoL Esports persisted API by the GitHub Actions workflow in `.github/workflows/update-esports-data.yml`. The workflow requires a repository secret named `LOL_ESPORTS_API_KEY`. If the secret is missing or the upstream API fails, the workflow keeps the last known-good `esports-data.js` snapshot instead of overwriting it.

Fantasy projections, matchup scores, fantasy standings, waiver processing, and multi-manager trades are currently **prototype/demo behavior**. They are intentionally labeled as such in the UI. There is not yet a shared backend, authentication system, live fantasy scoring pipeline, or synchronized multi-user league state.

## Local validation

No runtime dependencies are required. Node 24+ is used only for repository checks.

```bash
npm run check
npm run smoke
npm run e2e
```

The validation checks JavaScript syntax, required files, route/template consistency, duplicate HTML IDs, data-file structure, duplicate function declarations, CSS brace balance, accessibility basics, and accidental hard-coded API-key fallbacks.

## Deployment

GitHub Pages serves the static files from the repository root. Navigation uses hash-based views so refreshing a view does not require server-side routing.

## Security note

Do not commit API credentials. Configure `LOL_ESPORTS_API_KEY` only as a GitHub Actions repository secret.

## Cloud backend

A Supabase-ready backend layer now exists:

- `supabase/schema.sql` defines authenticated profiles, leagues, membership, rosters, waivers, trades, invite-code RPCs, and row-level security policies.
- `backend.js` provides authentication and shared-league API methods without exposing privileged credentials.
- `backend-config.js` is intentionally blank until the production Supabase project URL and public anon key are available.

The public anon key is designed for browser use when protected by Row Level Security. Never place a Supabase service-role key in frontend files.

## Project status

The frontend and cloud integration layer are ready for backend provisioning. Until a Supabase project is connected and the schema is applied, the app safely remains in local prototype mode. Live fantasy scoring still requires a separate trusted ingestion/scoring service before production launch.
