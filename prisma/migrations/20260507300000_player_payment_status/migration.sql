-- v1.66.0 — Player payment status system.
--
-- Per outputs/v1.66.0-player-payment-status-spec.md. Adds:
--   1. New enum PaidStatus { PAID, UNPAID }
--   2. PlayerLeagueMembership: paidStatus + paidAt + feeOverride
--   3. League: defaultFee
--   4. New table LeaguePositionFee (per-league per-position fee overrides)
--
-- Purely additive migration. Every existing PLM row defaults to
-- paidStatus=UNPAID + paidAt=NULL + feeOverride=NULL. Every existing
-- League row defaults to defaultFee=0 (no-fee semantics — banner stays
-- hidden until an operator sets fees up).
--
-- Non-destructive:
--   - No DROP TABLE, no DROP COLUMN, no DROP TYPE.
--   - All new columns are either nullable or have a DEFAULT.
--
-- Rollback recipe:
--   ALTER TABLE "PlayerLeagueAssignment"
--     DROP COLUMN "feeOverride",
--     DROP COLUMN "paidAt",
--     DROP COLUMN "paidStatus";
--   ALTER TABLE "League" DROP COLUMN "defaultFee";
--   DROP TABLE "LeaguePositionFee";
--   DROP TYPE "PaidStatus";
--   + code revert.

-- 1. New enum.
CREATE TYPE "PaidStatus" AS ENUM ('PAID', 'UNPAID');

-- 2. New columns on PlayerLeagueAssignment (the SQL table name kept by
--    @@map("PlayerLeagueAssignment") on the PlayerLeagueMembership Prisma model).
ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "paidStatus" "PaidStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "feeOverride" INTEGER;

-- 3. New column on League.
ALTER TABLE "League" ADD COLUMN "defaultFee" INTEGER NOT NULL DEFAULT 0;

-- 4. New table LeaguePositionFee.
CREATE TABLE "LeaguePositionFee" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaguePositionFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaguePositionFee_leagueId_position_key"
    ON "LeaguePositionFee"("leagueId", "position");
CREATE INDEX "LeaguePositionFee_leagueId_idx" ON "LeaguePositionFee"("leagueId");

ALTER TABLE "LeaguePositionFee"
  ADD CONSTRAINT "LeaguePositionFee_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
