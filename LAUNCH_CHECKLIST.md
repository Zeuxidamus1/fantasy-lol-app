# Rift Fantasy Launch Checklist

## Automated gates

- [x] Repository syntax and static validation
- [x] Browser smoke tests
- [x] Responsive interaction tests at 320, 390, 768, 1024 and 1440 px
- [x] Text-containment and long-label stress tests
- [x] Deployment preflight and repository secret scan
- [x] Supabase RLS and browser permission hardening
- [x] Full rollback fantasy lifecycle simulation
- [x] Scheduled job health audit
- [x] Integrity checks show no critical fantasy-data findings
- [x] Privacy Notice and Terms are available in the public app
- [x] Browser code does not expose backend operations/source-health telemetry

## Production behavior

- Worlds and any other competition with an incomplete eligible player pool remain unavailable for drafting until the source feed publishes enough confirmed participants.
- A schedule containing TBD tournament slots is not sufficient to make players eligible.
- Internal third-source validation warnings never control fantasy scoring.

## Manual launch requirements

- [ ] Register Rift Fantasy in the Riot Games Developer Portal before making the product publicly available to players.
- [ ] Keep the Riot product description and feature list current when major functionality changes.
- [ ] If monetization is added, confirm the Riot product status and monetization requirements before enabling payments or ads.
- [ ] If the Supabase project is upgraded to a plan that supports leaked-password protection, enable it in Authentication security settings.

Riot Developer Portal: https://developer.riotgames.com/

## Release process

1. Merge or sync the approved commit to `staging`.
2. Require the full Validate App workflow to pass.
3. Sync the same approved commit to `main`.
4. For backend changes, run the manual Release Supabase Backend workflow and review the migration dry run before applying migrations or deploying functions.
5. Confirm authentication, league creation, draft availability, and the currently active competition after deployment.
