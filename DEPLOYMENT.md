# Deployment Workflow

Rift Fantasy uses a promotion workflow designed to prevent unvalidated changes from reaching production.

## Branches

- `staging`: rehearsal branch. Push or merge changes here first.
- `main`: production code branch.

Both branches run the same full validation workflow:

```bash
npm run release:check
```

That command runs syntax checks, repository validation, browser smoke tests, browser interaction tests, deployment preflight checks, backend-privacy checks, and text-containment checks.

## Supabase database changes

Timestamped SQL files in `supabase/migrations/` are the database source of truth.

Do not deploy `supabase/schema.sql` directly to an existing environment. It remains only as a legacy/reference snapshot.

The **Release Supabase Backend** workflow always runs:

```bash
supabase db push --dry-run
```

before it can apply pending migrations.

Database migrations are applied only when the workflow is manually started with **Apply pending database migrations** enabled.

## Edge Functions

Tracked functions:

- `sync-match-stats`
- `sync-pandascore-validator`

Their JWT behavior is tracked in `supabase/config.toml`.

Function secrets stay in Supabase Edge Function Secrets. Never place provider tokens, database passwords, service-role keys, or access tokens in the repository or frontend configuration.

## GitHub production settings

The backend release workflow expects:

- Secret: `SUPABASE_DB_URL`
- Secret: `SUPABASE_ACCESS_TOKEN` only when deploying Edge Functions
- Variable: `SUPABASE_PROJECT_REF`

The workflow uses the GitHub environment named `production`. Repository owners can add required reviewers to that environment for an additional manual approval gate.

## Staging database

The GitHub `staging` branch is free and is used for code rehearsal.

A truly isolated Supabase staging database requires a separate Supabase project or Supabase Branch. That can create billable infrastructure, so it is intentionally not created automatically.

Until an isolated staging database is approved, staging validation must not perform writes against production.

## Release order

1. Develop changes.
2. Promote them to `staging`.
3. Confirm **Validate App** succeeds.
4. Promote the same commit to `main`.
5. Confirm **Validate App** succeeds on `main`.
6. Run **Release Supabase Backend** with both deployment switches off.
7. Review the migration dry-run.
8. Re-run with only the required deployment switch(es) enabled.
9. Verify production health after release.

This separates code validation from production mutation and makes database deployment explicit and auditable.
