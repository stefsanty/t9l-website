# Match events backfill report

This file is the destination for the v1.42.1 (PR β) backfill script's output.

```
npx ts-node --project tsconfig.scripts.json scripts/backfillMatchEventsFromSheet.ts --dry-run --verbose
```

The dry run produces a per-row summary listing inserts planned, unresolved
rows (with reasons), assister notes (text resolved to null), and any
`Match.homeScore`/`awayScore` cache vs. events-derived score mismatches.

```
npx ts-node --project tsconfig.scripts.json scripts/backfillMatchEventsFromSheet.ts --apply --verbose
```

`--apply` actually writes the events. The cache columns are NEVER mutated by
the backfill — surfaced score mismatches are review tasks for the operator,
who can then either:

  1. Edit individual events via the admin events CRUD (PR γ) so the
     events-derived score matches reality.
  2. Set `Match.scoreOverride` on the affected match for forfeits / abandoned
     matches where the events alone don't tell the full story.

This file gets overwritten on every script run.

## Operator notes

- Prod apply requires running the script with prod credentials in the env
  (DATABASE_URL/UNPOOLED + GOOGLE_*). The scripts in this repo expect
  `.env.preview` / `.env.production` / `.env.local` in that order.
- Idempotency: re-running after `--apply` will INSERT duplicate events (the
  v1.42.0 schema has no natural unique constraint to prevent it). Operator
  responsibility: check the report's "Inserts planned" count against
  expectations before re-applying.
