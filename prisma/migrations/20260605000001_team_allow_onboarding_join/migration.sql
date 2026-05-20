-- v2.2.16 — per-team "allow onboarding join" toggle.
--
-- Adds `Team.allowOnboardingJoin BOOLEAN NOT NULL DEFAULT true` so
-- admins can opt premade teams OUT of the onboarding team-picker
-- (the picker introduced in v2.2.9). Default true preserves
-- backward compat: every existing team remains selectable.
--
-- Filtered server-side in `getTeamPickerOptions` (the picker data
-- source) and re-validated in `completeOnboardingWithId` and the
-- recruit `registerToLeague` write path.
--
-- Purely additive: no DROP, no ALTER COLUMN against existing data,
-- no destructive backfill. Default applies to every existing row.
--
-- Rollback recipe (if reverting v2.2.16):
--   ALTER TABLE "Team" DROP COLUMN "allowOnboardingJoin";

ALTER TABLE "Team" ADD COLUMN "allowOnboardingJoin" BOOLEAN NOT NULL DEFAULT true;
