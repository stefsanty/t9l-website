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

// Prisma's `cuid()` default emits 25-char ids: 'c' + 24 lowercase alphanumerics.
// Any row id (Player, LeagueTeam, etc.) created via the default — i.e. not via
// the PR-6 backfill that minted `p-<slug>` / `t-<slug>` — matches this pattern.
// `playerIdToSlug` / `teamIdToSlug` correctly pass such ids through unchanged
// (no prefix to strip); their inverses must detect the bare cuid and not
// blindly slap `p-` / `t-` on, or the round-trip fakes a non-existent id.
// See v2.2.22 ledger entry — Théo & co. (post-backfill players) were
// unreachable through `slugToPlayerId` until this check landed.
const CUID_PATTERN = /^c[a-z0-9]{24}$/

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
  if (slug.startsWith(PLAYER_ID_PREFIX)) return slug
  if (CUID_PATTERN.test(slug)) return slug
  return `${PLAYER_ID_PREFIX}${slug}`
}

export function teamIdToSlug(dbTeamId: string): string {
  return stripPrefix(dbTeamId, TEAM_ID_PREFIX)
}

export function slugToTeamId(slug: string): string {
  if (slug.startsWith(TEAM_ID_PREFIX)) return slug
  if (CUID_PATTERN.test(slug)) return slug
  return `${TEAM_ID_PREFIX}${slug}`
}
