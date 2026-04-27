-- Seed the two global Setting rows that the public-data dispatcher and the
-- RSVP route consume. Hardcoded ids let admin server actions upsert by id
-- without doing a findFirst-by-(category,key,leagueId=NULL) round trip.
--
-- ON CONFLICT (id) DO NOTHING makes this re-runnable.
-- Default values match the helpers in src/lib/settings.ts:
--   public.dataSource = 'sheets'  (apex still reads Google Sheets until PR 4)
--   public.writeMode  = 'dual'    (RSVP writes hit DB AND Sheets while we
--                                  build confidence; PR 5 flips to db-only)

INSERT INTO "Setting" (id, category, key, "leagueId", value, "updatedAt")
VALUES
  ('s-public-dataSource-global', 'public', 'dataSource', NULL, 'sheets', NOW()),
  ('s-public-writeMode-global',  'public', 'writeMode',  NULL, 'dual',   NOW())
ON CONFLICT (id) DO NOTHING;
