-- v1.80.0 — add optional free-text comments column to PlayerLeagueAssignment
-- (Prisma model name: PlayerLeagueMembership). Per-league because the same
-- user might write different notes when applying to different leagues.
--
-- TEXT type (no varchar cap) so applicants can write as much as needed.
-- Nullable — existing rows have no comments; new rows populate only when
-- the user fills the field.
--
-- Rollback:
--   ALTER TABLE "PlayerLeagueAssignment" DROP COLUMN "comments";

ALTER TABLE "PlayerLeagueAssignment" ADD COLUMN "comments" TEXT;
