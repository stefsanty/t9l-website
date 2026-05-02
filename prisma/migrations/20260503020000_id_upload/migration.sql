-- v1.35.0 (PR η of the onboarding chain) — ID upload step.
--
-- Three additive nullable columns on `Player`. No data destruction:
--
--   1. Player.idFrontUrl     — Vercel Blob public URL of the ID's front side.
--   2. Player.idBackUrl      — Vercel Blob public URL of the ID's back side.
--   3. Player.idUploadedAt   — when the upload completed (or admin reset).
--
-- Why store as URL strings rather than blob bytes / a separate model:
--   - Vercel Blob is the canonical store; URLs are stable and CDN-cached.
--   - Two columns are simpler than a 1-Player → many-IdImage table given
--     the 2-image-max constraint (front + back).
--   - `idUploadedAt` is the timestamp gate: NULL = no upload yet (or admin
--     purged); non-NULL = both URLs were uploaded successfully.
--
-- Operator-side gate (NOT a blocker for the migration): the actual upload
-- requires the `BLOB_READ_WRITE_TOKEN` env var on Vercel. Without it,
-- `/join/[code]/id-upload` renders a "service unavailable, ask admin"
-- skip flow that flips `onboardingStatus` to COMPLETED without writing
-- any URLs. Admin can follow up out-of-band.
--
-- Rollback (purely additive — no data loss against existing rows):
--   ALTER TABLE "Player" DROP COLUMN "idFrontUrl";
--   ALTER TABLE "Player" DROP COLUMN "idBackUrl";
--   ALTER TABLE "Player" DROP COLUMN "idUploadedAt";

ALTER TABLE "Player" ADD COLUMN "idFrontUrl"   TEXT;
ALTER TABLE "Player" ADD COLUMN "idBackUrl"    TEXT;
ALTER TABLE "Player" ADD COLUMN "idUploadedAt" TIMESTAMP(3);
