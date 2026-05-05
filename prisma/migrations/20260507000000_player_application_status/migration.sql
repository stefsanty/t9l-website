-- v1.64.0 — Application/recruiting workflow.
--
-- Purely additive migration:
--   1. New enum `PlayerApplicationStatus { APPROVED, PENDING }`.
--   2. Two new columns on `Player`:
--        - `applicationStatus`: NOT NULL DEFAULT 'APPROVED' so every
--          existing row backfills to "real roster member" (the default
--          state pre-v1.64.0 — there were no applications). New rows
--          created via the recruiting banner get 'PENDING' explicitly.
--        - `applicationLeagueId`: nullable. NULL on existing rows;
--          set to the target League.id on new application Player rows
--          so admin knows which league the application is for.
--
-- Non-destructive: no DROP, no ALTER COLUMN against existing data,
-- no NOT NULL added without DEFAULT.
--
-- Rollback recipe:
--   ALTER TABLE "Player" DROP COLUMN "applicationStatus";
--   ALTER TABLE "Player" DROP COLUMN "applicationLeagueId";
--   DROP TYPE "PlayerApplicationStatus";
-- + code revert.

CREATE TYPE "PlayerApplicationStatus" AS ENUM ('APPROVED', 'PENDING');

ALTER TABLE "Player"
  ADD COLUMN "applicationStatus" "PlayerApplicationStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "applicationLeagueId" TEXT;
