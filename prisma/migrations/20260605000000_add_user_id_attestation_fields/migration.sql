-- v2.2.15 — external-ID attestation + admin-triggered re-upload request.
--
-- Adds 6 columns to "User" so admins can:
--   (a) mark users whose IDs were collected outside the app (e.g.
--       over WhatsApp) so they're never prompted to upload in-app;
--   (b) force any user to re-upload (e.g. when an existing ID is
--       expired) — onboarding's ID section flips to upload-mode on the
--       next form touchpoint.
--
-- All columns are nullable / boolean-defaulted-false. Purely additive;
-- no DROP, no ALTER COLUMN against existing data, no destructive
-- backfill. Safe online deployment.
--
-- Rollback recipe (if reverting v2.2.15):
--   ALTER TABLE "User" DROP COLUMN "idCollectedExternally";
--   ALTER TABLE "User" DROP COLUMN "idCollectedExternallyAt";
--   ALTER TABLE "User" DROP COLUMN "idCollectedExternallyNotes";
--   ALTER TABLE "User" DROP COLUMN "idReuploadRequested";
--   ALTER TABLE "User" DROP COLUMN "idReuploadRequestedAt";
--   ALTER TABLE "User" DROP COLUMN "idReuploadRequestedNotes";

ALTER TABLE "User" ADD COLUMN "idCollectedExternally"      BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "idCollectedExternallyAt"    TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "idCollectedExternallyNotes" TEXT;
ALTER TABLE "User" ADD COLUMN "idReuploadRequested"        BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "idReuploadRequestedAt"      TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "idReuploadRequestedNotes"   TEXT;
