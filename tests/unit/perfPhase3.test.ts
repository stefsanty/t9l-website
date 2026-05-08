import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * v1.80.4 — Phase 3 of the perf audit (handover-perf-audit.md):
 *
 *   H1 part 2  Add `sizes=` to every `<Image fill />` caller so next/image
 *              serves a small variant matching the rendered slot, instead of
 *              defaulting to the `100vw` srcset that ships up to a 3840px
 *              variant.
 *   M2         Defensive `take: 5000` on the unbounded admin-data
 *              findMany hot paths (goals, matchEvents, personal-invites)
 *              so future seasons can't turn an admin page render into an
 *              unbounded JSON payload.
 *
 * Each assertion fails on the pre-fix state. Stash-pop sanity-checked
 * during PR authoring.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * Find every `<Image ... fill ... />` JSX block in a source file. JSX
 * attributes don't fit cleanly into a single regex, so we walk the file
 * and pull out each `<Image` ... `/>` (or `</Image>`) span.
 */
function imageBlocks(src: string): string[] {
  const blocks: string[] = []
  let i = 0
  while (i < src.length) {
    const start = src.indexOf('<Image', i)
    if (start < 0) break
    // Find the closing `/>` (self-closing) or `>` (matched element).
    // Self-closing is the only form we use for next/image in this codebase.
    let end = start
    while (end < src.length) {
      if (src[end] === '/' && src[end + 1] === '>') { end += 2; break }
      if (src[end] === '>') { end += 1; break }
      end += 1
    }
    blocks.push(src.slice(start, end))
    i = end
  }
  return blocks
}

describe('perf phase 3 — H1 part 2: every <Image fill /> declares sizes=', () => {
  // Audit-listed callers (handover-perf-audit.md H1):
  //   PlayerAvatar, UserTeamBadge, MatchdayCard, SquadList, LeagueTable,
  //   TopPerformers. NextMatchdayBanner uses no <Image fill />; admin
  //   surfaces (AllTeamsList) already declared sizes pre-phase-3.
  //
  // Files NOT included use either explicit width/height (no fill) or
  // `unoptimized` (sizes is a no-op for unoptimized sources, but adding
  // it would be harmless — we still skip them to keep the regression
  // surface pinned to the audit's named call sites).
  const callers = [
    'src/components/PlayerAvatar.tsx',
    'src/components/UserTeamBadge.tsx',
    'src/components/MatchdayCard.tsx',
    'src/components/SquadList.tsx',
    'src/components/LeagueTable.tsx',
    'src/components/TopPerformers.tsx',
  ]

  for (const rel of callers) {
    it(`${rel}: every <Image fill /> has a sizes attr`, () => {
      const src = read(rel)
      const fillBlocks = imageBlocks(src).filter((b) => /\bfill\b/.test(b))
      expect(fillBlocks.length).toBeGreaterThan(0)
      for (const block of fillBlocks) {
        // Pre-fix: these blocks had no `sizes=` so next/image defaulted to
        // 100vw, which made the optimizer pick the largest variant in the
        // srcset (`_next/image?w=3840`) for what is rendered as a 12-64px
        // slot. Post-fix: each block declares `sizes="<rendered px>px"`.
        expect(block, block).toMatch(/\bsizes=\s*["{]/)
      }
    })
  }
})

describe('perf phase 3 — M2: defensive take on admin-data findMany hot paths', () => {
  const adminData = read('src/lib/admin-data.ts')

  it('goal.findMany has take: 5000', () => {
    // Pre-fix: `prisma.goal.findMany({ where: { match: { leagueId } }, ... })`
    // had no take. A league accruing several seasons of goals could grow
    // this query unboundedly; the cached payload then balloons too. The
    // defensive ceiling caps the foot-gun at a hard error rather than a
    // slow page.
    const goalCall = adminData.match(
      /prisma\.goal\.findMany\(\{[\s\S]*?\}\)/m,
    )
    expect(goalCall, 'goal.findMany block not found').not.toBeNull()
    expect(goalCall![0]).toMatch(/take:\s*5000\b/)
  })

  it('matchEvent.findMany has take: 5000', () => {
    const eventCall = adminData.match(
      /prisma\.matchEvent\.findMany\(\{[\s\S]*?\}\)/m,
    )
    expect(eventCall, 'matchEvent.findMany block not found').not.toBeNull()
    expect(eventCall![0]).toMatch(/take:\s*5000\b/)
  })

  it('leagueInvite.findMany (active personal invites) has take: 5000', () => {
    // The `where: { kind: 'PERSONAL', revokedAt: null, targetPlayerId: { not: null } }`
    // query is bounded by roster size today, but the audit listed it as
    // M2 because future invite churn can grow this. Defensive cap.
    const inviteCall = adminData.match(
      /prisma\.leagueInvite\.findMany\(\{[\s\S]*?kind:\s*['"]PERSONAL['"][\s\S]*?\}\)/m,
    )
    expect(inviteCall, 'leagueInvite PERSONAL block not found').not.toBeNull()
    expect(inviteCall![0]).toMatch(/take:\s*5000\b/)
  })
})
