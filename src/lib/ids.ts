/**
 * Single source of truth for the DB-id ↔ public-slug mapping.
 *
 * The PR 6 backfill prefixes every DB row id with a one-letter type tag:
 *   `Player.id`     →  "p-<slug>"   e.g. "p-ian-noseda"
 *   `Team.id`       →  "t-<slug>"   e.g. "t-mariners-fc"
 *
 * The public-facing shape (as produced by `lib/data.ts#slugify` from the
 * Sheets path, and matched by `dbToPublicLeagueData` for the DB path) uses
 * the bare slug. Every place that bridges these two namespaces — the auth
 * callback, RSVP route, admin server actions, and recovery scripts — used to
 * inline these prefix constants and a `stripPrefix(id, prefix)` helper. v1.12
 * pulls them into one module so the contract has one home.
 *
 * Pure constants and pure functions only. No I/O. Importable from `src/` and
 * from scripts (via relative path, see `tsconfig.scripts.json`).
 */

export const PLAYER_ID_PREFIX = 'p-'
export const TEAM_ID_PREFIX = 't-'
export const GUEST_ID = 'p-guest'

/**
 * Strip a known prefix from an id if present. Idempotent on already-bare ids.
 */
export function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

export function playerIdToSlug(dbPlayerId: string): string {
  return stripPrefix(dbPlayerId, PLAYER_ID_PREFIX)
}

export function slugToPlayerId(slug: string): string {
  return slug.startsWith(PLAYER_ID_PREFIX) ? slug : `${PLAYER_ID_PREFIX}${slug}`
}

export function teamIdToSlug(dbTeamId: string): string {
  return stripPrefix(dbTeamId, TEAM_ID_PREFIX)
}

export function slugToTeamId(slug: string): string {
  return slug.startsWith(TEAM_ID_PREFIX) ? slug : `${TEAM_ID_PREFIX}${slug}`
}
