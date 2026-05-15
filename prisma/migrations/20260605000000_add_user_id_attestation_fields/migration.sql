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
-- Also adds 2 columns to "LeagueInvite" so admins can pre-mark a new
-- invite as belonging to a user whose ID is held outside the app. On
-- redemption the bound User row inherits `idCollectedExternally=true`
-- (idempotent — never overwrites an already-true flag).
--
-- Rollback recipe (if reverting v2.2.15):
--   ALTER TABLE "User" DROP COLUMN "idCollectedExternally";
--   ALTER TABLE "User" DROP COLUMN "idCollectedExternallyAt";
--   ALTER TABLE "User" DROP COLUMN "idCollectedExternallyNotes";
--   ALTER TABLE "User" DROP COLUMN "idReuploadRequested";
--   ALTER TABLE "User" DROP COLUMN "idReuploadRequestedAt";
--   ALTER TABLE "User" DROP COLUMN "idReuploadRequestedNotes";
--   ALTER TABLE "LeagueInvite" DROP COLUMN "presetIdCollectedExternally";
--   ALTER TABLE "LeagueInvite" DROP COLUMN "presetIdCollectedExternallyNotes";

ALTER TABLE "User" ADD COLUMN "idCollectedExternally"      BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "idCollectedExternallyAt"    TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "idCollectedExternallyNotes" TEXT;
ALTER TABLE "User" ADD COLUMN "idReuploadRequested"        BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "idReuploadRequestedAt"      TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "idReuploadRequestedNotes"   TEXT;

ALTER TABLE "LeagueInvite" ADD COLUMN "presetIdCollectedExternally"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeagueInvite" ADD COLUMN "presetIdCollectedExternallyNotes" TEXT;
