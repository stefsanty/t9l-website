-- v1.63.0 — per-league pre-season + recruiting toggles.
--
-- Adds two purely additive boolean columns to League:
--
--   * `preseasonMode BOOLEAN NOT NULL DEFAULT false` — when true, the
--     homepage replaces `NextMatchdayBanner` with `CompressedMatchdaySchedule`
--     (a vertically compact all-matchdays view) and hides the `/stats`
--     page (header link removed; route redirects to home).
--
--   * `recruiting BOOLEAN NOT NULL DEFAULT false` — when true, surfaces
--     a prominent "RECRUITING NOW" banner at the top of the homepage.
--
-- Both default false so every existing league behaves exactly as before
-- v1.63.0. Both are independent of each other and of v1.60.0's
-- `allowSelfLink`. Per-league: each league has its own pair of flags.
--
-- Purely additive: no DROP, no ALTER COLUMN against existing data, no
-- destructive backfill. Existing rows pick up DEFAULT false at write
-- time of the migration.
--
-- Rollback recipe (if reverting v1.63.0):
--   ALTER TABLE "League" DROP COLUMN "preseasonMode";
--   ALTER TABLE "League" DROP COLUMN "recruiting";
-- Code revert restores the pre-v1.63.0 behavior.

ALTER TABLE "League" ADD COLUMN "preseasonMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "League" ADD COLUMN "recruiting"    BOOLEAN NOT NULL DEFAULT false;
