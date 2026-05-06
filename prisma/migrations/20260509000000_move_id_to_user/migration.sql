-- v1.70.0 — Move ID images from Player to User.
--
-- Identity proof (driver's license / passport photos) is per-person,
-- not per-league. One person, one ID. Currently `Player.idFrontUrl` /
-- `Player.idBackUrl` / `Player.idUploadedAt` could differ across a
-- User's Players in different leagues — the post-v1.65.x model allows
-- multiple PlayerLeagueMemberships per User but ID is on Player which
-- became the global identity in v1.65.x. So ID should live on User.
--
-- Migration shape (single transaction):
--   1. ADD `User.idFrontUrl` / `idBackUrl` / `idUploadedAt`.
--   2. BACKFILL: copy from each Player's columns to its linked User
--      via `Player.userId`. For Users with multiple Players (defensive;
--      should not happen post-v1.65), prefer the most recent
--      `idUploadedAt`.
--   3. DROP the three columns from Player.
--
-- Rollback recipe (destructive — re-adding columns then back-copying):
--   ALTER TABLE "Player" ADD COLUMN "idFrontUrl" TEXT;
--   ALTER TABLE "Player" ADD COLUMN "idBackUrl" TEXT;
--   ALTER TABLE "Player" ADD COLUMN "idUploadedAt" TIMESTAMP(3);
--   UPDATE "Player" SET
--     "idFrontUrl"   = "User"."idFrontUrl",
--     "idBackUrl"    = "User"."idBackUrl",
--     "idUploadedAt" = "User"."idUploadedAt"
--   FROM "User" WHERE "Player"."userId" = "User"."id";
--   ALTER TABLE "User" DROP COLUMN "idFrontUrl";
--   ALTER TABLE "User" DROP COLUMN "idBackUrl";
--   ALTER TABLE "User" DROP COLUMN "idUploadedAt";

-- Step 1: ADD columns on User.
ALTER TABLE "User" ADD COLUMN "idFrontUrl"   TEXT;
ALTER TABLE "User" ADD COLUMN "idBackUrl"    TEXT;
ALTER TABLE "User" ADD COLUMN "idUploadedAt" TIMESTAMP(3);

-- Step 2: BACKFILL from Player → User via Player.userId.
-- For Users linked to multiple Players (defensive — the v1.65.x rework
-- enforces 1:1 via Player.userId @unique + User.playerId @unique, but
-- belt-and-suspenders), DISTINCT ON picks the row with the most recent
-- idUploadedAt (NULLS LAST so a real upload beats no-upload).
UPDATE "User" u
SET
  "idFrontUrl"   = src."idFrontUrl",
  "idBackUrl"    = src."idBackUrl",
  "idUploadedAt" = src."idUploadedAt"
FROM (
  SELECT DISTINCT ON ("userId")
    "userId",
    "idFrontUrl",
    "idBackUrl",
    "idUploadedAt"
  FROM "Player"
  WHERE "userId" IS NOT NULL
    AND "idUploadedAt" IS NOT NULL
  ORDER BY "userId", "idUploadedAt" DESC NULLS LAST
) src
WHERE u."id" = src."userId";

-- Step 3: DROP the columns from Player.
ALTER TABLE "Player" DROP COLUMN "idFrontUrl";
ALTER TABLE "Player" DROP COLUMN "idBackUrl";
ALTER TABLE "Player" DROP COLUMN "idUploadedAt";
