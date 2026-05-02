/**
 * v1.33.0 (PR ε) — invite-code generator + URL builder + CSV serializer.
 *
 * Pure-function suite. No mocks beyond `crypto.getRandomValues` for the
 * determinism-on-demand cases that pin the alphabet mapping.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_DEFAULT_EXPIRY_DAYS,
  generateInviteCode,
  formatInviteCodeForDisplay,
  normalizeCode,
  computeInviteExpiry,
  buildInviteUrl,
  buildInviteCsv,
  type InviteCsvRow,
} from '@/lib/inviteCodes'

describe('v1.33.0 (PR ε) — INVITE_CODE_ALPHABET shape', () => {
  it('excludes 0/O/1/I/L to reduce transcription mistakes', () => {
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[01OIL]/)
  })

  it('uses uppercase A-Z + 2-9 only — no lowercase, no special chars', () => {
    expect(INVITE_CODE_ALPHABET).toMatch(/^[2-9A-Z]+$/)
  })

  it('alphabet is at least 28 chars (the 31 allowed letters/digits minus 0/1/O/I/L = 28)', () => {
    expect(INVITE_CODE_ALPHABET.length).toBeGreaterThanOrEqual(28)
  })
})

describe('v1.33.0 (PR ε) — generateInviteCode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('produces a string of INVITE_CODE_LENGTH = 12 characters', () => {
    const code = generateInviteCode()
    expect(code).toHaveLength(INVITE_CODE_LENGTH)
    expect(INVITE_CODE_LENGTH).toBe(12)
  })

  it('only uses characters from INVITE_CODE_ALPHABET', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode()
      for (const c of code) {
        expect(INVITE_CODE_ALPHABET).toContain(c)
      }
    }
  })

  it('two consecutive calls produce different codes (extremely high prob)', () => {
    const a = generateInviteCode()
    const b = generateInviteCode()
    expect(a).not.toBe(b)
  })

  it('uses crypto.getRandomValues, not Math.random — deterministic mapping when bytes are pinned', () => {
    // Pin the random bytes to all-zeros so the output is deterministic:
    // every byte maps to alphabet[0 % 28] = '2' (first char in the alphabet).
    const stub = vi.fn().mockImplementation((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = 0
      return arr
    })
    vi.stubGlobal('crypto', { getRandomValues: stub })
    const code = generateInviteCode()
    expect(code).toBe(INVITE_CODE_ALPHABET[0].repeat(INVITE_CODE_LENGTH))
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('v1.33.0 (PR ε) — formatInviteCodeForDisplay / normalizeCode round-trip', () => {
  it('groups a 12-char code into 4-char chunks separated by hyphens', () => {
    expect(formatInviteCodeForDisplay('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN')
  })

  it('normalizeCode strips hyphens + uppercases', () => {
    expect(normalizeCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
  })

  it('normalizeCode strips whitespace too', () => {
    expect(normalizeCode('  abcd efgh jkmn  ')).toBe('ABCDEFGHJKMN')
  })

  it('format → normalize is the identity (canonical form preserved)', () => {
    const canonical = generateInviteCode()
    const display = formatInviteCodeForDisplay(canonical)
    expect(normalizeCode(display)).toBe(canonical)
  })

  it('handles odd-length codes gracefully (forward compat)', () => {
    expect(formatInviteCodeForDisplay('ABCDEFG')).toBe('ABCD-EFG')
  })
})

describe('v1.33.0 (PR ε) — computeInviteExpiry', () => {
  it('default is +7 days from `now`', () => {
    expect(INVITE_DEFAULT_EXPIRY_DAYS).toBe(7)
    const now = new Date('2026-05-03T10:00:00Z')
    const expires = computeInviteExpiry(now)
    expect(expires.toISOString()).toBe('2026-05-10T10:00:00.000Z')
  })

  it('respects explicit days override', () => {
    const now = new Date('2026-05-03T10:00:00Z')
    expect(computeInviteExpiry(now, 14).toISOString()).toBe('2026-05-17T10:00:00.000Z')
    expect(computeInviteExpiry(now, 1).toISOString()).toBe('2026-05-04T10:00:00.000Z')
  })

  it('the math is timezone-independent (computes via getTime, not local clock)', () => {
    // If the helper were doing date-arithmetic via getDate()+7, DST + leap
    // year + month-rollover would break it. Pin the millisecond delta.
    const now = new Date('2026-05-03T10:00:00Z')
    const expires = computeInviteExpiry(now, 7)
    expect(expires.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe('v1.33.0 (PR ε) — buildInviteUrl', () => {
  it('produces an https URL with the bare host + /join/<code>', () => {
    expect(buildInviteUrl('t9l.me', 'ABCD1234EFGH')).toBe('https://t9l.me/join/ABCD1234EFGH')
  })

  it('strips a leading https:// or http:// from the host arg (defensive)', () => {
    expect(buildInviteUrl('https://t9l.me', 'ABCD1234EFGH')).toBe('https://t9l.me/join/ABCD1234EFGH')
    expect(buildInviteUrl('http://t9l.me/', 'ABCD1234EFGH')).toBe('https://t9l.me/join/ABCD1234EFGH')
  })

  it('respects subdomain hosts (multi-tenant)', () => {
    expect(buildInviteUrl('tamachi.t9l.me', 'XYZ12345WXYZ')).toBe('https://tamachi.t9l.me/join/XYZ12345WXYZ')
  })
})

describe('v1.33.0 (PR ε) — buildInviteCsv', () => {
  it('emits a fixed header + one line per row + trailing newline', () => {
    const rows: InviteCsvRow[] = [
      {
        playerId: 'p-ian-noseda',
        playerName: 'Ian Noseda',
        code: 'ABCD1234EFGH',
        joinUrl: 'https://t9l.me/join/ABCD1234EFGH',
        expiresAt: '2026-05-10T10:00:00.000Z',
        skipOnboarding: false,
      },
    ]
    const csv = buildInviteCsv(rows)
    expect(csv).toBe(
      'playerId,playerName,code,joinUrl,expiresAt,skipOnboarding\n' +
        'p-ian-noseda,Ian Noseda,ABCD1234EFGH,https://t9l.me/join/ABCD1234EFGH,2026-05-10T10:00:00.000Z,false\n',
    )
  })

  it('quotes fields containing commas + escapes embedded double quotes per RFC 4180', () => {
    const rows: InviteCsvRow[] = [
      {
        playerId: 'p-1',
        playerName: 'Doe, John "JD"',
        code: 'CODE12345678',
        joinUrl: 'https://t9l.me/join/CODE12345678',
        expiresAt: '',
        skipOnboarding: true,
      },
    ]
    const csv = buildInviteCsv(rows)
    // The name field gets wrapped in quotes (because of the comma) AND the
    // embedded `"JD"` quotes get doubled-up to `""JD""`.
    expect(csv).toContain(',"Doe, John ""JD""",')
    expect(csv).toContain(',true\n')
  })

  it('handles newlines inside fields (defensive — admin pastes a name with \\n)', () => {
    const rows: InviteCsvRow[] = [
      {
        playerId: 'p-1',
        playerName: 'Line1\nLine2',
        code: 'CODE12345678',
        joinUrl: 'https://t9l.me/join/CODE12345678',
        expiresAt: '',
        skipOnboarding: false,
      },
    ]
    const csv = buildInviteCsv(rows)
    expect(csv).toContain('"Line1\nLine2"')
  })

  it('header row order matches the spec (matters for downstream mail-merge)', () => {
    const csv = buildInviteCsv([])
    expect(csv.split('\n')[0]).toBe('playerId,playerName,code,joinUrl,expiresAt,skipOnboarding')
  })

  it('empty rows array yields header-only', () => {
    expect(buildInviteCsv([])).toBe('playerId,playerName,code,joinUrl,expiresAt,skipOnboarding\n')
  })
})
