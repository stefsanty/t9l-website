-- v1.73.0: add League.abbreviation for header home button + page title.
-- Nullable so leagues created before this migration display League.name
-- as fallback without requiring an immediate admin edit.

ALTER TABLE "League" ADD COLUMN "abbreviation" TEXT;

-- Backfill the default T9L league with the text currently hardcoded in
-- Header.tsx ("T9L '26 春"). All other leagues start null and fall back
-- to League.name in the rendered header and page title.
UPDATE "League"
SET "abbreviation" = 'T9L ''26 春'
WHERE "isDefault" = true;
