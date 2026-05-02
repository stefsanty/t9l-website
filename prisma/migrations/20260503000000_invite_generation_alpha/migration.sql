-- v1.33.0 (PR ε of the onboarding chain) — Admin invite generation.
--
-- Three additive / constraint-relaxing changes; no destructive column drops
-- against existing data:
--
--   1. CREATE TYPE "PlayerPosition" AS ENUM ('GK','DF','MF','FW') — formal
--      enum for the four valid roles. Pre-ε `Player.position` was a free-form
--      `String?` populated from the Sheets backfill; the actual column values
--      observed in prod are exactly the four enum literals (or NULL for FC
--      Torpedo + admins-not-yet-set). The migration backfills via CASE WHEN
--      so any unexpected free-text values land as NULL rather than throwing.
--
--   2. `Player.name` becomes nullable. Pre-ε admins had to type a name to
--      create a Player; ε lets admins pre-stage rows where only the team is
--      known (the player will fill their own name during onboarding via
--      PR ζ's `/join/[code]` flow).
--
--   3. `LeagueInvite.skipOnboarding` boolean (default false) — when true,
--      redemption (PR ζ) bypasses the onboarding form and binds the User
--      to the targetPlayer immediately. Used for high-trust pre-staged
--      invites where the admin already has the player's data.
--
-- Rollback (none of these is data-destructive against current rows):
--   - For #1: `ALTER TABLE "Player" ALTER COLUMN "position" TYPE TEXT USING "position"::text; DROP TYPE "PlayerPosition";`
--   - For #2: `ALTER TABLE "Player" ALTER COLUMN "name" SET NOT NULL;` — only safe if no rows have name=NULL by then.
--   - For #3: `ALTER TABLE "LeagueInvite" DROP COLUMN "skipOnboarding";`

-- 1. Player.position → enum
CREATE TYPE "PlayerPosition" AS ENUM ('GK', 'DF', 'MF', 'FW');

ALTER TABLE "Player" ADD COLUMN "positionEnum" "PlayerPosition";

UPDATE "Player"
SET "positionEnum" = CASE
  WHEN "position" = 'GK' THEN 'GK'::"PlayerPosition"
  WHEN "position" = 'DF' THEN 'DF'::"PlayerPosition"
  WHEN "position" = 'MF' THEN 'MF'::"PlayerPosition"
  WHEN "position" = 'FW' THEN 'FW'::"PlayerPosition"
  ELSE NULL
END;

ALTER TABLE "Player" DROP COLUMN "position";
ALTER TABLE "Player" RENAME COLUMN "positionEnum" TO "position";

-- 2. Player.name nullable
ALTER TABLE "Player" ALTER COLUMN "name" DROP NOT NULL;

-- 3. LeagueInvite.skipOnboarding
ALTER TABLE "LeagueInvite" ADD COLUMN "skipOnboarding" BOOLEAN NOT NULL DEFAULT false;
