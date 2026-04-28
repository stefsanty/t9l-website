import { describe, it, expect } from 'vitest'
import { annotatePlayersWithLinkedStatus } from '@/lib/linkedPlayers'
import type { Player, Team } from '@/types'

/**
 * `annotatePlayersWithLinkedStatus` is the data-side gate for PR 14 / v1.4.2:
 * it tags each picker row with `linked: true` when another LINE user already
 * holds that `Player.lineId`. The client renders linked rows greyed-out and
 * non-clickable so the user can't trip the false-success path (optimistic UI
 * flip → 409 from the API a second later).
 *
 * The pure annotator (no Prisma I/O) is the unit-testable seam. The Prisma
 * fetch (`getLinkedPlayerIds`) is integration-level and skipped here — the
 * helper is exercised end-to-end by the Playwright spec instead.
 */

const team1: Team = {
  id: 'mariners-fc',
  name: 'Mariners FC',
  shortName: 'MAR',
  color: '#0044ff',
  logo: null,
}
const team2: Team = {
  id: 'fenix-fc',
  name: 'Fenix FC',
  shortName: 'FEN',
  color: '#ffcc00',
  logo: null,
}

function p(id: string, teamId: string, name: string): Player {
  return { id, name, teamId, position: null, picture: null }
}

describe('annotatePlayersWithLinkedStatus', () => {
  it('marks players whose ids are in the linked set as linked: true', () => {
    const groups = [
      { team: team1, players: [p('ian-noseda', 'mariners-fc', 'Ian Noseda')] },
    ]
    const result = annotatePlayersWithLinkedStatus(
      groups,
      new Set(['ian-noseda']),
    )
    expect(result[0].players[0]).toMatchObject({ id: 'ian-noseda', linked: true })
  })

  it('marks players not in the set as linked: false', () => {
    const groups = [
      {
        team: team1,
        players: [
          p('ian-noseda', 'mariners-fc', 'Ian Noseda'),
          p('stefan-santos', 'mariners-fc', 'Stefan Santos'),
        ],
      },
    ]
    const result = annotatePlayersWithLinkedStatus(
      groups,
      new Set(['ian-noseda']),
    )
    expect(result[0].players[0].linked).toBe(true)
    expect(result[0].players[1].linked).toBe(false)
  })

  it('handles an empty linked set — every row is selectable', () => {
    const groups = [
      {
        team: team1,
        players: [
          p('a', 'mariners-fc', 'A'),
          p('b', 'mariners-fc', 'B'),
        ],
      },
    ]
    const result = annotatePlayersWithLinkedStatus(groups, new Set())
    expect(result[0].players.every((pl) => pl.linked === false)).toBe(true)
  })

  it('preserves group order, team metadata, and player ordering', () => {
    const groups = [
      {
        team: team1,
        players: [
          p('a', 'mariners-fc', 'A'),
          p('b', 'mariners-fc', 'B'),
        ],
      },
      {
        team: team2,
        players: [p('c', 'fenix-fc', 'C')],
      },
    ]
    const result = annotatePlayersWithLinkedStatus(groups, new Set(['b']))
    expect(result.map((g) => g.team.id)).toEqual(['mariners-fc', 'fenix-fc'])
    expect(result[0].players.map((pl) => pl.id)).toEqual(['a', 'b'])
    expect(result[0].players.map((pl) => pl.linked)).toEqual([false, true])
    expect(result[1].players[0].linked).toBe(false)
  })

  it('preserves all original Player fields verbatim — only adds `linked`', () => {
    const groups = [
      {
        team: team1,
        players: [
          {
            id: 'ian-noseda',
            name: 'Ian Noseda',
            teamId: 'mariners-fc',
            position: 'GK',
            picture: 'https://example.com/ian.png',
          },
        ],
      },
    ]
    const result = annotatePlayersWithLinkedStatus(groups, new Set(['ian-noseda']))
    expect(result[0].players[0]).toEqual({
      id: 'ian-noseda',
      name: 'Ian Noseda',
      teamId: 'mariners-fc',
      position: 'GK',
      picture: 'https://example.com/ian.png',
      linked: true,
    })
  })

  it('does not mutate the input groups', () => {
    const groups = [
      { team: team1, players: [p('a', 'mariners-fc', 'A')] },
    ]
    const before = JSON.stringify(groups)
    annotatePlayersWithLinkedStatus(groups, new Set(['a']))
    expect(JSON.stringify(groups)).toBe(before)
  })

  it('does NOT mark the viewer as linked when the caller has already excluded them from the set', () => {
    // The page server-side passes `viewerLineId` to `getLinkedPlayerIds`, which
    // applies the `NOT { lineId: viewerLineId }` filter. By the time it reaches
    // the annotator, the viewer's slug is absent from `linkedIds`, so the row
    // renders as selectable (the viewer can re-confirm or unassign). This test
    // pins that boundary: the annotator itself does not know about viewers.
    const groups = [
      {
        team: team1,
        players: [
          p('ian-noseda', 'mariners-fc', 'Ian Noseda'),
          p('stefan-santos', 'mariners-fc', 'Stefan Santos'),
        ],
      },
    ]
    // Caller-supplied set: only ian-noseda (claimed by someone else); the
    // viewer's own slug stefan-santos is already excluded upstream.
    const result = annotatePlayersWithLinkedStatus(
      groups,
      new Set(['ian-noseda']),
    )
    expect(result[0].players.find((pl) => pl.id === 'stefan-santos')?.linked).toBe(false)
    expect(result[0].players.find((pl) => pl.id === 'ian-noseda')?.linked).toBe(true)
  })
})
