/**
 * v1.43.0 (PR γ) — pure helpers exported from `StatsTab.tsx` for the
 * events list. The component itself is too React-heavy for jsdom-free
 * snapshot testing; the structural assertions cover the load-bearing
 * shape (data-testid hooks, prop wiring, action imports).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filterEvents, rosterFor } from '@/components/admin/StatsTab'

const ROOT = join(__dirname, '..', '..')
const SOURCE = readFileSync(join(ROOT, 'src/components/admin/StatsTab.tsx'), 'utf-8')

const baseMatch = {
  id: 'm-1',
  homeTeamId: 'lt-h',
  awayTeamId: 'lt-a',
  homeTeam: { team: { name: 'Mariners FC' } },
  awayTeam: { team: { name: 'Fenix FC' } },
  gameWeek: { weekNumber: 3 },
}

function ev(overrides: Record<string, unknown>) {
  return {
    id: 'me-1',
    matchId: 'm-1',
    goalType: 'OPEN_PLAY' as const,
    minute: 47,
    scorer: { id: 'p-stefan', name: 'Stefan Santos' },
    assister: { id: 'p-alex', name: 'Alex' },
    match: baseMatch,
    ...overrides,
  }
}

describe('filterEvents', () => {
  const events = [
    ev({ id: 'e1', match: { ...baseMatch, gameWeek: { weekNumber: 1 } } }),
    ev({ id: 'e2', match: { ...baseMatch, gameWeek: { weekNumber: 2 } } }),
    ev({ id: 'e3', match: { ...baseMatch, gameWeek: { weekNumber: 3 } }, scorer: { id: 'p-other', name: 'Khrapov Tymur' } }),
  ]

  it('returns all events when no filter / no search', () => {
    expect(filterEvents(events, null, '')).toHaveLength(3)
  })

  it('filters by matchday', () => {
    const result = filterEvents(events, 2, '')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('e2')
  })

  it('case-insensitive search by scorer name', () => {
    const result = filterEvents(events, null, 'STEFAN')
    expect(result).toHaveLength(2) // e1 + e2 share Stefan
  })

  it('searches by team name', () => {
    expect(filterEvents(events, null, 'mariners')).toHaveLength(3)
    expect(filterEvents(events, null, 'fenix')).toHaveLength(3)
  })

  it('searches by assister name (when present)', () => {
    expect(filterEvents(events, null, 'alex')).toHaveLength(3)
  })

  it('matchday filter + search combine', () => {
    const result = filterEvents(events, 3, 'khrapov')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('e3')
  })
})

describe('rosterFor', () => {
  const leagueTeams = [
    {
      id: 'lt-h',
      team: { name: 'Mariners FC' },
      playerAssignments: [
        { leagueTeamId: 'lt-h', player: { id: 'p-1', name: 'Bob' } },
        { leagueTeamId: 'lt-h', player: { id: 'p-2', name: 'Alice' } },
        { leagueTeamId: 'lt-h', player: { id: 'p-3', name: null } }, // unnamed pre-stage; filtered
      ],
    },
    {
      id: 'lt-a',
      team: { name: 'Fenix FC' },
      playerAssignments: [
        { leagueTeamId: 'lt-a', player: { id: 'p-4', name: 'Charlie' } },
      ],
    },
  ]

  it('returns the team’s named players sorted by name', () => {
    const home = rosterFor(leagueTeams, 'lt-h')
    expect(home.map((p) => p.name)).toEqual(['Alice', 'Bob'])
  })

  it('returns empty for an unknown team id', () => {
    expect(rosterFor(leagueTeams, 'lt-stranger')).toEqual([])
  })

  it('skips players with null names (pre-stages)', () => {
    expect(rosterFor(leagueTeams, 'lt-h')).toHaveLength(2)
  })
})

describe('StatsTab structural shape (PR γ)', () => {
  it("imports the new admin actions", () => {
    expect(SOURCE).toMatch(/adminCreateMatchEvent/)
    expect(SOURCE).toMatch(/adminUpdateMatchEvent/)
    expect(SOURCE).toMatch(/adminDeleteMatchEvent/)
    expect(SOURCE).toMatch(/from '@\/app\/admin\/leagues\/actions'/)
  })

  it("exposes the events-section testids the e2e specs key off", () => {
    expect(SOURCE).toContain('data-testid="events-section"')
    expect(SOURCE).toContain('data-testid="events-search"')
    expect(SOURCE).toContain('data-testid="event-new-button"')
    expect(SOURCE).toContain('data-testid="event-editor"')
    expect(SOURCE).toContain('data-testid="event-editor-submit"')
    expect(SOURCE).toContain('data-testid="event-editor-scorer"')
    expect(SOURCE).toContain('data-testid="event-editor-assister"')
    expect(SOURCE).toContain('data-testid="event-editor-goaltype"')
  })

  it('declares the four GoalType labels', () => {
    expect(SOURCE).toMatch(/OPEN_PLAY/)
    expect(SOURCE).toMatch(/SET_PIECE/)
    expect(SOURCE).toMatch(/PENALTY/)
    expect(SOURCE).toMatch(/OWN_GOAL/)
  })

  it('OG selector advisory copy is present (so the user knows the picker filter flips)', () => {
    expect(SOURCE).toMatch(/OPPOSING/)
  })
})

describe('admin stats page wiring', () => {
  const PAGE = readFileSync(
    join(ROOT, 'src/app/admin/leagues/[id]/stats/page.tsx'),
    'utf-8',
  )

  it('fetches getLeagueEvents in addition to getLeagueStats', () => {
    expect(PAGE).toMatch(/getLeagueEvents/)
    expect(PAGE).toMatch(/getLeagueStats/)
  })

  it('threads events / eventMatches / eventLeagueTeams into StatsTab', () => {
    expect(PAGE).toMatch(/events=\{/)
    expect(PAGE).toMatch(/eventMatches=\{/)
    expect(PAGE).toMatch(/eventLeagueTeams=\{/)
  })
})
