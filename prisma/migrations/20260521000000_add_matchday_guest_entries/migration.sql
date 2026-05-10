-- CreateTable
CREATE TABLE "MatchdayGuestEntry" (
    "id" TEXT NOT NULL,
    "gameWeekId" TEXT NOT NULL,
    "leagueTeamId" TEXT NOT NULL,
    "externalCount" INTEGER NOT NULL DEFAULT 0,
    "leagueCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchdayGuestEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchdayGuestEntry_gameWeekId_idx" ON "MatchdayGuestEntry"("gameWeekId");

-- CreateIndex
CREATE INDEX "MatchdayGuestEntry_leagueTeamId_idx" ON "MatchdayGuestEntry"("leagueTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchdayGuestEntry_gameWeekId_leagueTeamId_key" ON "MatchdayGuestEntry"("gameWeekId", "leagueTeamId");

-- AddForeignKey
ALTER TABLE "MatchdayGuestEntry" ADD CONSTRAINT "MatchdayGuestEntry_gameWeekId_fkey" FOREIGN KEY ("gameWeekId") REFERENCES "GameWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchdayGuestEntry" ADD CONSTRAINT "MatchdayGuestEntry_leagueTeamId_fkey" FOREIGN KEY ("leagueTeamId") REFERENCES "LeagueTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchdayGuestEntry" ADD CONSTRAINT "MatchdayGuestEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

