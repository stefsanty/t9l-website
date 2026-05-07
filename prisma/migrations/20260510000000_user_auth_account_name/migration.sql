-- v1.72.0 — User.authAccountName: preserve auth-provider-supplied name
-- separately from User.name (which now mirrors the linked Player's name).
--
-- Rollback recipe (in order):
--   1. UPDATE "User" SET "name" = "authAccountName" WHERE "authAccountName" IS NOT NULL;
--   2. ALTER TABLE "User" DROP COLUMN "authAccountName";

BEGIN;

-- 1. Add nullable column.
ALTER TABLE "User" ADD COLUMN "authAccountName" TEXT;

-- 2. Backfill: copy current User.name → authAccountName for every row
--    that has a name (the auth provider populated it at account creation).
UPDATE "User"
SET "authAccountName" = "name"
WHERE "name" IS NOT NULL;

-- 3. For users already linked to a Player, overwrite User.name with
--    Player.name so existing linked accounts are immediately consistent.
UPDATE "User" u
SET "name" = p."name"
FROM "Player" p
WHERE u."playerId" = p."id"
  AND u."playerId" IS NOT NULL
  AND p."name" IS NOT NULL;

COMMIT;
