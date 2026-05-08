/**
 * v1.79.1 — Admin-approval email.
 *
 * Pins every contract the PR introduces:
 *   - `lib/emailTemplates.ts` exports `applicationApprovedEmail`.
 *   - The template output includes league name, player name, league URL,
 *     and "approved" copy.
 *   - HTML escapes user-controlled values (player name is user-typed).
 *   - `adminApproveApplication` imports `sendMail` and
 *     `applicationApprovedEmail`.
 *   - Player select in `adminApproveApplication` includes `name` and
 *     `userId` (regression target — missing either would leave the email
 *     blank or un-sendable).
 *   - LeagueTeam select includes `league.subdomain` so the URL is built
 *     correctly (regression target — missing subdomain falls back to leagueId).
 *   - `waitUntil` is called with `sendMail` inside `adminApproveApplication`.
 *   - Email is looked up from `User.email` (not a form value) and the send
 *     is guarded: no send when `user?.email` is null.
 *   - The log marker is `[v1.79.1 EMAIL] kind=application-approved`.
 *   - Version pinned at 1.79.1.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const EMAIL_TEMPLATES = read('src/lib/emailTemplates.ts')
const ADMIN_ACTIONS = read('src/app/admin/leagues/actions.ts')

// Slice the approve function body for scoped assertions.
const APPROVE_FN =
  ADMIN_ACTIONS.split('export async function adminApproveApplication')[1]?.split(
    '\nexport async function adminRejectApplication',
  )[0] ?? ''

describe('v1.79.1 — lib/emailTemplates.ts — applicationApprovedEmail', () => {
  it('exports applicationApprovedEmail', () => {
    expect(EMAIL_TEMPLATES).toMatch(/export function applicationApprovedEmail/)
  })

  it('declares ApplicationApprovedInput with leagueName, playerName, leagueUrl', () => {
    expect(EMAIL_TEMPLATES).toMatch(/ApplicationApprovedInput/)
    expect(EMAIL_TEMPLATES).toMatch(/leagueName:\s*string/)
    expect(EMAIL_TEMPLATES).toMatch(/playerName:\s*string/)
    expect(EMAIL_TEMPLATES).toMatch(/leagueUrl:\s*string/)
  })

  it('runtime — subject contains "approved" and league name', async () => {
    const { applicationApprovedEmail } = await import('@/lib/emailTemplates')
    const out = applicationApprovedEmail({
      leagueName: 'T9L 2026 Spring',
      playerName: 'Bob',
      leagueUrl: 'https://t9l.me/id/t9l',
    })
    expect(out.subject.toLowerCase()).toContain('approved')
    expect(out.subject).toContain('T9L 2026 Spring')
  })

  it('runtime — text includes player name, league name, league URL, and approved copy', async () => {
    const { applicationApprovedEmail } = await import('@/lib/emailTemplates')
    const out = applicationApprovedEmail({
      leagueName: 'T9L 2026 Spring',
      playerName: 'Bob',
      leagueUrl: 'https://t9l.me/id/t9l',
    })
    expect(out.text).toContain('Bob')
    expect(out.text).toContain('T9L 2026 Spring')
    expect(out.text).toContain('https://t9l.me/id/t9l')
    expect(out.text.toLowerCase()).toContain('approved')
  })

  it('runtime — HTML includes player name, league name, league URL, and approved copy', async () => {
    const { applicationApprovedEmail } = await import('@/lib/emailTemplates')
    const out = applicationApprovedEmail({
      leagueName: 'T9L 2026 Spring',
      playerName: 'Bob',
      leagueUrl: 'https://t9l.me/id/t9l',
    })
    expect(out.html).toContain('Bob')
    expect(out.html).toContain('T9L 2026 Spring')
    expect(out.html).toContain('https://t9l.me/id/t9l')
    expect(out.html.toLowerCase()).toContain('approved')
  })

  it('runtime — HTML escapes user-controlled values (defense in depth)', async () => {
    const { applicationApprovedEmail } = await import('@/lib/emailTemplates')
    const out = applicationApprovedEmail({
      leagueName: 'T9L',
      playerName: '<script>alert(1)</script>',
      leagueUrl: 'https://t9l.me/id/t9l',
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;')
  })

  it('runtime — HTML includes a link tag wrapping the league URL', async () => {
    const { applicationApprovedEmail } = await import('@/lib/emailTemplates')
    const out = applicationApprovedEmail({
      leagueName: 'T9L',
      playerName: 'Bob',
      leagueUrl: 'https://t9l.me/id/t9l',
    })
    expect(out.html).toMatch(/<a\s+href="https:\/\/t9l\.me\/id\/t9l"/)
  })
})

describe('v1.79.1 — adminApproveApplication email integration', () => {
  it('imports sendMail from @/lib/email', () => {
    expect(ADMIN_ACTIONS).toMatch(/import\s*\{[^}]*sendMail[^}]*\}\s*from\s*'@\/lib\/email'/)
  })

  it('imports applicationApprovedEmail from @/lib/emailTemplates', () => {
    expect(ADMIN_ACTIONS).toMatch(
      /import\s*\{[^}]*applicationApprovedEmail[^}]*\}\s*from\s*'@\/lib\/emailTemplates'/,
    )
  })

  it('player select includes name (regression target)', () => {
    expect(APPROVE_FN).toMatch(/select:\s*\{[^}]*name:\s*true/)
  })

  it('player select includes userId (regression target)', () => {
    expect(APPROVE_FN).toMatch(/select:\s*\{[^}]*userId:\s*true/)
  })

  it('leagueTeam select includes league.subdomain', () => {
    expect(APPROVE_FN).toMatch(/league:\s*\{\s*select:\s*\{[^}]*subdomain:\s*true/)
  })

  it('leagueTeam select includes league.name', () => {
    expect(APPROVE_FN).toMatch(/league:\s*\{\s*select:\s*\{[^}]*name:\s*true/)
  })

  it('looks up User.email via prisma.user.findUnique after PLM update', () => {
    // The user lookup must appear AFTER the PLM update (which contains
    // applicationStatus: 'APPROVED').
    const plmUpdateIdx = APPROVE_FN.indexOf("applicationStatus: 'APPROVED'")
    const userLookupIdx = APPROVE_FN.indexOf('prisma.user.findUnique')
    expect(plmUpdateIdx).toBeGreaterThan(0)
    expect(userLookupIdx).toBeGreaterThan(plmUpdateIdx)
  })

  it('guards send on user?.email (no send when email is null)', () => {
    expect(APPROVE_FN).toMatch(/if\s*\(user\?\.email\)/)
  })

  it('queues sendMail via waitUntil inside adminApproveApplication', () => {
    expect(APPROVE_FN).toMatch(/waitUntil\(/)
    expect(APPROVE_FN).toMatch(/sendMail\(/)
    expect(APPROVE_FN).toMatch(/applicationApprovedEmail\(/)
  })

  it('constructs leagueUrl as https://t9l.me/id/<slug>', () => {
    expect(APPROVE_FN).toMatch(/https:\/\/t9l\.me\/id\//)
  })

  it('logs [v1.79.1 EMAIL] kind=application-approved on non-sent result', () => {
    expect(APPROVE_FN).toMatch(/\[v1\.79\.1 EMAIL\]/)
    expect(APPROVE_FN).toMatch(/kind=application-approved/)
  })

  it('version is 1.79.1 or later', async () => {
    const { APP_VERSION } = await import('@/lib/version')
    expect(APP_VERSION).toMatch(/^1\.79\.[1-9]\d*$|^1\.[89]\d\.\d+$|^[2-9]\.\d+\.\d+$/)
  })
})
