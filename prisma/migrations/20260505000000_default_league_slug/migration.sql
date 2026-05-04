-- v1.50.0 — path-based routing scaffold (PR 1 of the path-routing chain).
--
-- Background: pre-v1.50.0 the `League.subdomain` column was used by the
-- v1.22.0–v1.26.0 host-header-derived multi-tenant resolver. With path-based
-- routing (this PR), the same value semantically becomes the URL path slug
-- (`/league/<slug>` and `/<slug>` both resolve via this column). The schema
-- column name stays `subdomain` for now — PR 4 (v1.53.0) tears down the
-- subdomain functionality and may rename the column to `slug` then.
--
-- This migration is purely a data backfill: it ensures the default league
-- has a non-null slug ('t9l') so that `/t9l` and `/league/t9l` resolve from
-- day one of the alias trio (`/`, `/t9l`, `/league/t9l`). Without this,
-- visitors typing `/t9l` would see the route's notFound() surface even
-- though apex `/` correctly serves the same league.
--
-- Idempotent: only updates when the default league's subdomain is currently
-- NULL. If admin has manually set a value (e.g. from a prior multi-tenant
-- experiment), it is preserved.
--
-- Rollback recipe:
--   UPDATE "League" SET "subdomain" = NULL
--     WHERE "isDefault" = TRUE AND "subdomain" = 't9l';
-- Code revert restores the pre-v1.50.0 routing surface (no /league/[slug],
-- no /[slug] catch-all). The column itself is untouched by this migration.

UPDATE "League"
SET "subdomain" = 't9l'
WHERE "isDefault" = TRUE
  AND "subdomain" IS NULL;
