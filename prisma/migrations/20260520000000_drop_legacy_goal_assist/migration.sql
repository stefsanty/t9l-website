-- v1.90.0 — Step 2 of legacy table cleanup. Drop the orphaned `Goal` and
-- `Assist` tables. Step 1 (PR #255 / v1.89.0) removed every writer + reader
-- from the codebase; the tables have carried no production-readable data
-- since v1.42.0 made MatchEvent the canonical source for goal/assist
-- attribution. The Sheets backfill mirror rows surfaced in the audit
-- (`wk1-mariners-fc-vs-fenix-fc-7` Goal + 4 Goal mirrors + 3 Assist
-- mirrors pointing at legacy `p-guest`) vanish with the tables — operator
-- confirmed (option 2 from the cleanup brief — keep recomputed score 2-2).
--
-- SQL generated via `prisma migrate diff --from-schema-datamodel <pre> \
--   --to-schema-datamodel prisma/schema.prisma --script` (offline diff
-- between the v1.89.1 schema and the post-edit schema). Per the v1.86.1
-- post-mortem in docs/migration-sql-lessons.md: NEVER hand-author migration
-- SQL — Prisma resolves @@map / @map; hand-authored statements do not.
-- These two tables have no @@map override, so the SQL identifiers happen
-- to match the model names, but the rule still stands: this file came
-- straight out of Prisma.

-- DropForeignKey
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_matchId_fkey";

-- DropForeignKey
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_playerId_fkey";

-- DropForeignKey
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_scoringTeamId_fkey";

-- DropForeignKey
ALTER TABLE "Assist" DROP CONSTRAINT "Assist_matchId_fkey";

-- DropForeignKey
ALTER TABLE "Assist" DROP CONSTRAINT "Assist_playerId_fkey";

-- DropForeignKey
ALTER TABLE "Assist" DROP CONSTRAINT "Assist_goalId_fkey";

-- DropTable
DROP TABLE "Goal";

-- DropTable
DROP TABLE "Assist";
