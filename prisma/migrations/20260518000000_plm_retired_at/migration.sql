-- v1.87.0 — per-league retirement marker on PlayerLeagueMembership.
--
-- `retiredAt` is a nullable timestamp:
--   NULL     ⇒ active member (every existing row at deploy time).
--   non-null ⇒ retired (the value records WHEN the admin retired this
--               player from this league).
--
-- The column is purely additive: every existing row defaults to NULL
-- (active), so no read site changes its return value at migration time.
-- Filtering for `retiredAt IS NULL` is opt-in per call site
-- (`plannedRosterStats.currentPlayers`, the admin teams-all `playerCount`,
-- the unpaid-fee banner).
--
-- Rollback:
--   ALTER TABLE "PlayerLeagueAssignment" DROP COLUMN "retiredAt";

ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "retiredAt" TIMESTAMP(3);
