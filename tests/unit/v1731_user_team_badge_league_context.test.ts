import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { pickUserTeam } from '@/lib/userTeam'

const badgeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/UserTeamBadge.tsx'),
  'utf8',
)
const dashboardSrc = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/Dashboard.tsx'),
  'utf8',
)

describe('v1.73.1 — UserTeamBadge cross-league context fix', () => {
  describe('UserTeamBadge source', () => {
    it('declares teamId in UserTeamBadgeProps interface', () => {
      expect(badgeSrc).toContain('teamId?: string | null')
    })

    it('uses teamIdProp ?? session?.teamId when calling pickUserTeam', () => {
      expect(badgeSrc).toContain('teamIdProp ?? session?.teamId')
    })

    it('does not pass raw session to pickUserTeam (regression: passing session ?? null re-introduces the bug)', () => {
      expect(badgeSrc).not.toContain('pickUserTeam(session ?? null')
    })
  })

  describe('Dashboard source', () => {
    it('derives currentLeagueTeamId from recruitingState when kind === approved_this', () => {
      expect(dashboardSrc).toContain("recruitingState?.kind === 'approved_this'")
    })

    it('passes teamId={currentLeagueTeamId} to UserTeamBadge', () => {
      expect(dashboardSrc).toContain('teamId={currentLeagueTeamId}')
    })

    it('does not pass bare <UserTeamBadge teams={teams} /> without teamId (regression target)', () => {
      const match = dashboardSrc.match(/<UserTeamBadge[^/]*\/>/g)
      if (match) {
        for (const m of match) {
          expect(m).toContain('teamId=')
        }
      }
    })
  })

  describe('pickUserTeam — behavioral cross-league scenario', () => {
    const teams = [
      { id: 'mariners-fc', name: 'Mariners FC', logo: null, color: null },
      { id: 'storm-united', name: 'Storm United', logo: null, color: null },
    ]

    it('returns the override teamId team when teamIdProp is set', () => {
      const result = pickUserTeam(
        { playerId: 'p-stefan', teamId: 'storm-united' },
        teams,
      )
      expect(result?.id).toBe('storm-united')
      expect(result?.name).toBe('Storm United')
    })

    it('does NOT return the session-default teamId team when overridden', () => {
      const result = pickUserTeam(
        { playerId: 'p-stefan', teamId: 'storm-united' },
        teams,
      )
      expect(result?.id).not.toBe('mariners-fc')
    })

    it('returns null when teamId is null (no badge on unlinked leagues)', () => {
      const result = pickUserTeam(
        { playerId: 'p-stefan', teamId: null },
        teams,
      )
      expect(result).toBeNull()
    })

    it('returns null when playerId is null (unauthenticated)', () => {
      const result = pickUserTeam(
        { playerId: null, teamId: 'mariners-fc' },
        teams,
      )
      expect(result).toBeNull()
    })

    it('returns null when session is null (unauthenticated visitor)', () => {
      expect(pickUserTeam(null, teams)).toBeNull()
    })
  })
})
