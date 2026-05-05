-- v1.65.0 — Membership-spec rework, stage 1 (additive).
--
-- Per outputs/data-model-spec-audit.md §3 "Stage 1 — Schema additions".
-- This migration is purely additive at the column level; the model
-- rename `PlayerLeagueAssignment` → `PlayerLeagueMembership` is via
-- Prisma `@@map` so the SQL table name stays unchanged (zero DDL
-- rename).
--
-- Changes:
--   1. New enum `MembershipStatus { ACTIVE, INACTIVE, SUSPENDED }`.
--   2. New columns on `PlayerLeagueAssignment`:
--        - leagueId TEXT (nullable; backfilled from leagueTeam.leagueId)
--        - position "PlayerPosition" (nullable; backfilled from Player.position)
--        - jerseyNumber INTEGER (nullable; no backfill source)
--        - status "MembershipStatus" NOT NULL DEFAULT 'ACTIVE'
--        - applicationStatus "PlayerApplicationStatus" NOT NULL DEFAULT 'APPROVED'
--        - idShared BOOLEAN NOT NULL DEFAULT true
--   3. `leagueTeamId` becomes nullable (PENDING-application memberships
--      from v1.65.1 onward have no team assigned yet).
--   4. New column on `Player`: dob TIMESTAMP(3) NULL (per spec; no UI surface yet).
--   5. New table `PlayerLeagueStat` (empty; populated by future stats chain).
--
-- Non-destructive:
--   - No DROP TABLE, no DROP COLUMN, no DROP TYPE.
--   - One ALTER COLUMN (DROP NOT NULL on leagueTeamId) — safe; existing
--     rows all have non-null values, so the relaxation cannot lose data.
--     Rollback restores NOT NULL only after backfilling any nulls in PLM rows.
--
-- Backfills run inline with the schema changes so existing reads through
-- the new columns return the same value as the legacy columns:
--   - PLA.leagueId            ← LeagueTeam.leagueId (via leagueTeamId join)
--   - PLA.position            ← Player.position (via playerId join)
--   - PLA.applicationStatus stays at the column DEFAULT 'APPROVED' for
--     every existing row. Pending applications today live as Player rows
--     with applicationStatus=PENDING and no PLA — when v1.65.1 dual-write
--     ships, those will get a PLA created with applicationStatus=PENDING,
--     so no backfill needed here.
--   - PLA.status              column DEFAULT 'ACTIVE' for every existing row.
--   - PLA.idShared            column DEFAULT true for every existing row.
--
-- Rollback recipe:
--   ALTER TABLE "PlayerLeagueAssignment"
--     DROP COLUMN "idShared",
--     DROP COLUMN "applicationStatus",
--     DROP COLUMN "status",
--     DROP COLUMN "jerseyNumber",
--     DROP COLUMN "position",
--     DROP COLUMN "leagueId";
--   -- Restoring NOT NULL on leagueTeamId requires no nulls in column.
--   -- v1.65.1+ creates PLM rows with leagueTeamId=NULL for PENDING apps;
--   -- those must be cleaned up before this rollback.
--   ALTER TABLE "PlayerLeagueAssignment" ALTER COLUMN "leagueTeamId" SET NOT NULL;
--   DROP TYPE "MembershipStatus";
--   ALTER TABLE "Player" DROP COLUMN "dob";
--   DROP TABLE "PlayerLeagueStat";

-- 1. New enum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- 2. Add columns to PlayerLeagueAssignment
ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "leagueId" TEXT,
  ADD COLUMN "position" "PlayerPosition",
  ADD COLUMN "jerseyNumber" INTEGER,
  ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "applicationStatus" "PlayerApplicationStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "idShared" BOOLEAN NOT NULL DEFAULT true;

-- 3. Drop NOT NULL on leagueTeamId so PENDING-app PLMs (v1.65.1+) can have null teams.
ALTER TABLE "PlayerLeagueAssignment" ALTER COLUMN "leagueTeamId" DROP NOT NULL;

-- 4. Backfill leagueId from the LeagueTeam join. Every existing PLA has a
--    non-null leagueTeamId (we haven't created PENDING-app rows yet), so
--    this UPDATE populates leagueId for every row.
UPDATE "PlayerLeagueAssignment" pla
   SET "leagueId" = lt."leagueId"
  FROM "LeagueTeam" lt
 WHERE pla."leagueTeamId" = lt."id";

-- 5. Backfill position from Player.position. Same join shape — every PLA
--    has a Player; we copy whatever position the Player carries (may be NULL).
UPDATE "PlayerLeagueAssignment" pla
   SET "position" = p."position"
  FROM "Player" p
 WHERE pla."playerId" = p."id";

-- 6. Add the FK constraint for the new leagueId column. Cascade on League
--    delete mirrors the existing leagueTeam.league relationship.
ALTER TABLE "PlayerLeagueAssignment"
  ADD CONSTRAINT "PlayerLeagueAssignment_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Index on leagueId for the per-league lookups (admin Players tab,
--    pending-applications query, recruiting viewer state).
CREATE INDEX "PlayerLeagueAssignment_leagueId_idx" ON "PlayerLeagueAssignment"("leagueId");

-- 8. New column on Player: dob (date of birth). Per spec
--    ("profile-level data: name, avatar, DOB"). Nullable — historical
--    rows have no DOB and no UI surface populates it yet at v1.65.0.
ALTER TABLE "Player" ADD COLUMN "dob" TIMESTAMP(3);

-- 9. New table for per-league aggregate stats. Empty at v1.65.0.
--    No code reads or writes this table until a future stats-recompute
--    chain wires it up. Keyed on (playerId, leagueId, seasonId?) so a
--    player's stats can be reset per season without touching membership.
CREATE TABLE "PlayerLeagueStat" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "yellowCards" INTEGER NOT NULL DEFAULT 0,
    "redCards" INTEGER NOT NULL DEFAULT 0,
    "appearances" INTEGER NOT NULL DEFAULT 0,
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerLeagueStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerLeagueStat_playerId_leagueId_seasonId_key"
    ON "PlayerLeagueStat"("playerId", "leagueId", "seasonId");
CREATE INDEX "PlayerLeagueStat_leagueId_idx" ON "PlayerLeagueStat"("leagueId");
CREATE INDEX "PlayerLeagueStat_playerId_idx" ON "PlayerLeagueStat"("playerId");

ALTER TABLE "PlayerLeagueStat"
  ADD CONSTRAINT "PlayerLeagueStat_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerLeagueStat"
  ADD CONSTRAINT "PlayerLeagueStat_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
