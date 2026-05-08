-- v1.81.0 — League details extras: skillLevel, shoeTypes, shinguardPolicy,
-- totalMatches.
--
-- Adds two new enums (SkillLevel, ShinguardPolicy) and four new columns
-- to the League table. All four are nullable / default-empty so existing
-- rows backfill to a no-op state and the public LeagueDetailsPanel
-- renders "TBD" for any unset row instead of a misleading default.
--
-- Purely additive — no DROP, no ALTER COLUMN against existing data.
--
-- Rollback recipe:
--   ALTER TABLE "League"
--     DROP COLUMN "skillLevel",
--     DROP COLUMN "shoeTypes",
--     DROP COLUMN "shinguardPolicy",
--     DROP COLUMN "totalMatches";
--   DROP TYPE "SkillLevel";
--   DROP TYPE "ShinguardPolicy";

CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'MIXED', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "ShinguardPolicy" AS ENUM ('MANDATORY', 'VOLUNTARY');

ALTER TABLE "League" ADD COLUMN "skillLevel"      "SkillLevel";
ALTER TABLE "League" ADD COLUMN "shoeTypes"       TEXT[]            NOT NULL DEFAULT '{}';
ALTER TABLE "League" ADD COLUMN "shinguardPolicy" "ShinguardPolicy";
ALTER TABLE "League" ADD COLUMN "totalMatches"    INTEGER;
