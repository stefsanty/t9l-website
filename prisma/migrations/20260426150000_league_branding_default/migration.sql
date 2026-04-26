-- Per-league branding + default-league flag.
-- Idempotent so it stays harmless on dev DBs that already received the same
-- columns via a parallel migration on the dev branch.
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT;
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "accentColor"  TEXT;
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "isDefault"    BOOLEAN NOT NULL DEFAULT false;

-- Index used by the apex-domain default-league lookup at request time
CREATE INDEX IF NOT EXISTS "League_isDefault_idx" ON "League"("isDefault");
