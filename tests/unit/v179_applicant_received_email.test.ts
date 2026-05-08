/**
 * v1.79.0 — Applicant-received email.
 *
 * Pins every contract the PR introduces:
 *   - `lib/email.ts` exists and exports `sendMail`.
 *   - `lib/email.ts` returns `{ status: 'skipped' }` when EMAIL_SERVER /
 *     EMAIL_FROM are missing (no-op fallback — load-bearing for the
 *     dev/preview path that doesn't have SMTP wired).
 *   - `lib/email.ts` uses `nodemailer.createTransport` (regression target —
 *     dropping nodemailer would break NextAuth's EmailProvider too).
 *   - `lib/emailTemplates.ts` exports `applicationReceivedEmail` and the
 *     output includes the league name, the player name, and "review"
 *     copy describing what happens next.
 *   - HTML rendering escapes user-controlled values (defense in depth —
 *     the player name is user-typed and goes into the email body).
 *   - `registerToLeague` (recruiting path) imports `waitUntil`, `sendMail`,
 *     and `applicationReceivedEmail`, and queues the send via `waitUntil`
 *     BEFORE the `redirect()` throws (regression target — `waitUntil`
 *     placed AFTER `redirect()` would never run).
 *   - `completeOnboardingWithId` (join path) does the same.
 *   - `completeOnboardingWithId` selects `league.name` so the email
 *     template has the league name available.
 *   - Both paths use `trimmedEmail` (the form value, lowercased) as the
 *     recipient — not `user.email` — so the receipt lands at the address
 *     the user just typed.
 *   - Version pinned at 1.79.0.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const EMAIL_LIB = read('src/lib/email.ts')
const EMAIL_TEMPLATES = read('src/lib/emailTemplates.ts')
const RECRUIT_ACTIONS = read('src/app/api/recruiting/actions.ts')
const JOIN_ACTIONS = read('src/app/join/[code]/actions.ts')

// Slice helpers to scope assertions to the relevant function bodies.
const REGISTER_FN =
  RECRUIT_ACTIONS.split('export async function registerToLeague')[1]?.split(
    '\nfunction isOwnedBlobUrl',
  )[0] ?? ''

const COMPLETE_ONBOARDING_FN =
  JOIN_ACTIONS.split('export async function completeOnboardingWithId')[1]?.split(
    '\nexport async function ',
  )[0] ?? ''

describe('v1.79.0 — lib/email.ts module', () => {
  beforeEach(() => {
    delete process.env.EMAIL_SERVER
    delete process.env.EMAIL_FROM
    vi.resetModules()
  })

  it('exports sendMail', () => {
    expect(EMAIL_LIB).toMatch(/export async function sendMail/)
  })

  it('uses nodemailer createTransport (regression target)', () => {
    expect(EMAIL_LIB).toMatch(/from 'nodemailer'/)
    expect(EMAIL_LIB).toMatch(/createTransport/)
  })

  it('reads EMAIL_SERVER from process.env', () => {
    expect(EMAIL_LIB).toMatch(/process\.env\.EMAIL_SERVER/)
  })

  it('reads EMAIL_FROM from process.env', () => {
    expect(EMAIL_LIB).toMatch(/process\.env\.EMAIL_FROM/)
  })

  it('returns a discriminated SendMailResult shape', () => {
    expect(EMAIL_LIB).toMatch(/SendMailResult/)
    expect(EMAIL_LIB).toMatch(/status:\s*'sent'/)
    expect(EMAIL_LIB).toMatch(/status:\s*'skipped'/)
    expect(EMAIL_LIB).toMatch(/status:\s*'error'/)
  })

  it('runtime — sendMail returns skipped when EMAIL_SERVER unset', async () => {
    const mod = await import('@/lib/email')
    mod.__resetMailerForTesting()
    const result = await mod.sendMail({
      to: 'a@b.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    })
    expect(result.status).toBe('skipped')
  })

  it('runtime — sendMail returns skipped when EMAIL_FROM unset (server set, from unset)', async () => {
    process.env.EMAIL_SERVER = 'smtp://user:pass@localhost:25'
    delete process.env.EMAIL_FROM
    const mod = await import('@/lib/email')
    mod.__resetMailerForTesting()
    const result = await mod.sendMail({
      to: 'a@b.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    })
    expect(result.status).toBe('skipped')
  })
})

describe('v1.79.0 — lib/emailTemplates.ts module', () => {
  it('exports applicationReceivedEmail', () => {
    expect(EMAIL_TEMPLATES).toMatch(/export function applicationReceivedEmail/)
  })

  it('runtime — output includes league name, player name, subject, and review copy', async () => {
    const { applicationReceivedEmail } = await import('@/lib/emailTemplates')
    const out = applicationReceivedEmail({
      leagueName: 'T9L 2026 Spring',
      playerName: 'Alice',
    })
    expect(out.subject).toContain('T9L 2026 Spring')
    expect(out.text).toContain('Alice')
    expect(out.text).toContain('T9L 2026 Spring')
    expect(out.text.toLowerCase()).toContain('review')
    expect(out.html).toContain('Alice')
    expect(out.html).toContain('T9L 2026 Spring')
    expect(out.html.toLowerCase()).toContain('review')
  })

  it('runtime — HTML escapes user-controlled values (defense in depth)', async () => {
    const { applicationReceivedEmail } = await import('@/lib/emailTemplates')
    const out = applicationReceivedEmail({
      leagueName: 'T9L',
      playerName: '<script>alert(1)</script>',
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;')
  })
})

describe('v1.79.0 — registerToLeague (recruit path) email integration', () => {
  it('imports waitUntil from @vercel/functions', () => {
    expect(RECRUIT_ACTIONS).toMatch(
      /import\s*\{\s*waitUntil\s*\}\s*from\s*'@vercel\/functions'/,
    )
  })

  it('imports sendMail from @/lib/email', () => {
    expect(RECRUIT_ACTIONS).toMatch(
      /import\s*\{\s*sendMail\s*\}\s*from\s*'@\/lib\/email'/,
    )
  })

  it('imports applicationReceivedEmail from @/lib/emailTemplates', () => {
    expect(RECRUIT_ACTIONS).toMatch(
      /import\s*\{\s*applicationReceivedEmail\s*\}\s*from\s*'@\/lib\/emailTemplates'/,
    )
  })

  it('queues sendMail via waitUntil inside registerToLeague', () => {
    expect(REGISTER_FN).toMatch(/waitUntil\(/)
    expect(REGISTER_FN).toMatch(/sendMail\(/)
    expect(REGISTER_FN).toMatch(/applicationReceivedEmail\(/)
  })

  it('queues waitUntil BEFORE redirect (regression target — after-redirect never runs)', () => {
    const waitUntilIdx = REGISTER_FN.indexOf('waitUntil(')
    const redirectIdx = REGISTER_FN.lastIndexOf('redirect(')
    expect(waitUntilIdx).toBeGreaterThan(0)
    expect(redirectIdx).toBeGreaterThan(0)
    expect(waitUntilIdx).toBeLessThan(redirectIdx)
  })

  it('sends to trimmedEmail (the form value), not user.email', () => {
    // Constrain the assertion to the sendMail call shape.
    expect(REGISTER_FN).toMatch(/to:\s*trimmedEmail/)
  })

  it('passes league.name + trimmedName to the template', () => {
    expect(REGISTER_FN).toMatch(/leagueName:\s*league\.name/)
    expect(REGISTER_FN).toMatch(/playerName:\s*trimmedName/)
  })
})

describe('v1.79.0 — completeOnboardingWithId (join path) email integration', () => {
  it('imports waitUntil from @vercel/functions', () => {
    expect(JOIN_ACTIONS).toMatch(
      /import\s*\{\s*waitUntil\s*\}\s*from\s*'@vercel\/functions'/,
    )
  })

  it('imports sendMail from @/lib/email', () => {
    expect(JOIN_ACTIONS).toMatch(
      /import\s*\{\s*sendMail\s*\}\s*from\s*'@\/lib\/email'/,
    )
  })

  it('imports applicationReceivedEmail from @/lib/emailTemplates', () => {
    expect(JOIN_ACTIONS).toMatch(
      /import\s*\{\s*applicationReceivedEmail\s*\}\s*from\s*'@\/lib\/emailTemplates'/,
    )
  })

  it('selects league.name on the LeagueInvite findUnique inside completeOnboardingWithId', () => {
    // v1.81.0 — the league select now also includes idRequired. The v1.79.0
    // contract is just that `name: true` is selected; relax the literal
    // shape match so additive future fields don't break this assertion.
    expect(COMPLETE_ONBOARDING_FN).toMatch(/league:\s*\{\s*select:\s*\{[^}]*\bname:\s*true/)
  })

  it('queues sendMail via waitUntil inside completeOnboardingWithId', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/waitUntil\(/)
    expect(COMPLETE_ONBOARDING_FN).toMatch(/sendMail\(/)
    expect(COMPLETE_ONBOARDING_FN).toMatch(/applicationReceivedEmail\(/)
  })

  it('queues waitUntil BEFORE redirect (regression target)', () => {
    const waitUntilIdx = COMPLETE_ONBOARDING_FN.indexOf('waitUntil(')
    const redirectIdx = COMPLETE_ONBOARDING_FN.lastIndexOf('redirect(')
    expect(waitUntilIdx).toBeGreaterThan(0)
    expect(redirectIdx).toBeGreaterThan(0)
    expect(waitUntilIdx).toBeLessThan(redirectIdx)
  })

  it('sends to trimmedEmail (the form value), not user.email', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/to:\s*trimmedEmail/)
  })

  it('passes invite.league.name + trimmedName to the template', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/leagueName:\s*invite\.league\.name/)
    expect(COMPLETE_ONBOARDING_FN).toMatch(/playerName:\s*trimmedName/)
  })
})
