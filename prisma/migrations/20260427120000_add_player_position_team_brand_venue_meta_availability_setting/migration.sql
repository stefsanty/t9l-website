-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('GOING', 'UNDECIDED', 'NOT_GOING');

-- CreateEnum
CREATE TYPE "ParticipatedStatus" AS ENUM ('JOINED', 'NO_SHOWED');

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "position" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "color" TEXT,
ADD COLUMN     "shortName" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "courtSize" TEXT,
ADD COLUMN     "url" TEXT;

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameWeekId" TEXT NOT NULL,
    "rsvp" "RsvpStatus",
    "participated" "ParticipatedStatus",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "leagueId" TEXT,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Availability_gameWeekId_idx" ON "Availability"("gameWeekId");

-- CreateIndex
CREATE INDEX "Availability_playerId_idx" ON "Availability"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Availability_playerId_gameWeekId_key" ON "Availability"("playerId", "gameWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_category_key_leagueId_key" ON "Setting"("category", "key", "leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_gameWeekId_homeTeamId_awayTeamId_key" ON "Match"("gameWeekId", "homeTeamId", "awayTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_name_key" ON "Venue"("name");

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_gameWeekId_fkey" FOREIGN KEY ("gameWeekId") REFERENCES "GameWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

