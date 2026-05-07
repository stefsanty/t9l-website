-- v1.75.7 — Goal kick type field.
--
-- Adds GoalKickType enum and League.goalKickType so admins can specify
-- whether goal kicks in their league are taken as throws (handball-style)
-- or kicks (standard association football / futsal). Default is KICK
-- (correct for both 9-a-side soccer and futsal).
--
-- Purely additive — every existing league backfills to 'KICK' which is
-- the standard for any football-derived format. No DROP, no ALTER COLUMN.
--
-- Rollback recipe:
--   ALTER TABLE "League" DROP COLUMN "goalKickType";
--   DROP TYPE "GoalKickType";

CREATE TYPE "GoalKickType" AS ENUM ('THROW', 'KICK');
ALTER TABLE "League" ADD COLUMN "goalKickType" "GoalKickType" NOT NULL DEFAULT 'KICK';
