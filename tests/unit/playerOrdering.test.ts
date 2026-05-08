/**
 * v1.82.0 — `groupPlayersByPrimaryTeam` powers the cross-team scorer/
 * assister dropdowns. Pure helper, no I/O. Beneficiary (or opposing for
 * OG) team's roster sorted to the top, then "Other players" with every
 * remaining league member.
 */
import { describe, it, expect } from 'vitest'
import { groupPlayersByPrimaryTeam } from '@/lib/playerOrdering'

const TEAM_A = 'lt-a'
const TEAM_B = 'lt-b'
const TEAM_C = 'lt-c'

const PLAYERS = [
  { id: 'p-bob', name: 'Bob', teamId: TEAM_A },
  { id: 'p-alice', name: 'Alice', teamId: TEAM_A },
  { id: 'p-dave', name: 'Dave', teamId: TEAM_B },
  { id: 'p-charlie', name: 'Charlie', teamId: TEAM_B },
  { id: 'p-emma', name: 'Emma', teamId: TEAM_C },
]

describe('groupPlayersByPrimaryTeam', () => {
  it('puts the primary team first and other players second', () => {
    const groups = groupPlayersByPrimaryTeam(PLAYERS, TEAM_A, 'Team A')
    expect(groups).toHaveLength(2)
    expect(groups[0].label).toBe('Team A')
    expect(groups[0].players.map((p) => p.id)).toEqual(['p-alice', 'p-bob'])
    expect(groups[1].label).toBe('Other players')
    // Cross-team players sorted alphabetically: Charlie, Dave, Emma.
    expect(groups[1].players.map((p) => p.id)).toEqual(['p-charlie', 'p-dave', 'p-emma'])
  })

  it('sorts each group alphabetically (case-insensitive locale compare)', () => {
    const groups = groupPlayersByPrimaryTeam(
      [
        { id: 'p1', name: 'banana', teamId: TEAM_A },
        { id: 'p2', name: 'Apple', teamId: TEAM_A },
        { id: 'p3', name: 'cherry', teamId: TEAM_B },
        { id: 'p4', name: 'Berry', teamId: TEAM_B },
      ],
      TEAM_A,
      'Team A',
    )
    expect(groups[0].players.map((p) => p.name)).toEqual(['Apple', 'banana'])
    expect(groups[1].players.map((p) => p.name)).toEqual(['Berry', 'cherry'])
  })

  it('drops empty groups so the dropdown does not render an empty optgroup', () => {
    // Beneficiary team has zero members.
    const groups = groupPlayersByPrimaryTeam(
      [{ id: 'p1', name: 'Solo', teamId: TEAM_B }],
      TEAM_A,
      'Team A',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Other players')
  })

  it('drops the "other" group when every player is on the primary team', () => {
    const groups = groupPlayersByPrimaryTeam(
      [
        { id: 'p1', name: 'A', teamId: TEAM_A },
        { id: 'p2', name: 'B', teamId: TEAM_A },
      ],
      TEAM_A,
      'Team A',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Team A')
  })

  it('honors the custom otherLabel argument', () => {
    const groups = groupPlayersByPrimaryTeam(
      PLAYERS,
      TEAM_A,
      'Team A',
      'Guests / cross-team',
    )
    expect(groups[1].label).toBe('Guests / cross-team')
  })

  it('excludes ids in excludeIds from BOTH groups (used by assister to filter scorer)', () => {
    const groups = groupPlayersByPrimaryTeam(
      PLAYERS,
      TEAM_A,
      'Team A',
      undefined,
      new Set(['p-alice', 'p-emma']),
    )
    // Alice is in primary group → filtered. Emma is in other → filtered.
    expect(groups[0].players.map((p) => p.id)).toEqual(['p-bob'])
    expect(groups[1].players.map((p) => p.id)).toEqual(['p-charlie', 'p-dave'])
  })

  it('returns empty array when input list is empty', () => {
    expect(groupPlayersByPrimaryTeam([], TEAM_A, 'Team A')).toEqual([])
  })

  it('keeps a stable group key per primary team for React rendering', () => {
    const groups = groupPlayersByPrimaryTeam(PLAYERS, TEAM_A, 'Team A')
    expect(groups[0].key).toBe(`primary:${TEAM_A}`)
    expect(groups[1].key).toBe('other')
  })
})
