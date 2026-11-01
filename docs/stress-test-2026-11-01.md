# Rift Fantasy Stress Test — November 1, 2026

## Scope and caveats
Tested repository application functions and read-only Supabase integrity. **The website itself could not be reached from the testing environment**, so no real HTTP concurrency, GitHub Pages response times, browser rendering, login, realtime updates, or Playwright execution is claimed.

## Results
- 1,000 repeats of the archived historical replay: passed, approximately 515 ms in a V8 tool runtime.
- Planning 10,000 synthetic professional series: passed, approximately 20 ms.
- Planning 50,000 synthetic professional series: passed, approximately 91 ms in the same runtime; 72 scoring windows, no lost matches or overlaps.
- 2 to 10 fantasy managers, 300 rounds each: passed. 8,700 pairing slots checked. Byes handled for odd manager counts.
- Main application and backend JavaScript parsing: passed.
- HTML: 370 IDs with no duplicates; 25 templates with no missing references in checked expressions.
- Key Season Fantasy interface elements: present.

## Supabase integrity (read-only)
- Leagues: 3; Season Fantasy leagues: 0; published Season Fantasy round plans: 0.
- Fantasy matchups: 6; fantasy rounds: 6; playoff matches: 1.
- Roster entries: 32; lineup locks: 10; saved fantasy-game score entries: 630.
- Duplicate player ownership in a league: 0.
- Duplicate role positions per manager: 0.
- Overlapping saved fantasy rounds: 0.
- Orphan fantasy game scores: 0.

## Data quality warning
Two completed professional games show `stats_status='error'`:
1. Worlds 2026 Play-Ins, game 2, October 15, 2026 — `First Blood not yet resolved`.
2. CBLOL Finals, game 4, October 10, 2026 — `First Blood not yet resolved`.

No database records were changed. The two games should remain unfinalized until an authoritative First Blood result is sourced.

## Repeat this test
`npm run stress:season` runs the source-controlled CPU stress scenarios, saving no production data.

`npm run release:check` runs the repository's release suite (including browser smoke, browser interaction, preflight and unit tests), **when executed in a machine with Chromium and the repository checked out**.

This report is not evidence that 50,000 simultaneous web users can be supported; it measures CPU-side logic with synthetic scheduled series, not concurrent network requests.

## Outstanding validation
- Execute the GitHub Actions release workflow; inspect its logs and job status.
- Run concurrent requests from an authorized load-test client against a staging deployment, not the public production endpoint.
- Verify login and league create/join, draft, roster changes, trade flow, scoring, bracket and season publisher with Playwright.
- Audit first-blood ingestion source and retry failed statistics only when verified.
- Create an isolated authenticated Season Fantasy test league with a confirmed regional schedule.
