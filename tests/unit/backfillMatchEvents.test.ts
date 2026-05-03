/**
 * v1.42.1 (epic match events PR β) — pure decision helpers in
 * `scripts/backfillMatchEventsFromSheet.ts`. The script's apply path needs
 * a live Sheets connection + a running DB so we don't unit-test that here;
 * the decision helpers are pure and pinned exhaustively.
 */
import { describe, expect, it } from 'vitest'
import {
  decideRowAction,
  EXPLICIT_GUEST_NAMES,
  findUniqueByFirstName,
  firstNameToken,
  guestPlayerIdFor,
  parseFlags,
  resolvePlayer,
  resolveWeekNumber,
  slugify,
} from '../../scripts/backfillMatchEventsFromSheet'

describe('parseFlags', () => {
  it('defaults to dry-run', () => {
    const f = parseFlags([])
    expect(f.dryRun).toBe(true)
    expect(f.apply).toBe(false)
  })

  it('--apply flips dry-run off', () => {
    const f = parseFlags(['--apply'])
    expect(f.dryRun).toBe(false)
    expect(f.apply).toBe(true)
  })

  it('--league-slug overrides default', () => {
    const f = parseFlags(['--league-slug=tamachi-2026'])
    expect(f.leagueSlug).toBe('tamachi-2026')
  })

  it('--report writes to a custom path', () => {
    const f = parseFlags(['--report=/tmp/foo.md'])
    expect(f.reportPath).toBe('/tmp/foo.md')
  })

  it('--verbose toggles verbose', () => {
    const f = parseFlags(['--verbose'])
    expect(f.verbose).toBe(true)
  })
})

describe('slugify', () => {
  it('matches the Sheets-side slugify (lowercase, accent-strip, hyphen)', () => {
    expect(slugify('Ian Noseda')).toBe('ian-noseda')
    expect(slugify('Khrapov Tymur')).toBe('khrapov-tymur')
    expect(slugify('Aleksandr Ivankov')).toBe('aleksandr-ivankov')
    expect(slugify("Stefan O'Brien")).toBe('stefan-obrien')
  })
})

describe('resolveWeekNumber', () => {
  it('parses MD3 / md7 / etc.', () => {
    const dates = new Map<number, string | null>()
    expect(resolveWeekNumber('MD3', '', dates)).toBe(3)
    expect(resolveWeekNumber('md7', '', dates)).toBe(7)
  })

  it('falls back to timestamp date when matchday label is #REF!', () => {
    const dates = new Map<number, string | null>([[1, '2026-04-01'], [2, '2026-04-08']])
    expect(resolveWeekNumber('#REF!', '2026-04-08T19:00:00Z', dates)).toBe(2)
  })

  it('returns null when neither matchday label nor timestamp resolves', () => {
    const dates = new Map<number, string | null>()
    expect(resolveWeekNumber('#REF!', '', dates)).toBeNull()
    expect(resolveWeekNumber('MDx', '', dates)).toBeNull()
  })

  it('rejects malformed MD0 or negative', () => {
    const dates = new Map<number, string | null>()
    expect(resolveWeekNumber('MD0', '', dates)).toBeNull()
  })
})

