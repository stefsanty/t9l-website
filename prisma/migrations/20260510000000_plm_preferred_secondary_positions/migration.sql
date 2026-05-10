-- v1.86.0: Split PlayerLeagueMembership.positions[] into
-- preferredPositions[] + secondaryPositions[].
-- Backfill: preferredPositions ← existing positions[] (conservative:
-- all existing positions are treated as preferred; players opt-in to
-- secondary by editing their account page).
-- secondaryPositions starts empty for all existing rows.

ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "preferredPositions" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "secondaryPositions" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "PlayerLeagueAssignment"
  SET "preferredPositions" = "positions"
  WHERE array_length("positions", 1) IS NOT NULL;
