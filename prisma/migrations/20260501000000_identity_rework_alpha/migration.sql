-- Identity rework α (v1.27.0) — additive schema only.
-- See outputs/account-player-rework-plan.md for the full plan.
--
-- This migration is purely additive:
--   - User.playerId          (nullable @unique) — 1:1 link to canonical Player
--   - Player.userId          (nullable @unique) — mirror of User.playerId
--   - LeagueInvite           (new table)         — code/personal join gates
--   - InviteKind             (new enum)          — CODE | PERSONAL
--
-- No FK between User and Player yet (stage 2 wires the @relation). No code
-- in src/ reads or writes any of these columns/tables in this stage.
--
-- Rollback: drop the columns/table/enum. The stage 1 schema is fully
-- revertible via `DROP COLUMN` / `DROP TABLE` / `DROP TYPE`.

-- AlterTable: add User.playerId
ALTER TABLE "User" ADD COLUMN "playerId" TEXT;
CREATE UNIQUE INDEX "User_playerId_key" ON "User"("playerId");

-- AlterTable: add Player.userId
ALTER TABLE "Player" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "Player_userId_key" ON "Player"("userId");

-- CreateEnum: InviteKind
CREATE TYPE "InviteKind" AS ENUM ('CODE', 'PERSONAL');

-- CreateTable: LeagueInvite
CREATE TABLE "LeagueInvite" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "targetPlayerId" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeagueInvite_code_key" ON "LeagueInvite"("code");
CREATE INDEX "LeagueInvite_leagueId_idx" ON "LeagueInvite"("leagueId");
CREATE INDEX "LeagueInvite_code_idx" ON "LeagueInvite"("code");

-- AddForeignKey: LeagueInvite.leagueId → League.id
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
