-- v1.94.0 — admin-toggleable "private join link" on leagues.
-- When true, the route at `/id/<slug>/join` mounts the standard league
-- page with the recruiting banner forced ON regardless of visibility.
-- Default-false preserves every existing league (route 404s).
-- Migration generated offline via:
--   npx prisma migrate diff --from-schema-datamodel <pre> --to-schema-datamodel <post> --script

-- AlterTable
ALTER TABLE "League" ADD COLUMN     "privateJoinLinkEnabled" BOOLEAN NOT NULL DEFAULT false;
