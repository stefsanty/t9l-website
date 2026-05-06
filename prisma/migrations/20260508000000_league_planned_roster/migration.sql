-- v1.67.0 — Planned-roster fields on League.
--
-- Three additive columns surfaced by the new preseason stats panel:
--   - plannedPlayersPerTeam Int  default 0 (0 = not set)
--   - plannedNumberOfTeams  Int  default 0 (0 = not set)
--   - registrationDeadline  TIMESTAMPTZ nullable (no deadline by default)
--
-- Purely additive — no DROP, no ALTER COLUMN against existing data, no
-- destructive backfill. Existing rows pick up the column defaults.
--
-- Rollback recipe:
--   ALTER TABLE "League" DROP COLUMN "plannedPlayersPerTeam";
--   ALTER TABLE "League" DROP COLUMN "plannedNumberOfTeams";
--   ALTER TABLE "League" DROP COLUMN "registrationDeadline";

ALTER TABLE "League" ADD COLUMN "plannedPlayersPerTeam" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "League" ADD COLUMN "plannedNumberOfTeams"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "League" ADD COLUMN "registrationDeadline"  TIMESTAMP(3);
