-- v1.31.0 — make GameWeek.startDate / endDate nullable so an admin can
-- "clear the date" on a matchday and have the public site display TBD.
--
-- Pure constraint relaxation: drops NOT NULL on two existing columns. No
-- existing rows mutate, no data loss. Reversal: `ALTER COLUMN ... SET NOT
-- NULL` once every row has a non-null value (won't be the case while the
-- TBD affordance is in use).

ALTER TABLE "GameWeek" ALTER COLUMN "startDate" DROP NOT NULL;
ALTER TABLE "GameWeek" ALTER COLUMN "endDate"   DROP NOT NULL;