describe('resolvePlayer', () => {
  const byLcName = new Map([
    ['ian noseda', 'p-ian-noseda'],
    ['khrapov tymur', 'p-khrapov-tymur'],
    ['kosma knasiecki', 'p-kosma-knasiecki'],
  ])
  const bySlug = new Map([
    ['ian-noseda', 'p-ian-noseda'],
    ['khrapov-tymur', 'p-khrapov-tymur'],
    ['stefan-santos', 'p-stefan-santos'], // only registered via slug
    ['kosma-knasiecki', 'p-kosma-knasiecki'],
  ])

  it('exact (case-insensitive trimmed) name wins', () => {
    expect(resolvePlayer('Ian Noseda', byLcName, bySlug)).toBe('p-ian-noseda')
    expect(resolvePlayer(' ian noseda ', byLcName, bySlug)).toBe('p-ian-noseda')
  })

  it('falls back to slug match when exact misses', () => {
    expect(resolvePlayer('Stefan Santos', byLcName, bySlug)).toBe('p-stefan-santos')
  })

  it('returns null when both miss AND no context supplied', () => {
    expect(resolvePlayer('Random Name', byLcName, bySlug)).toBeNull()
  })

  it('returns null on empty string', () => {
    expect(resolvePlayer('', byLcName, bySlug)).toBeNull()
    expect(resolvePlayer('   ', byLcName, bySlug)).toBeNull()
  })

  describe('v1.46.1 — fuzzy first-name match within team context', () => {
    const fenixRoster = [
      { id: 'p-kosma-knasiecki', name: 'Kosma Knasiecki' },
      { id: 'p-ben-lee', name: 'Ben Lee' },
      { id: 'p-ryuusei', name: 'Ryuusei' },
    ]

    it('single-token name resolves to unique team player by first name', () => {
      expect(
        resolvePlayer('Kosma', byLcName, bySlug, { teamPlayers: fenixRoster }),
      ).toBe('p-kosma-knasiecki')
    })

    it('case-insensitive', () => {
      expect(
        resolvePlayer('KOSMA', byLcName, bySlug, { teamPlayers: fenixRoster }),
      ).toBe('p-kosma-knasiecki')
    })

    it('does NOT fuzzy-match when input has a space (full name expected)', () => {
      // "Kosma Phantom" has a space → exact-name + slug both miss → null
      // (no fuzzy fallback for multi-token names; that prevents wrong
      // matches like "Ben Smith" picking up "Ben Lee").
      expect(
        resolvePlayer('Kosma Phantom', byLcName, bySlug, {
          teamPlayers: fenixRoster,
        }),
      ).toBeNull()
    })

    it('returns null when 2+ players share the same first name on the team', () => {
      const ambiguous = [
        { id: 'p-ben-lee', name: 'Ben Lee' },
        { id: 'p-ben-other', name: 'Ben Other' },
      ]
      expect(
        resolvePlayer('Ben', byLcName, bySlug, { teamPlayers: ambiguous }),
      ).toBeNull()
    })

    it('returns null when fuzzy match misses entirely on the team', () => {
      expect(
        resolvePlayer('Phantom', byLcName, bySlug, { teamPlayers: fenixRoster }),
      ).toBeNull()
    })

    it('does nothing when teamPlayers omitted', () => {
      expect(resolvePlayer('Kosma', byLcName, bySlug)).toBeNull()
    })
  })

  describe('v1.46.1 — explicit Guest mapping', () => {
    it('"Guest" → guest player id when context.guestPlayerId set', () => {
      expect(
        resolvePlayer('Guest', byLcName, bySlug, { guestPlayerId: 'p-guest-lt-fenix' }),
      ).toBe('p-guest-lt-fenix')
    })

    it('case-insensitive Guest match', () => {
      expect(
        resolvePlayer('GUEST', byLcName, bySlug, { guestPlayerId: 'p-guest-lt-fenix' }),
      ).toBe('p-guest-lt-fenix')
    })

    it('"Sergei Borodin" → guest fallback (former player explicitly mapped)', () => {
      expect(
        resolvePlayer('Sergei Borodin', byLcName, bySlug, {
          guestPlayerId: 'p-guest-lt-mariners',
        }),
      ).toBe('p-guest-lt-mariners')
    })

    it('does NOT swallow other unresolved names — they still return null', () => {
      // Conservative — unknown names that AREN'T in EXPLICIT_GUEST_NAMES
      // still skip, so we don't silently miscredit goals to Guest. The
      // user adds new names to the constant when sheet history surfaces them.
      expect(
        resolvePlayer('Random Phantom', byLcName, bySlug, {
          guestPlayerId: 'p-guest-lt-fenix',
        }),
      ).toBeNull()
    })

    it('does nothing when guestPlayerId omitted', () => {
      expect(resolvePlayer('Guest', byLcName, bySlug)).toBeNull()
      expect(resolvePlayer('Sergei Borodin', byLcName, bySlug)).toBeNull()
    })
  })
})

