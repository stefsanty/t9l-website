import { describe, it, expect } from 'vitest'
import {
  PLAYER_ID_PREFIX,
  TEAM_ID_PREFIX,
  playerIdToSlug,
  slugToPlayerId,
  stripPrefix,
  teamIdToSlug,
  slugToTeamId,
} from '@/lib/ids'

// JST formatting helpers moved to `lib/jst.ts` in v1.9.0 — their tests live
// in `tests/unit/jst.test.ts`.
// `mapAvailability` moved to `lib/rsvpMerge.ts` in PR 19 / v1.7.0 — its
// tests live in `tests/unit/rsvpMerge.test.ts` alongside the new
// merge-into-LeagueData logic.
// `stripPrefix` moved to `lib/ids.ts` in v1.12.0 — kept here as the contract
// pin for the underlying constant + the new wrapper helpers.

describe('stripPrefix', () => {
  it('removes the prefix when present', () => {
    expect(stripPrefix('t-mariners-fc', TEAM_ID_PREFIX)).toBe('mariners-fc')
    expect(stripPrefix('p-ian-noseda', PLAYER_ID_PREFIX)).toBe('ian-noseda')
  })

  it('returns input unchanged when prefix is absent', () => {
    expect(stripPrefix('mariners-fc', TEAM_ID_PREFIX)).toBe('mariners-fc')
    expect(stripPrefix('', TEAM_ID_PREFIX)).toBe('')
  })

  it('handles double-prefix safely (only strips once)', () => {
    expect(stripPrefix('t-t-mariners-fc', TEAM_ID_PREFIX)).toBe(
      't-mariners-fc',
    )
  })
})

describe('playerIdToSlug / slugToPlayerId', () => {
  it('strips the p- prefix', () => {
    expect(playerIdToSlug('p-ian-noseda')).toBe('ian-noseda')
  })

  it('passes through bare slugs', () => {
    expect(playerIdToSlug('ian-noseda')).toBe('ian-noseda')
  })

  it('round-trips bare slug → DB id', () => {
    expect(slugToPlayerId('ian-noseda')).toBe('p-ian-noseda')
  })

  it('is idempotent on already-prefixed inputs', () => {
    expect(slugToPlayerId('p-ian-noseda')).toBe('p-ian-noseda')
  })

  // v2.2.22 — Players minted after the PR-6 backfill have raw cuid ids
  // (e.g. Théo: 'cmp1vc4i1000110nl2l4pwi5u'). The roster adapter's
  // `playerIdToSlug` passes them through unchanged; the form sends that
  // bare cuid as `scorerPlayerSlug`. `slugToPlayerId` used to blindly
  // prepend `p-`, producing `p-cmp...` — a non-existent DB id — which
  // broke the Submit-Goal scorer lookup with the redacted RSC error.
  it('passes through bare cuid Player.ids', () => {
    expect(slugToPlayerId('cmp1vc4i1000110nl2l4pwi5u')).toBe(
      'cmp1vc4i1000110nl2l4pwi5u',
    )
  })

  it('round-trips a bare cuid through both halves', () => {
    const cuid = 'cmp1vc4i1000110nl2l4pwi5u'
    expect(slugToPlayerId(playerIdToSlug(cuid))).toBe(cuid)
  })
})

describe('teamIdToSlug / slugToTeamId', () => {
  it('strips the t- prefix', () => {
    expect(teamIdToSlug('t-mariners-fc')).toBe('mariners-fc')
  })

  it('passes through bare slugs', () => {
    expect(teamIdToSlug('mariners-fc')).toBe('mariners-fc')
  })

  it('round-trips bare slug → DB id', () => {
    expect(slugToTeamId('mariners-fc')).toBe('t-mariners-fc')
  })

  it('is idempotent on already-prefixed inputs', () => {
    expect(slugToTeamId('t-mariners-fc')).toBe('t-mariners-fc')
  })

  // v2.2.22 — same symmetry for LeagueTeam/Team rows minted via raw cuid.
  it('passes through bare cuid Team.ids', () => {
    expect(slugToTeamId('cmp1vc4i1000110nl2l4pwi5u')).toBe(
      'cmp1vc4i1000110nl2l4pwi5u',
    )
  })
})
