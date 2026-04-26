-- Add new fields to League model
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "subdomain" TEXT;
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT;
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- Add unique index on subdomain
CREATE UNIQUE INDEX IF NOT EXISTS "League_subdomain_key" ON "League"("subdomain");

-- Add endedAt to Match
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);

-- Mark the first-created league as the default (the original imported league)
UPDATE "League"
SET "isDefault" = true
WHERE id = (SELECT id FROM "League" ORDER BY "createdAt" ASC LIMIT 1);