describe('firstNameToken', () => {
  it('returns the lowercased first space-separated token', () => {
    expect(firstNameToken('Kosma Knasiecki')).toBe('kosma')
    expect(firstNameToken('  Ian Noseda  ')).toBe('ian')
  })

  it('returns null on single-token input', () => {
    expect(firstNameToken('Ryuusei')).toBeNull()
  })

  it('returns null on empty', () => {
    expect(firstNameToken('')).toBeNull()
    expect(firstNameToken('   ')).toBeNull()
  })
})

describe('findUniqueByFirstName', () => {
  it('returns the single matching player id', () => {
    expect(
      findUniqueByFirstName('kosma', [
        { id: 'p-kosma-knasiecki', name: 'Kosma Knasiecki' },
        { id: 'p-ben-lee', name: 'Ben Lee' },
      ]),
    ).toBe('p-kosma-knasiecki')
  })

  it('returns null on zero matches', () => {
    expect(
      findUniqueByFirstName('phantom', [
        { id: 'p-kosma-knasiecki', name: 'Kosma Knasiecki' },
      ]),
    ).toBeNull()
  })

  it('returns null on multiple matches (ambiguous)', () => {
    expect(
      findUniqueByFirstName('ben', [
        { id: 'p-ben-lee', name: 'Ben Lee' },
        { id: 'p-ben-other', name: 'Ben Other' },
      ]),
    ).toBeNull()
  })

  it('skips players with null name (defensive — pre-onboarding-stage rows)', () => {
    expect(
      findUniqueByFirstName('kosma', [
        { id: 'p-pending', name: null },
        { id: 'p-kosma-knasiecki', name: 'Kosma Knasiecki' },
      ]),
    ).toBe('p-kosma-knasiecki')
  })
})

describe('EXPLICIT_GUEST_NAMES', () => {
  it('is lowercased + trimmed', () => {
    for (const name of EXPLICIT_GUEST_NAMES) {
      expect(name).toBe(name.trim().toLowerCase())
    }
  })

  it('contains the operator-confirmed guest aliases', () => {
    expect(EXPLICIT_GUEST_NAMES.has('guest')).toBe(true)
    expect(EXPLICIT_GUEST_NAMES.has('sergei borodin')).toBe(true)
  })
})

describe('guestPlayerIdFor', () => {
  it('returns deterministic per-LeagueTeam id', () => {
    expect(guestPlayerIdFor('lt-fenix-fc')).toBe('p-guest-lt-fenix-fc')
    expect(guestPlayerIdFor('lt-mariners')).toBe('p-guest-lt-mariners')
  })

  it('idempotent — same input always same output', () => {
    expect(guestPlayerIdFor('lt-fenix-fc')).toBe(guestPlayerIdFor('lt-fenix-fc'))
  })
})

