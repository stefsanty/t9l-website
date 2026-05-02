/**
 * v1.33.0 (PR ε of the onboarding chain) — invite-code generator + URL builder.
 *
 * `LeagueInvite.code` is the user-facing identifier embedded in the redemption
 * URL (`https://t9l.me/join/<code>` — public route ships in PR ζ). This module
 * is the single source of truth for what a code looks like and how the URL is
 * assembled.
 *
 * Design choices:
 *   - **Alphabet excludes 0/O/1/I/L** to reduce transcription mistakes when
 *     a recipient reads a code over voice, copies it from a printed flyer,
 *     or types it from a low-resolution photo. The 28-char alphabet is
 *     `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.
 *   - **Length 12** balances entropy (~58 bits) against eyeball-readability.
 *     At 28^12 = 2.3e17 the collision probability for a single league
 *     issuing thousands of invites is negligible; even with 10k codes the
 *     birthday-bound is < 1e-9. The DB still has `@unique` on `code` as
 *     the hard guarantee — generation is best-effort, retry on conflict.
 *   - **Display-grouped** (`ABCD-EFGH-JKMN`) at 4-char chunks. The DB stores
 *     the un-hyphenated 12-char string; the display helper inserts hyphens.
 *     `normalizeCode` strips hyphens and uppercases so a hand-typed
 *     "abcd-efgh-jkmn" or "ABCDEFGHJKMN" both resolve to the canonical form.
 *   - **`crypto.getRandomValues` over Math.random** — the codes are an
 *     authorization gate for league join. Predictable codes would let an
 *     attacker enumerate join URLs for a league they're not invited to.
 *
 * Default expiry of 7 days from creation lives at the call site (server
 * action) per the v1.27.0 schema comment ("Prisma can't express
 * `now() + interval` defaults"). The helper here exposes the constant so
 * tests can pin both sides of the math.
 */

export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ' as const
export const INVITE_CODE_LENGTH = 12 as const
export const INVITE_DEFAULT_EXPIRY_DAYS = 7 as const

/**
 * Generate a fresh invite code from cryptographically-secure randomness.
 * Returns the un-hyphenated 12-char canonical form (the value stored in
 * `LeagueInvite.code`). Use `formatInviteCodeForDisplay` for the
 * grouped form shown in the admin UI / share text.
 */
export function generateInviteCode(): string {
  const alphabet = INVITE_CODE_ALPHABET
  const len = INVITE_CODE_LENGTH
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

/**
 * "ABCDEFGHJKMN" → "ABCD-EFGH-JKMN" for display. Preserves length up to
 * 12; longer or shorter inputs fall through with a single hyphen-pass
 * every 4 chars, which is fine for forward compatibility if the length
 * ever changes.
 */
export function formatInviteCodeForDisplay(code: string): string {
  const clean = normalizeCode(code)
  const parts: string[] = []
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.slice(i, i + 4))
  }
  return parts.join('-')
}

/**
 * Normalise user-entered code: strip whitespace + hyphens + uppercase.
 * Supports both "abcd-efgh-jkmn" and "ABCDEFGHJKMN" → "ABCDEFGHJKMN".
 * Used by the redemption route in PR ζ; tested here so the round-trip
 * with `formatInviteCodeForDisplay` stays pinned.
 */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Compute the absolute expiry timestamp from a creation moment + days.
 * Pure function so tests can pin the math; production calls this with
 * `new Date()` and `INVITE_DEFAULT_EXPIRY_DAYS`. The returned Date is
 * suitable for direct insertion into `LeagueInvite.expiresAt`.
 */
export function computeInviteExpiry(now: Date, days: number = INVITE_DEFAULT_EXPIRY_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * Build the public redemption URL for a code. The route itself ships in
 * PR ζ at `/join/[code]`. Hosting it here means the admin invite UI and
 * the eventual ζ redemption page reference the same shape.
 *
 * `host` should be a bare hostname (`t9l.me` or `tamachi.t9l.me`),
 * not a URL — production callers pass `process.env.NEXTAUTH_URL`'s
 * hostname or the request's `Host` header.
 */
export function buildInviteUrl(host: string, code: string): string {
  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${cleanHost}/join/${code}`
}

/**
 * CSV row for bulk-export. Header included as the first line by
 * `buildInviteCsv`. Quoting follows RFC 4180 minimally — wrap fields
 * containing commas / quotes / newlines in double quotes; double-up
 * embedded quotes.
 */
export interface InviteCsvRow {
  playerId: string
  playerName: string
  code: string
  joinUrl: string
  expiresAt: string // ISO 8601
  skipOnboarding: boolean
}

function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

/**
 * Build a CSV blob from a list of generated invites. Returned as a
 * string ready to feed into a `Blob`/`URL.createObjectURL` flow on the
 * client (or to write to a file in tests). Header row is fixed; rows
 * are emitted in the order supplied.
 */
export function buildInviteCsv(rows: InviteCsvRow[]): string {
  const header = ['playerId', 'playerName', 'code', 'joinUrl', 'expiresAt', 'skipOnboarding']
  const lines: string[] = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.playerId),
        csvEscape(r.playerName),
        csvEscape(r.code),
        csvEscape(r.joinUrl),
        csvEscape(r.expiresAt),
        r.skipOnboarding ? 'true' : 'false',
      ].join(','),
    )
  }
  // Trailing newline so spreadsheet apps don't grump about the last row.
  return lines.join('\n') + '\n'
}
