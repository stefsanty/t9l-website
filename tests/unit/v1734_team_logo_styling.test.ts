/**
 * v1.73.4 — Team logos standardized to rounded squares.
 *
 * Regression targets (stash-pop verification):
 * - CompressedMatchdaySchedule: img uses rounded-sm, NOT rounded-full.
 * - CompressedMatchdaySchedule: placeholder span uses rounded-sm, NOT rounded-full.
 * - RecruitingBanner: logo wrapper div uses rounded-md, NOT rounded-full.
 * - RecruitingBanner: fallback initial div uses rounded-md, NOT rounded-full.
 * - TopPerformers: team logo container div includes rounded-sm.
 * - TopPerformers: color-dot fallback uses rounded-sm, NOT rounded-full.
 * - Already-correct surfaces unchanged: UserTeamBadge (rounded-md),
 *   LeagueTable (rounded-md), SquadList (rounded-xl), MatchdayCard (rounded-lg).
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const readSrc = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8')

const compressed = readSrc('src/components/CompressedMatchdaySchedule.tsx')
const recruiting = readSrc('src/components/RecruitingBanner.tsx')
const performers = readSrc('src/components/TopPerformers.tsx')
const userBadge  = readSrc('src/components/UserTeamBadge.tsx')
const table      = readSrc('src/components/LeagueTable.tsx')
const squad      = readSrc('src/components/SquadList.tsx')
const card       = readSrc('src/components/MatchdayCard.tsx')

describe('v1.73.4 — CompressedMatchdaySchedule team logo styling', () => {
  it('team logo img uses rounded-sm (regression: must NOT be rounded-full)', () => {
    expect(compressed).toMatch(/team-logo-\$\{team\.id\}[\s\S]{0,200}rounded-sm/)
    expect(compressed).not.toMatch(/team-logo-\$\{team\.id\}[\s\S]{0,200}rounded-full/)
  })

  it('placeholder span uses rounded-sm (regression: must NOT be rounded-full)', () => {
    expect(compressed).toMatch(/team-logo-placeholder[\s\S]{0,200}rounded-sm/)
    expect(compressed).not.toMatch(/team-logo-placeholder[\s\S]{0,200}rounded-full/)
  })
})

describe('v1.73.4 — RecruitingBanner team logo styling', () => {
  it('logo wrapper div uses rounded-md (regression: must NOT be rounded-full)', () => {
    // The div containing the Image for State A team logo
    expect(recruiting).toMatch(/w-10 h-10 rounded-md overflow-hidden/)
    // The team logo wrapper must not be rounded-full (State B's warning icon
    // legitimately uses rounded-full, but that's not a team logo)
    expect(recruiting).not.toMatch(/w-10 h-10 rounded-full overflow-hidden/)
  })

  it('fallback initial div uses rounded-md (regression: must NOT be rounded-full)', () => {
    expect(recruiting).toMatch(/w-10 h-10 rounded-md bg-success/)
    expect(recruiting).not.toMatch(/w-10 h-10 rounded-full bg-success/)
  })
})

describe('v1.73.4 — TopPerformers team logo styling', () => {
  it('logo container div includes rounded-sm and overflow-hidden', () => {
    expect(performers).toMatch(/relative w-3 h-3 shrink-0 rounded-sm overflow-hidden/)
  })

  it('color-dot fallback uses rounded-sm (regression: must NOT be rounded-full)', () => {
    // The inline fallback div for team color dot
    expect(performers).toMatch(/w-full h-full rounded-sm/)
    expect(performers).not.toMatch(/w-full h-full rounded-full/)
  })
})

describe('v1.73.4 — unchanged surfaces retain rounded-square styling', () => {
  it('UserTeamBadge logo uses rounded-md', () => {
    expect(userBadge).toMatch(/rounded-md/)
  })

  it('LeagueTable team logo container uses rounded-md', () => {
    expect(table).toMatch(/rounded-md/)
  })

  it('SquadList team header logo uses rounded-xl', () => {
    expect(squad).toMatch(/rounded-xl/)
  })

  it('MatchdayCard team logo container uses rounded-lg', () => {
    expect(card).toMatch(/rounded-lg/)
  })
})

describe('v1.73.4 — version bump', () => {
  it('APP_VERSION is 1.73.4', () => {
    const ver = readSrc('src/lib/version.ts')
    expect(ver).toMatch(/1\.73\.4/)
  })
})
