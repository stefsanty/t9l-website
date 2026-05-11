-- v1.93.0 — per-league ID-document requirement during onboarding.
-- Default-true preserves every existing league's behavior; admins can
-- toggle to false on the League details settings page.
-- Migration generated offline via:
--   npx prisma migrate diff --from-schema-datamodel <pre> --to-schema-datamodel <post> --script

-- AlterTable
ALTER TABLE "League" ADD COLUMN     "idRequired" BOOLEAN NOT NULL DEFAULT true;
