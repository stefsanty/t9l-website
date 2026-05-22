import { describe, it, expect } from 'vitest'
import { resolveLeagueScopedTeamId } from '@/lib/playerTeamScope'

describe('resolveLeagueScopedTeamId', () => {
  // Regression target — v2.2.16 RSVP-footer bug.
  // session.teamId is JWT-resolved against the default league only.
  // When the user views a non-default league via `/id/<slug>`, the
  // RSVP-status lookup (`availabilityStatuses[mdId][teamId][playerId]`)
  // is keyed by the player's team IN THE RENDERED LEAGUE — derived in
  // rsvpMerge.ts from the league-scoped `players` array. Using
  // session.teamId there misses, and the footer renders "Are you
  // coming?" even though the player appears in the going-list.
  it('prefers the player team from the rendered (league-scoped) players array', () => {
    const got = resolveLeagueScopedTeamId({
      players: [
        { id: 'stefan-santosi', teamId: 'fenix-fc' },
        { id: 'other-player', teamId: 'mariners-fc' },
      ],
      userPlayerId: 'stefan-santosi',
      sessionTeamId: 'mariners-fc', // stale: from default league
    })
    expect(got).toBe('fenix-fc')
  })

  it('falls back to sessionTeamId when the player is not in this league', () => {
    const got = resolveLeagueScopedTeamId({
      players: [{ id: 'other-player', teamId: 'mariners-fc' }],
      userPlayerId: 'stefan-santosi',
      sessionTeamId: 'hygge-sc',
    })
    expect(got).toBe('hygge-sc')
  })

  it('falls back to sessionTeamId when userPlayerId is null', () => {
    const got = resolveLeagueScopedTeamId({
      players: [{ id: 'a', teamId: 't1' }],
      userPlayerId: null,
      sessionTeamId: 't-session',
    })
    expect(got).toBe('t-session')
  })

  it('returns null when neither the players array nor session has a team', () => {
    const got = resolveLeagueScopedTeamId({
      players: [],
      userPlayerId: 'stefan-santosi',
      sessionTeamId: null,
    })
    expect(got).toBeNull()
  })

  it('ignores an empty-string teamId on the in-league player and falls back to session', () => {
    // A PENDING applicant / team-less membership can surface as
    // `teamId: ''` from dbToPublicLeagueData. Treat that the same as
    // "not found" so we don't key RSVP lookups by empty string.
    const got = resolveLeagueScopedTeamId({
      players: [{ id: 'stefan-santosi', teamId: '' }],
      userPlayerId: 'stefan-santosi',
      sessionTeamId: 'mariners-fc',
    })
    expect(got).toBe('mariners-fc')
  })
})
