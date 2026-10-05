# Rift Fantasy

Rift Fantasy is a mobile-first fantasy League of Legends esports prototype hosted on GitHub Pages.

## Current capabilities

The app includes a home dashboard, fantasy roster management, player profiles, a mock snake draft, pro match schedules, league setup, demo matchups and standings, waiver claim simulation, add/drop transactions, a local trade simulator, and browser-persisted settings.

## Data and scoring status

Pro schedule and roster data can be refreshed from the LoL Esports persisted API by the GitHub Actions workflow in `.github/workflows/update-esports-data.yml`. The workflow requires a repository secret named `LOL_ESPORTS_API_KEY`. If the secret is missing or the upstream API fails, the workflow keeps the last known-good `esports-data.js` snapshot instead of overwriting it.

Fantasy projections, matchup scores, fantasy standings, waiver processing, and multi-manager trades are currently **prototype/demo behavior**. They are intentionally labeled as such in the UI. There is not yet a shared backend, authentication system, live fantasy scoring pipeline, or synchronized multi-user league state.

## Local validation

No runtime dependencies are required. Node 20+ is used only for repository checks.

```bash
npm run check
```

The validation checks JavaScript syntax, required files, route/template consistency, duplicate HTML IDs, data-file structure, duplicate function declarations, CSS brace balance, accessibility basics, and accidental hard-coded API-key fallbacks.

## Deployment

GitHub Pages serves the static files from the repository root. Navigation uses hash-based views so refreshing a view does not require server-side routing.

## Security note

Do not commit API credentials. Configure `LOL_ESPORTS_API_KEY` only as a GitHub Actions repository secret.

## Project status

This is an actively developed prototype. It is suitable for controlled testing, but the multi-user fantasy-league backend and live scoring systems must be implemented and validated before a true production launch.
