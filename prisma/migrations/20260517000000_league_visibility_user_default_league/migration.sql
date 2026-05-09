-- v1.84.0 — homepage redesign phase 1a.
--
-- Adds:
--   - `LeagueVisibility` enum (PRIVATE / PUBLIC_CLOSED / PUBLIC_OPEN)
--   - `League.visibility` column, default PUBLIC_CLOSED
--   - one-shot backfill: leagues with `recruiting = true` -> PUBLIC_OPEN
--   - `User.defaultLeagueId` nullable FK + index (no writes this phase;
--     phase 1b/1c wires the writes from the upcoming `/leagues`
--     directory + LeagueSwitcher)
--
-- The legacy `League.recruiting` column is intentionally NOT dropped.
-- Admin SettingsTab still surfaces the "Recruiting banner" toggle this
-- phase; the next cycle drops both once every read site has switched
-- over to `visibility`.
--
-- Rollback (in reverse order):
--   ALTER TABLE "User" DROP CONSTRAINT "User_defaultLeagueId_fkey";
--   DROP INDEX "User_defaultLeagueId_idx";
--   ALTER TABLE "User" DROP COLUMN "defaultLeagueId";
--   ALTER TABLE "League" DROP COLUMN "visibility";
--   DROP TYPE "LeagueVisibility";

CREATE TYPE "LeagueVisibility" AS ENUM ('PRIVATE', 'PUBLIC_CLOSED', 'PUBLIC_OPEN');

ALTER TABLE "League"
  ADD COLUMN "visibility" "LeagueVisibility" NOT NULL DEFAULT 'PUBLIC_CLOSED';

UPDATE "League"
   SET "visibility" = 'PUBLIC_OPEN'
 WHERE "recruiting" = true;

ALTER TABLE "User"
  ADD COLUMN "defaultLeagueId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_defaultLeagueId_fkey"
  FOREIGN KEY ("defaultLeagueId")
  REFERENCES "League"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "User_defaultLeagueId_idx" ON "User"("defaultLeagueId");
