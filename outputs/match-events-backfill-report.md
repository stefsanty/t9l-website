# Match events backfill report

Mode: `--apply`
League: `minato-2025`
Generated: 2026-05-03T15:14:29.680Z

## Counts

- Scanned rows: 23
- Inserts planned: 23
- Inserts applied: 23
- Skipped: 0
- Matches affected: 5
- Score mismatches (cache vs events-derived): 0

## Assumptions encoded

- GoalsRaw historically carries no goalType metadata; all imported events land as OPEN_PLAY. Admins can edit individual events post-import via the new admin events CRUD (PR γ).
- Match.minute is left null on every imported row — the source sheet does not encode the event clock minute.
- createdById is null on imported rows (no User authored the historical event).

## Guest player seeding (v1.46.1)

- Players created: 0 (idempotent — re-runs are no-ops)
- Assignments created: 0
- Per-team Guest map: 4 teams

Each Guest is a regular Player record on a single LeagueTeam, named "Guest". They appear in the public roster (the legacy `GUEST_ID === 'p-guest'` exact-equals filter does NOT match the new `p-guest-<lt-id>` ids). Hide them via a prefix-check filter in `dbToPublicLeagueData` if desired (deferred — out of this scripts-only PR).

## Assister notes (inserted with null assister)

- row 17:  (assister "Mihail Volkov" unresolved → null)
- row 18:  (assister "Alksey Koltakov" unresolved → null)
