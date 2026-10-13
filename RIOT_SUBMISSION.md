# Rift Fantasy — Riot Developer Portal Submission

## Product name

Rift Fantasy

## Product summary

Rift Fantasy is a free fantasy League of Legends esports application. Players create or join private fantasy leagues, draft professional League of Legends players, manage starting lineups, make roster moves and trades, and compete in head-to-head fantasy matchups based on real professional tournament performance.

## Core features

- Create and join fantasy leagues
- Snake-style player drafts
- Role-based rosters for TOP, JNG, MID, ADC, SUP, FLEX and bench players
- Head-to-head fantasy matchups
- Live fantasy scoring from professional League of Legends match statistics
- League standings and postseason/playoff support
- Trades and waiver claims
- Tournament schedules and roster-only schedules
- Bot-managed leagues for testing and solo play
- A creator-only mock simulator used exclusively for synthetic test statistics

Synthetic/randomized statistics are never used in normal fantasy leagues. They are isolated to the creator-only mock simulator.

## Data use

Rift Fantasy synchronizes professional League of Legends schedule, roster, event and match-stat information through LoL Esports services and stores normalized fantasy data in Supabase.

Riot / LoL Esports data is the primary source used for professional match information and fantasy scoring. Independent sources may be used only for validation or finalized-game reconciliation and do not independently control live fantasy scores.

Rift Fantasy currently uses the LoL Esports web-facing schedule/event services and live-stat feed. We are registering the product with Riot to ensure this ingestion approach is acceptable and will migrate to any Riot-supported service Riot recommends for this use case.

## User experience

A user can:

1. Create an account.
2. Create or join a fantasy league.
3. Select the professional competition supported by that league.
4. Draft eligible professional players.
5. Set a lineup.
6. Follow professional matches and live fantasy scoring.
7. Compete against another fantasy manager.
8. Review final scores, standings and completed league results.

## Monetization

Rift Fantasy currently does not provide wagering or gambling functionality and is not designed as a betting product.

If monetization is added in the future, the product will be reviewed against Riot's applicable monetization policies before such functionality is enabled.

## Riot disclaimer

Rift Fantasy isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

This disclaimer is visible to users on the public authentication experience and in the Terms.

## Privacy and security

Rift Fantasy provides public Privacy Notice and Terms pages.

Authentication and fantasy-league data are backed by Supabase. Provider credentials and privileged backend credentials are server-side only. The browser receives only publishable client configuration.

## Review notes

The application is a working, mobile-first web product rather than a repository-only prototype.

The creator-only Mock Draft Simulator exists for testing fantasy scoring and uses synthetic/randomized statistics. It is restricted to the platform creator and is isolated from normal leagues and real fantasy scoring.

## Reviewer test flow

For review, Riot may:

1. Open the public Rift Fantasy site.
2. Review Privacy and Terms from the authentication screen.
3. Create an account.
4. Create a fantasy league or use a provided test account/league.
5. Review the draft, roster, schedule, matchup and scoring experiences.

If Riot provides a site-verification string or file, it can be added to the hosted site for ownership verification.
