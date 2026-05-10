-- v1.88.0 — Refactor "Guest" from a per-team pseudo-player on the roster
-- to an event-level concept on MatchEvent.
--
-- Schema changes (Prisma-generated via migrate diff; verified against
-- @@map table names in prisma/schema.prisma per the v1.86.0 post-mortem
-- in docs/migration-sql-lessons.md):
--   1. Add `MatchEvent.isGuestScorer Boolean @default(false)`
--      — when true, scorerId MUST be null and beneficiaryTeamId MUST be set.
--   2. Add `MatchEvent.isGuestAssister Boolean @default(false)`
--      — when true, assisterId MUST be null. (Disambiguates "no assist"
--        from "guest assist" without a third state on assisterId.)
--   3. Make `MatchEvent.scorerId` nullable (FK rebuilt with the
--      Prisma-default ON DELETE SET NULL for nullable scalars).
--
-- Data backfill (permitted UPDATE-only per migration-sql-lessons.md):
--   For each MatchEvent whose scorerId currently points at a Guest
--   pseudo-Player (id LIKE 'p-guest%'), populate beneficiaryTeamId
--   when null then null out scorerId + flip isGuestScorer=TRUE.
--   Same shape for guest assisters.
--
-- The destructive cleanup of the seeded Guest Player + their
-- PlayerLeagueAssignment rows lives in a separate operator-run script
-- `scripts/v188CleanupGuestPseudoPlayers.ts` per the migration-rules
-- checklist ("Migration does not contain ... DELETE FROM outside the
-- initial new_schema migration"). Schema migration is auto-applied by
-- `prisma migrate deploy` on prod; cleanup is gated behind operator
-- action with --apply.

-- DropForeignKey
ALTER TABLE "MatchEvent" DROP CONSTRAINT "MatchEvent_scorerId_fkey";

-- AlterTable
ALTER TABLE "MatchEvent" ADD COLUMN     "isGuestAssister" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isGuestScorer" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "scorerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_scorerId_fkey" FOREIGN KEY ("scorerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill beneficiaryTeamId for legacy guest-scorer events that have
-- it NULL. Derive from the guest's PlayerLeagueAssignment team:
--   non-OG → scorer's team is the beneficiary
--   OG     → opposing match team is the beneficiary
UPDATE "MatchEvent" me
SET "beneficiaryTeamId" = CASE
    WHEN me."goalType" = 'OWN_GOAL' THEN
      CASE
        WHEN plm."leagueTeamId" = m."homeTeamId" THEN m."awayTeamId"
        ELSE m."homeTeamId"
      END
    ELSE plm."leagueTeamId"
  END
FROM "PlayerLeagueAssignment" plm, "Match" m
WHERE m."id" = me."matchId"
  AND me."scorerId" LIKE 'p-guest%'
  AND me."beneficiaryTeamId" IS NULL
  AND plm."playerId" = me."scorerId"
  AND plm."leagueTeamId" IS NOT NULL;

-- Flip guest-scorer events: null out scorerId, set the flag.
UPDATE "MatchEvent"
SET "scorerId" = NULL,
    "isGuestScorer" = TRUE
WHERE "scorerId" LIKE 'p-guest%';

-- Flip guest-assister events: null out assisterId, set the flag.
UPDATE "MatchEvent"
SET "assisterId" = NULL,
    "isGuestAssister" = TRUE
WHERE "assisterId" LIKE 'p-guest%';
