-- v1.42.0 — Epic match events PR α: additive schema for MatchEvent + Match.scoreOverride.
--
-- Purely additive. No DROP, no ALTER COLUMN against existing rows. Existing
-- Goal + Assist tables are untouched and continue to back the public read
-- paths (StatsTab, dbToPublicLeagueData) until PR δ flips reads to events.
--
-- Rollback recipe (if ever needed):
--   DROP TABLE "MatchEvent";
--   DROP TYPE "EventKind";
--   DROP TYPE "GoalType";
--   ALTER TABLE "Match" DROP COLUMN "scoreOverride";

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('GOAL');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('OPEN_PLAY', 'SET_PIECE', 'PENALTY', 'OWN_GOAL');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "scoreOverride" TEXT;

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'GOAL',
    "goalType" "GoalType",
    "scorerId" TEXT NOT NULL,
    "assisterId" TEXT,
    "minute" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");

-- CreateIndex
CREATE INDEX "MatchEvent_scorerId_idx" ON "MatchEvent"("scorerId");

-- CreateIndex
CREATE INDEX "MatchEvent_assisterId_idx" ON "MatchEvent"("assisterId");

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_scorerId_fkey" FOREIGN KEY ("scorerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_assisterId_fkey" FOREIGN KEY ("assisterId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
