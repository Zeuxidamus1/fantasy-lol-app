# Rift Fantasy — Historical Season Gameplay Replay

**Date:** 2026-11-01  
**Status:** Controlled development replay. No production leagues, manager accounts, rosters, or existing standings were modified.

## Interactive replay dashboard

The read-only dashboard is `season-replay.html` at the repository root. When GitHub Pages has deployed this commit, it can be opened at:

https://zeuxidamus1.github.io/fantasy-lol-app/season-replay.html

Switch between **Actual calendar (blocked)**, **Counterfactual synchronized season (completed)**, and **Hypothetical emergency replacement**. The dashboard loads the immutable fixture and generated report without modifying Supabase or any user league. `scripts/test-replay-dashboard.mjs` verifies all three views in a lightweight simulated DOM.

## Archived input

- **Competition:** Worlds 2026 Swiss stage (October 23–31, 2026).
- **Archived source fields:** `stats_source=riot_lolesports` and `result_source=chaincc` in Rift Fantasy's finalized records. These labels come from the existing database; the replay does not independently certify Riot/ChainCC provenance.
- **33 completed professional matches**, **205 finalized game-stat records** for **25 selected players**.
- **20 drafted players**, distributed among **4 fantasy managers**. Every manager has exactly TOP, JNG, MID, ADC, and SUPP, drawn from **at least three different professional organizations**.
- **5 remaining unrostered pro players** for the replacement scenario.
- Points per game: kills × 3, deaths × −1, assists × 2, CS × 0.02, wins × 5, first blood × 2. Each series contributes its per-game average.

## Scenario A — Real calendar, two-day windows

**BLOCKED: No fantasy champion awarded.**

Grouping actual October 23–31 match dates into two-day windows yields missing match participation for ten of twenty drafted starters in **fantasy rounds 3 and 4**. The test correctly refuses to finalize those rounds rather than treating players without a scheduled series as real zero-scoring performances.

The application's actual adaptive period planner was also tested against the same archived matches: it generated **two** provisional windows, both flagged for unequal team participation, rather than inventing five fair rounds. During this test the planner had a period-overlap bug, which was fixed by capping each window's end before the following window starts.

**Consequence for release:** A fully automated season cannot yet promise a valid schedule from sparse esports fixtures. Verified split membership and sufficient professional-team coverage are prerequisites for schedule publication.

## Scenario B — Counterfactual synchronized series replay

For **development testing only**, every pro team's first Swiss series was mapped to fantasy round 1, its second series to round 2, and so on through five series. These were actual archived game statistics, but **this schedule never existed as a real simultaneous competition**. It is not suitable for live scheduling or historical official results.

The first three fantasy rounds are a round-robin regular season. The last two are fantasy semifinals and a championship.

### Regular-season standings

| Seed | Fantasy manager | W–L | Points for |
|---:|---|---|---:|
| 1 | Manager 3 | 3–0 | 489.49 |
| 2 | Manager 4 | 2–1 | 430.93 |
| 3 | Manager 1 | 1–2 | 419.93 |
| 4 | Manager 2 | 0–3 | 405.40 |

No one was eliminated by a regular-season loss.

### Fantasy playoff bracket

| Round | Matchup | Score | Advanced |
|---|---|---|---|
| Semifinal | Manager 3 (seed 1) vs Manager 2 (seed 4) | 99.64–108.05 | Manager 2 |
| Semifinal | Manager 4 (seed 2) vs Manager 1 (seed 3) | 106.49–127.13 | Manager 1 |
| Championship | Manager 2 vs Manager 1 | 115.23–120.23 | **Manager 1** |

**Counterfactual champion: Manager 1.** Managers 3 and 4 lost semifinals, Manager 2 lost the championship. All elimination is at the fantasy-manager level, not at the level of individual professional players' teams.

## Emergency replacement test

We simulated a hypothetical professional elimination **after round 3**. Manager 1 replaced **Zeus (TOP)** with unrostered **Canna (TOP)** from a different professional organization. The replacement changed future fantasy scores only and did not alter rounds 1–3. This is a **synthetic eligibility event**, not a claim that Zeus was actually eliminated at that point. Server-side replacement authorization and lock handling still require a real authenticated end-to-end test.

## Regression coverage

The repository includes `scripts/test-historical-season-replay.mjs`, linked to `npm test` and `npm run check`:

- Four managers, complete five-role cross-team rosters, and five unowned replacement candidates.
- Replaying completed historical series and per-game-average scoring.
- Blocking incomplete calendar windows and preventing a fake champion.
- Round-robin standings, seeded semifinals, final, and eliminations.
- Tie outcomes resolved by higher playoff seed.
- Rejecting missing or duplicate archived statistics.
- Ensuring replacements never rewrite previous rounds.
- Checking the actual production adaptive-round planner for uneven coverage and non-overlapping windows.

Run `npm test`, `npm run replay:season`, or `npm run replay:season:report` in a local checkout.

**Limitations:** The replay engine is independent of Supabase's live authenticated league/draft/publishing RPC transaction flow. Playwright and the complete release suite have not been executed in this session, and no real current regional regular-season schedule has been published. The full user-facing live-season workflow is not yet production-certified.

**Design decision:** Keep Season Fantasy schedule publication blocked when required professional teams have insufficient coverage or an approved match remains unresolved. Do not silently award zero points due to schedule absence.
