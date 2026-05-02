-- v1.34.0 (PR ζ of the onboarding chain) — public redemption flow foundation.
--
-- Purely additive. No data destruction, no constraint tightening:
--
--   1. CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_YET','COMPLETED'). Tracks
--      whether a Player has filled the onboarding form (name/position/
--      preferences) for this league. Existing rows are backfilled to
--      COMPLETED — they're already-active players who don't need to be
--      retroactively onboarded. New rows default to NOT_YET so admin
--      pre-stages and `/join/[code]` redemptions enter the flow.
--
--   2. CREATE TYPE "JoinSource" AS ENUM ('ADMIN','SELF_SERVE','CODE','PERSONAL').
--      Audit trail for how a Player came to be assigned to a league. Existing
--      rows are NULL (we don't know retroactively); new rows are tagged at
--      write time. Used by ζ + admin debugging + future abuse forensics.
--
--   3. PlayerLeagueAssignment.onboardingStatus + .joinSource columns wire
--      the two enums onto the assignment row.
--
--   4. Player.onboardingPreferences (jsonb, nullable) — captures the
--      free-form preference fields from the onboarding form (preferred
--      teammate IDs + "Other" free-text). JSON keeps the schema flexible
--      without committing to a specific column-per-field shape that PR ζ
--      may iterate on. Out of scope: indexing — these aren't queried.
--
-- Rollback recipe (none destructive against existing data):
--   ALTER TABLE "PlayerLeagueAssignment" DROP COLUMN "onboardingStatus";
--   ALTER TABLE "PlayerLeagueAssignment" DROP COLUMN "joinSource";
--   ALTER TABLE "Player"                 DROP COLUMN "onboardingPreferences";
--   DROP TYPE "OnboardingStatus";
--   DROP TYPE "JoinSource";

-- 1. Enums
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_YET', 'COMPLETED');
CREATE TYPE "JoinSource" AS ENUM ('ADMIN', 'SELF_SERVE', 'CODE', 'PERSONAL');

-- 2. PlayerLeagueAssignment additions
--    onboardingStatus is added with DEFAULT COMPLETED so existing rows backfill
--    to "already onboarded" (they predate this column; they're real players),
--    THEN flip the default to NOT_YET so future rows enter the redemption flow.
ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE "PlayerLeagueAssignment"
  ALTER COLUMN "onboardingStatus" SET DEFAULT 'NOT_YET';

ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "joinSource" "JoinSource";

-- 3. Player.onboardingPreferences
ALTER TABLE "Player" ADD COLUMN "onboardingPreferences" JSONB;
