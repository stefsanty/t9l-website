-- v2.2.9 — per-league "allow player team pick" toggle.
--
-- Adds `League.allowPlayerTeamPick BOOLEAN NOT NULL DEFAULT false` so
-- admins can opt-in to letting players choose their team during onboarding.
-- Default false preserves backward compat — every existing league sees the
-- unchanged onboarding flow.
--
-- When true, `/join/[code]/onboarding` renders a team-picker step before
-- the ID section. The server action `completeOnboardingWithId` accepts a
-- `chosenTeamId` (validated to belong to the invite's league, or null for
-- "balanced team — assign me later").
--
-- Purely additive: no DROP, no ALTER COLUMN against existing data, no
-- destructive backfill.
--
-- Rollback recipe (if reverting v2.2.9):
--   ALTER TABLE "League" DROP COLUMN "allowPlayerTeamPick";

ALTER TABLE "League" ADD COLUMN "allowPlayerTeamPick" BOOLEAN NOT NULL DEFAULT false;
