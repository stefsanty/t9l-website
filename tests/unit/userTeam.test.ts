/**
 * Unit tests for the v1.11.0 / PR C `pickUserTeam` helper that drives
 * the homepage "Your team is X" badge's render branches.
 *
 * Verifies the BEHAVIOR (per CLAUDE.md "End-to-end verification rule"):
 *   (1) returns null for unauthenticated visitors → no badge renders
 *   (2) returns null for authenticated-but-unlinked LINE users (teamId
 *       is the empty string in this state) → no flash of "your team is null"
 *   (3) returns the matching Team when session has playerId + teamId
 *       AND teams contains the matching ID
 *   (4) returns null when teamId references a team not in the list
 *       (data-drift; e.g. league cutover artifact where the user's
 *       JWT teamId is from a previous league)
 *
 * Pinning these branches at the helper level means a regression — say,
 * accidentally rendering the badge when session is undefined — would
 * fail this suite, not just the visual smoke.
 */
import { describe, it, expect } from 'vitest'
import { pickUserTeam } from '@/lib/userTeam'
import type { Team } from '@/types'

const teams: Team[] = [
  { id: 'mariners-fc', name: 'Mariners FC', shortName: 'Mariners', color: '#0070f3', logo: '/team_logos/Mariners FC.png' },
  { id: 'fenix-fc', name: 'Fenix FC', shortName: 'Fenix', color: '#ffaa00', logo: '/team_logos/Fenix FC.png' },
  { id: 'hygge-sc', name: 'Hygge SC', shortName: 'Hygge', color: '#22c55e', logo: null },
]

describe('pickUserTeam — render-branch contract for UserTeamBadge', () => {
  it('returns null for an unauthenticated session (the unauth flash-of-no-badge prevention)', () => {
    expect(pickUserTeam(null, teams)).toBeNull()
    expect(pickUserTeam(undefined, teams)).toBeNull()
  })

  it('returns null when session has no playerId (LINE-authed but unlinked)', () => {
    expect(pickUserTeam({ playerId: null, teamId: 'mariners-fc' }, teams)).toBeNull()
    expect(pickUserTeam({ playerId: '', teamId: 'mariners-fc' }, teams)).toBeNull()
  })

  it('returns null when session has no teamId (linked but team-membership not resolved)', () => {
    expect(pickUserTeam({ playerId: 'p-stefan', teamId: null }, teams)).toBeNull()
    expect(pickUserTeam({ playerId: 'p-stefan', teamId: '' }, teams)).toBeNull()
  })

  it('returns the matching Team when session has playerId + teamId and teamId is in teams', () => {
    const result = pickUserTeam({ playerId: 'p-stefan', teamId: 'mariners-fc' }, teams)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('mariners-fc')
    expect(result?.name).toBe('Mariners FC')
    expect(result?.logo).toBe('/team_logos/Mariners FC.png')
  })

  it('returns null when teamId is not in teams (data drift across league cutover)', () => {
    expect(pickUserTeam({ playerId: 'p-stefan', teamId: 'old-league-team' }, teams)).toBeNull()
  })

  it('returns the team even when its logo is null (initial-fallback path)', () => {
    const result = pickUserTeam({ playerId: 'p-stefan', teamId: 'hygge-sc' }, teams)
    expect(result?.id).toBe('hygge-sc')
    expect(result?.logo).toBeNull()
    // The component branch on `team.logo === null` renders the colored
    // initial badge instead of the <Image>; the helper just returns
    // the team unchanged.
  })

  it('handles empty teams list gracefully', () => {
    expect(pickUserTeam({ playerId: 'p-stefan', teamId: 'mariners-fc' }, [])).toBeNull()
  })
})
