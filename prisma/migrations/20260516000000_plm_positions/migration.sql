-- v1.82.0 — multi-position support on PlayerLeagueMembership.
--
-- Adds `positions text[]` (default '{}') and backfills from the legacy
-- `position` enum so existing read paths via the new array return a
-- value that's valid in the new 12-code soccer vocabulary.
--
-- The legacy `position` column stays for one release cycle (write-side
-- dual-write, read-side fallback); a future PR drops it.
--
-- Mapping (legacy `PlayerPosition` enum → new soccer-vocab default):
--   GK → GK   (unchanged)
--   DF → CB   (Center Back — middle-of-back-line default)
--   MF → CM   (Center Midfielder — generic-midfielder default)
--   FW → ST   (Striker — generic-forward default)
--
-- Why CB/CM/ST as defaults: they're the central / generalist code in
-- each band. A user whose pre-deploy position was the legacy generic
-- 'DF' will land on 'CB' in the new vocabulary — visible in the public
-- Squad list and editable from the account/player page (multi-select)
-- if they want the more specific LB/RB.
--
-- No futsal data exists at deploy time (no FUTSAL league has positions
-- set yet) so no FIXO/ALA/PIVOT mapping is needed.
--
-- Rollback:
--   ALTER TABLE "PlayerLeagueAssignment" DROP COLUMN "positions";

ALTER TABLE "PlayerLeagueAssignment"
  ADD COLUMN "positions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "PlayerLeagueAssignment"
   SET "positions" = ARRAY[CASE "position"::TEXT
                             WHEN 'GK' THEN 'GK'
                             WHEN 'DF' THEN 'CB'
                             WHEN 'MF' THEN 'CM'
                             WHEN 'FW' THEN 'ST'
                             ELSE "position"::TEXT
                           END]
 WHERE "position" IS NOT NULL
   AND ("positions" IS NULL OR cardinality("positions") = 0);