describe('decideRowAction', () => {
  const ctx = {
    weekDates: new Map<number, string | null>([
      [1, '2026-04-01'],
      [2, '2026-04-08'],
      [3, '2026-04-15'],
    ]),
    matchByKey: new Map<string, string>([
      ['1|lt-mariners|lt-fenix', 'm-1'],
      ['2|lt-hygge|lt-torpedo', 'm-2'],
      ['3|lt-mariners|lt-hygge', 'm-3'],
    ]),
    teamByName: new Map<string, string>([
      ['mariners fc', 'lt-mariners'],
      ['fenix fc', 'lt-fenix'],
      ['hygge sc', 'lt-hygge'],
      ['fc torpedo', 'lt-torpedo'],
    ]),
    playerByLcName: new Map<string, string>([
      ['ian noseda', 'p-ian-noseda'],
      ['khrapov tymur', 'p-khrapov-tymur'],
    ]),
    playerBySlug: new Map<string, string>([
      ['ian-noseda', 'p-ian-noseda'],
      ['khrapov-tymur', 'p-khrapov-tymur'],
      ['stefan-santos', 'p-stefan-santos'],
    ]),
  }

  function row(overrides: Partial<Parameters<typeof decideRowAction>[0]> = {}) {
    return decideRowAction({
      rowNumber: 5,
      rawMd: 'MD1',
      timestamp: '',
      scoringTeamName: 'Mariners FC',
      concedingTeamName: 'Fenix FC',
      scorerName: 'Ian Noseda',
      assisterName: null,
      ...ctx,
      ...overrides,
    })
  }

  it('happy path: returns INSERT with resolved IDs', () => {
    const d = row()
    expect(d.kind).toBe('INSERT')
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.matchId).toBe('m-1')
    expect(d.scorerId).toBe('p-ian-noseda')
    expect(d.assisterId).toBeNull()
    expect(d.goalType).toBe('OPEN_PLAY')
  })

  it('resolves assister when present', () => {
    const d = row({ assisterName: 'Khrapov Tymur' })
    expect(d.kind).toBe('INSERT')
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.assisterId).toBe('p-khrapov-tymur')
  })

  it('resolves assister via slug fallback', () => {
    const d = row({ assisterName: 'Stefan Santos' })
    expect(d.kind).toBe('INSERT')
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.assisterId).toBe('p-stefan-santos')
  })

  it('inserts with null assister when assister text is unresolved', () => {
    const d = row({ assisterName: 'Random Joe' })
    expect(d.kind).toBe('INSERT')
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.assisterId).toBeNull()
    // The note flag is captured — drives the report's "assister notes" section.
    expect((d as any)._assisterNote).toMatch(/Random Joe/)
  })

  it('SKIPs when matchday is unresolvable', () => {
    const d = row({ rawMd: 'MDx', timestamp: '' })
    expect(d.kind).toBe('SKIP')
    if (d.kind !== 'SKIP') throw new Error()
    expect(d.reason).toMatch(/unresolved-matchday/)
  })

  it('SKIPs when scoring team is unknown', () => {
    const d = row({ scoringTeamName: 'Random FC' })
    expect(d.kind).toBe('SKIP')
    if (d.kind !== 'SKIP') throw new Error()
    expect(d.reason).toMatch(/unresolved-scoring-team/)
  })

  it('SKIPs when conceding team is unknown', () => {
    const d = row({ concedingTeamName: 'Random FC' })
    expect(d.kind).toBe('SKIP')
    if (d.kind !== 'SKIP') throw new Error()
    expect(d.reason).toMatch(/unresolved-conceding-team/)
  })

  it('matches the away-vs-home permutation as well as home-vs-away', () => {
    // The match in matchByKey is `2|lt-hygge|lt-torpedo` (Hygge home,
    // Torpedo away); a goal scored by Torpedo lists Torpedo as scoring,
    // Hygge as conceding — the reverse key. decideRowAction tries both.
    const d = row({
      rawMd: 'MD2',
      scoringTeamName: 'FC Torpedo',
      concedingTeamName: 'Hygge SC',
      scorerName: 'Ian Noseda',
    })
    expect(d.kind).toBe('INSERT')
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.matchId).toBe('m-2')
  })

  it('SKIPs when no match exists for the (week, teams) tuple', () => {
    const d = row({
      rawMd: 'MD2',
      scoringTeamName: 'Mariners FC',
      concedingTeamName: 'Fenix FC',
    })
    expect(d.kind).toBe('SKIP')
    if (d.kind !== 'SKIP') throw new Error()
    expect(d.reason).toMatch(/unresolved-match/)
  })

  it('SKIPs when scorer is unresolvable', () => {
    const d = row({ scorerName: 'Phantom Player' })
    expect(d.kind).toBe('SKIP')
    if (d.kind !== 'SKIP') throw new Error()
    expect(d.reason).toMatch(/unresolved-scorer/)
  })

  it('falls back to timestamp-derived matchday when MD label is #REF!', () => {
    const d = row({ rawMd: '#REF!', timestamp: '2026-04-08T19:00:00Z', rowNumber: 9, scoringTeamName: 'FC Torpedo', concedingTeamName: 'Hygge SC', scorerName: 'Ian Noseda' })
    expect(d.kind).toBe('INSERT')
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.matchId).toBe('m-2')
  })

  it('every imported row lands as OPEN_PLAY (v1 sheet has no goalType column)', () => {
    const d = row()
    if (d.kind !== 'INSERT') throw new Error()
    expect(d.goalType).toBe('OPEN_PLAY')
  })

  describe('v1.46.1 — team context wired to resolver', () => {
    const playersByLeagueTeam = new Map<
      string,
      ReadonlyArray<{ id: string; name: string | null }>
    >([
      [
        'lt-mariners',
        [{ id: 'p-ian-noseda', name: 'Ian Noseda' }],
      ],
      [
        'lt-fenix',
        [{ id: 'p-kosma-knasiecki', name: 'Kosma Knasiecki' }],
      ],
    ])
    const guestPlayerByLeagueTeam = new Map<string, string>([
      ['lt-mariners', 'p-guest-lt-mariners'],
      ['lt-fenix', 'p-guest-lt-fenix'],
      ['lt-hygge', 'p-guest-lt-hygge'],
      ['lt-torpedo', 'p-guest-lt-torpedo'],
    ])

    it('"Kosma" → resolves to Kosma Knasiecki on Fenix via fuzzy first-name', () => {
      const d = decideRowAction({
        rowNumber: 9,
        rawMd: 'MD1',
        timestamp: '',
        scoringTeamName: 'Fenix FC',
        concedingTeamName: 'Mariners FC',
        scorerName: 'Kosma',
        assisterName: null,
        ...ctx,
        playersByLeagueTeam,
        guestPlayerByLeagueTeam,
      })
      expect(d.kind).toBe('INSERT')
      if (d.kind !== 'INSERT') throw new Error()
      expect(d.scorerId).toBe('p-kosma-knasiecki')
    })

    it('"Guest" → maps to per-team Guest based on scoring team', () => {
      const d = decideRowAction({
        rowNumber: 13,
        rawMd: 'MD1',
        timestamp: '',
        scoringTeamName: 'Mariners FC',
        concedingTeamName: 'Fenix FC',
        scorerName: 'Guest',
        assisterName: null,
        ...ctx,
        playersByLeagueTeam,
        guestPlayerByLeagueTeam,
      })
      expect(d.kind).toBe('INSERT')
      if (d.kind !== 'INSERT') throw new Error()
      expect(d.scorerId).toBe('p-guest-lt-mariners')
    })

    it('"Sergei Borodin" → maps to per-team Guest (former-player → Guest)', () => {
      // MD3 Mariners vs Hygge — both teams in the test fixture's matchByKey,
      // and Hygge has a guest player entry so we can verify the map lookup
      // by scoring team works when the scoring team is the away side.
      const d = decideRowAction({
        rowNumber: 18,
        rawMd: 'MD3',
        timestamp: '',
        scoringTeamName: 'Hygge SC',
        concedingTeamName: 'Mariners FC',
        scorerName: 'Sergei Borodin',
        assisterName: null,
        ...ctx,
        playersByLeagueTeam,
        guestPlayerByLeagueTeam,
      })
      expect(d.kind).toBe('INSERT')
      if (d.kind !== 'INSERT') throw new Error()
      expect(d.scorerId).toBe('p-guest-lt-hygge')
    })

    it('still SKIPs unknown phantom names (conservative — Guest is opt-in only)', () => {
      const d = decideRowAction({
        rowNumber: 99,
        rawMd: 'MD1',
        timestamp: '',
        scoringTeamName: 'Mariners FC',
        concedingTeamName: 'Fenix FC',
        scorerName: 'Random Phantom',
        assisterName: null,
        ...ctx,
        playersByLeagueTeam,
        guestPlayerByLeagueTeam,
      })
      expect(d.kind).toBe('SKIP')
      if (d.kind !== 'SKIP') throw new Error()
      expect(d.reason).toMatch(/unresolved-scorer/)
    })

    it('assister also gets the team context (assister on scoring team)', () => {
      const d = decideRowAction({
        rowNumber: 20,
        rawMd: 'MD1',
        timestamp: '',
        scoringTeamName: 'Fenix FC',
        concedingTeamName: 'Mariners FC',
        scorerName: 'Ian Noseda',
        assisterName: 'Kosma', // single-token; should resolve via fuzzy on Fenix
        ...ctx,
        playersByLeagueTeam,
        guestPlayerByLeagueTeam,
      })
      expect(d.kind).toBe('INSERT')
      if (d.kind !== 'INSERT') throw new Error()
      expect(d.assisterId).toBe('p-kosma-knasiecki')
    })
  })
})
