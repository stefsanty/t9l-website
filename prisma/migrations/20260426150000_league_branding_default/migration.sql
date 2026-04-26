-- AlterTable: per-league branding + default-league flag
ALTER TABLE "League" ADD COLUMN "primaryColor" TEXT,
ADD COLUMN "accentColor" TEXT,
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Index used by getDefaultLeague() lookup at request time
CREATE INDEX "League_isDefault_idx" ON "League"("isDefault");
