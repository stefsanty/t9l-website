import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { pickUserTeam } from '@/lib/userTeam'
import { teamIdToSlug } from '@/lib/ids'

const recruitingStateSrc = fs.readFileSync(
  path.resolve(__dirname, '../../src/lib/recruitingViewerState.ts'),
  'utf8',
)

describe('v1.73.2 — recruitingState.team.id slug normalization fix', () => {
  describe('source contract', () => {
    it('imports teamIdToSlug from @/lib/ids', () => {
      expect(recruitingStateSrc).toContain("from '@/lib/ids'")
      expect(recruitingStateSrc).toContain('teamIdToSlug')
    })

    it('normalizes team.id with teamIdToSlug in the approved_this branch', () => {
      // Regression target — v1.73.1 returned the raw DB id (`t-<slug>`),
      // which broke pickUserTeam comparisons against the public-data
      // teams[i].id (slug form).
      expect(recruitingStateSrc).toContain(
        'id: teamIdToSlug(approvedPlm.leagueTeam.team.id)',
      )
    })

    it('does not return raw DB id form for team.id (regression target)', () => {
      // The bare `id: approvedPlm.leagueTeam.team.id` shape was the v1.73.1 bug.
      // Re-introducing it would break the badge again.
      expect(recruitingStateSrc).not.toContain('id: approvedPlm.leagueTeam.team.id,')
    })
  })

  describe('pickUserTeam — id-shape compatibility regression', () => {
    // The teams[i].id in Dashboard's `teams` prop is the slug form
    // ("mariners-fc"), as produced by dbToPublicLeagueData via teamIdToSlug.
    const teams = [
      { id: 'mariners-fc', name: 'Mariners FC', shortName: 'MAR', color: '#000000', logo: null },
      { id: 'storm-united', name: 'Storm United', shortName: 'STO', color: '#000000', logo: null },
    ]

    it('matches when teamId is the slug form (post-v1.73.2 contract)', () => {
      const result = pickUserTeam(
        { playerId: 'p-stefan', teamId: 'mariners-fc' },
        teams,
      )
      expect(result?.id).toBe('mariners-fc')
      expect(result?.name).toBe('Mariners FC')
    })

    it('does NOT match when teamId is the raw DB form (the v1.73.1 bug shape)', () => {
      // This was the latent bug: recruitingState.team.id was "t-mariners-fc",
      // teams[0].id was "mariners-fc", they never matched, badge never rendered.
      const result = pickUserTeam(
        { playerId: 'p-stefan', teamId: 't-mariners-fc' },
        teams,
      )
      expect(result).toBeNull()
    })

    it('teamIdToSlug normalizes "t-mariners-fc" → "mariners-fc" (helper sanity)', () => {
      expect(teamIdToSlug('t-mariners-fc')).toBe('mariners-fc')
    })

    it('teamIdToSlug is idempotent on already-bare slugs', () => {
      expect(teamIdToSlug('mariners-fc')).toBe('mariners-fc')
    })
  })

  describe('Dashboard fallback chain', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/Dashboard.tsx'),
      'utf8',
    )

    it('falls back to userTeamId (session.teamId) when kind !== approved_this', () => {
      // Default-league users with no recruiting OR users in pending/no_player/
      // in_other_league states must still get the session.teamId fallback so
      // their default-league badge renders.
      expect(dashboardSrc).toContain(": userTeamId")
    })

    it('uses recruitingState.team.id when kind === approved_this', () => {
      expect(dashboardSrc).toContain("recruitingState?.kind === 'approved_this'")
      expect(dashboardSrc).toContain('recruitingState.team.id')
    })
  })
})
