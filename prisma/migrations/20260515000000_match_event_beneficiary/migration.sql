-- v1.82.0 — record explicit beneficiary team on MatchEvent rows so the
-- score recompute path can attribute cross-team (guest) scorers to the
-- correct side. Pre-v1.82.0 the score logic mapped `scorerId → scorer's
-- LeagueTeam` and flipped for OG; that assumed the scorer was on one of
-- the match's two teams, which casual leagues break (a player from
-- Team C can guest for Team A and score for Team A).
--
-- Nullable for backward compat: legacy rows leave it null; the recompute
-- falls back to the pre-v1.82.0 scorer-team derivation when null. New
-- writes (player self-report + admin CRUD) populate it from the form's
-- "Goal counts for" selector.
--
-- Rollback:
--   ALTER TABLE "MatchEvent" DROP CONSTRAINT "MatchEvent_beneficiaryTeamId_fkey";
--   DROP INDEX "MatchEvent_beneficiaryTeamId_idx";
--   ALTER TABLE "MatchEvent" DROP COLUMN "beneficiaryTeamId";

ALTER TABLE "MatchEvent" ADD COLUMN "beneficiaryTeamId" TEXT;

CREATE INDEX "MatchEvent_beneficiaryTeamId_idx" ON "MatchEvent"("beneficiaryTeamId");

ALTER TABLE "MatchEvent"
  ADD CONSTRAINT "MatchEvent_beneficiaryTeamId_fkey"
  FOREIGN KEY ("beneficiaryTeamId") REFERENCES "LeagueTeam"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
