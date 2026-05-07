-- v1.75.0 — League details surface.
--
-- Adds three enums and ten columns to League so admins can configure
-- match-format details (ball type, goal size, throw-in vs kick-in,
-- offside / backpass rules, match duration, player format, sub policy,
-- organizer message) and choose whether to surface them on the public
-- preseason homepage via the new `LeagueDetailsPanel`.
--
-- Purely additive — every existing league row backfills to safe
-- defaults that match the pre-v1.75.0 implicit assumption (soccer with
-- throw-ins, full-size goals, offside ON, backpass ON, unlimited subs,
-- visible on the preseason homepage). No DROP, no ALTER COLUMN against
-- existing data.
--
-- Rollback recipe:
--   ALTER TABLE "League"
--     DROP COLUMN "ballType",
--     DROP COLUMN "goalSize",
--     DROP COLUMN "throwInType",
--     DROP COLUMN "offsideRule",
--     DROP COLUMN "backpassRule",
--     DROP COLUMN "matchDurationMinutes",
--     DROP COLUMN "playerFormat",
--     DROP COLUMN "unlimitedSubstitutions",
--     DROP COLUMN "organizerMessage",
--     DROP COLUMN "showLeagueDetails";
--   DROP TYPE "BallType";
--   DROP TYPE "GoalSize";
--   DROP TYPE "ThrowInType";

CREATE TYPE "BallType" AS ENUM ('SOCCER', 'FUTSAL');
CREATE TYPE "GoalSize" AS ENUM ('FUTSAL', 'YOUTH_SOCCER', 'FULL_SIZE_SOCCER');
CREATE TYPE "ThrowInType" AS ENUM ('THROW_IN', 'KICK_IN');

ALTER TABLE "League" ADD COLUMN "ballType"               "BallType"    NOT NULL DEFAULT 'SOCCER';
ALTER TABLE "League" ADD COLUMN "goalSize"               "GoalSize"    NOT NULL DEFAULT 'FULL_SIZE_SOCCER';
ALTER TABLE "League" ADD COLUMN "throwInType"            "ThrowInType" NOT NULL DEFAULT 'THROW_IN';
ALTER TABLE "League" ADD COLUMN "offsideRule"            BOOLEAN       NOT NULL DEFAULT true;
ALTER TABLE "League" ADD COLUMN "backpassRule"           BOOLEAN       NOT NULL DEFAULT true;
ALTER TABLE "League" ADD COLUMN "matchDurationMinutes"   INTEGER;
ALTER TABLE "League" ADD COLUMN "playerFormat"           INTEGER;
ALTER TABLE "League" ADD COLUMN "unlimitedSubstitutions" BOOLEAN       NOT NULL DEFAULT true;
ALTER TABLE "League" ADD COLUMN "organizerMessage"       TEXT;
ALTER TABLE "League" ADD COLUMN "showLeagueDetails"      BOOLEAN       NOT NULL DEFAULT true;
