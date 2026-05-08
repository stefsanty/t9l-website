-- v1.81.0 — per-league `idRequired` toggle controlling whether the
-- recruiting / onboarding registration form collects ID photos.
--
-- Defaults true so every existing league row backfills to the v1.70.0
-- always-on behavior. Admins can flip the column off for leagues that
-- don't need ID-on-file; the registration form omits the ID segment
-- and the server actions accept submissions without ID.
--
-- Purely additive — no DROP, no ALTER COLUMN, no data rewrite. Existing
-- `User.idFrontUrl` / `User.idBackUrl` / `User.idUploadedAt` rows are
-- untouched.
--
-- Rollback recipe:
--   ALTER TABLE "League" DROP COLUMN "idRequired";

ALTER TABLE "League" ADD COLUMN "idRequired" BOOLEAN NOT NULL DEFAULT true;
