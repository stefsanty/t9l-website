# TODO.md

Operator-side outstanding actions: env vars to set, scripts to run, manual data fixes. Subagents update this as items ship or new ones land. Keep scannable.

## Pending operator actions

- **Run v1.67.0–v1.67.2 orphan cleanup against prod.**
  ```bash
  npx tsx scripts/cleanupV167SyntheticInviteOrphans.ts --dry-run   # review
  npx tsx scripts/cleanupV167SyntheticInviteOrphans.ts --apply     # delete
  ```
  Cleans empty Players + PLM(PENDING) rows created by the v1.67.0 synthetic-invite State C path before the v1.67.2 fix landed.

- **Verify v1.70.0 ID-images-on-User backfill against prod.**
  ```sql
  SELECT COUNT(*) FROM "User" WHERE "idUploadedAt" IS NOT NULL;
  -- Player.idFrontUrl/idBackUrl/idUploadedAt should no longer exist in the schema.
  ```
  Post-v1.70.0 ID images live on User, not Player. Confirm migration applied and column counts match expectation.

- **Match.playedAt JST spot-check** (carried from v1.9.0 deploy note). Pre-v1.9.0 admins not in JST may have produced `Match.playedAt` rows that are 9 hours off. v1.9.0 stops the bleeding; existing skewed rows need spot-check via the admin schedule editor (which now displays JST correctly) — re-save any that look wrong.

- **Vercel env vars for Google OAuth + email magic-link.** When the multi-provider login UI is fully exercised (currently LINE-only is functional), set on Vercel prod + preview:
  - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (from Google Cloud Console)
  - `EMAIL_SERVER` (SMTP connection string, recommended Resend) + `EMAIL_FROM`
  Without these, Google + Email branches self-hide via `getProviders()` so no breakage; setting them lights up those flows.

- **`BLOB_READ_WRITE_TOKEN` on Vercel** (already documented in v1.35.0 / v1.37.0 but reiterate). Required for ID upload (v1.35.0) + user-uploaded profile picture on `/account/player` (v1.37.0). Without it both flows surface "currently unavailable" friendly fallbacks.

- **Profile-picture moderation policy** (carried from v1.39.1 post-PR todos). Decide and document.

- **HLEN check on legacy `line-player-map` Redis hash** (carried from v1.12.0 out-of-scope item). If `redis.hlen('line-player-map') === 0`, drop the `legacyRedisCleanup` helper + the dropPic branch from `/api/assign-player/route.ts`. Otherwise drain residue first.

- **Delete orphan Sheets-cutover Setting rows** (post-v1.71.0 cleanup). The `s-public-dataSource-global` and `s-public-writeMode-global` rows are no longer read by any code path. Cosmetic-only cleanup:
  ```sql
  DELETE FROM "Setting"
   WHERE id IN ('s-public-dataSource-global', 's-public-writeMode-global');
  ```

- **Remove Sheets-related env vars from Vercel** (post-v1.71.0). `GOOGLE_SHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` are no longer read by any code path. Strip from prod + preview project settings when convenient (kept for now in case of accidental rollback).

## Done (most-recent-5; older entries cleared)

- v1.71.0 — Retire Google Sheets surface (delete `lib/sheets.ts` + `lib/mock-data.ts` + `scripts/importFromSheets.ts`; remove `googleapis` dep; drop `dataSource` / `writeMode` toggles)
- v1.70.0 — Move ID images from Player to User (migration `20260509000000_move_id_to_user`)
- v1.7.0 — RSVP-on-Redis cutover (`backfillRedisRsvpFromPrisma --apply` against prod, 12 GameWeeks seeded)
- v1.5.0 — Redis-canonical lineId→Player auth path (24h sliding TTL)
- 2026-04-27 — `dataSource='db'` operational flip
- 2026-04-28 — PR 6 Redis→Prisma migration (`backfillRedisLineMap`, 34 scanned / 31 linked)
