-- v1.84.0 — homepage redesign Phase 1a:
--   1. Add LeagueVisibility enum + League.visibility column.
--   2. Add User.defaultLeagueId nullable FK.
--
-- Both columns are additive with safe defaults so the migration is
-- fully backward-compatible.

-- ── 1. LeagueVisibility enum ────────────────────────────────────────
CREATE TYPE "LeagueVisibility" AS ENUM ('PRIVATE', 'PUBLIC_CLOSED', 'PUBLIC_OPEN');

ALTER TABLE "League"
  ADD COLUMN "visibility" "LeagueVisibility" NOT NULL DEFAULT 'PUBLIC_CLOSED';

-- One-shot backfill from the legacy `recruiting` boolean. Kept
-- transparent in the PR description so operators can verify the
-- mapping reflects current production state pre-deploy.
--
--   recruiting = true  → PUBLIC_OPEN   (banner visible today, stays visible)
--   recruiting = false → PUBLIC_CLOSED (banner hidden today, stays hidden)
--
-- No league becomes PRIVATE on backfill — admins explicitly opt in via
-- the SettingsTab visibility selector after deploy.
UPDATE "League"
   SET "visibility" = CASE WHEN "recruiting" THEN 'PUBLIC_OPEN'::"LeagueVisibility"
                           ELSE 'PUBLIC_CLOSED'::"LeagueVisibility"
                      END;

-- ── 2. User.defaultLeagueId ─────────────────────────────────────────
-- Nullable FK; ON DELETE SET NULL so deleting a league doesn't cascade-
-- delete users. No index — single-row reads keyed by User.id, no need.
ALTER TABLE "User"
  ADD COLUMN "defaultLeagueId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_defaultLeagueId_fkey"
  FOREIGN KEY ("defaultLeagueId") REFERENCES "League"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
