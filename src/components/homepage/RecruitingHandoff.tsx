import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

/**
 * v1.85.0 — homepage redesign phase 1c. Capped "recruiting elsewhere"
 * hand-off rendered inside `<MultiLeagueHub>` for users with ≥ 2
 * APPROVED memberships.
 *
 * Surfaces up to TWO leagues that:
 *   - Are `visibility = 'PUBLIC_OPEN'` (actively recruiting).
 *   - The viewer is NOT already a member of (we exclude their
 *     APPROVED league ids; PENDING applications still surface so
 *     they can re-discover them, matching the existing recruiting
 *     banner's State B behaviour).
 *
 * Sorted by `League.updatedAt DESC` as the recency proxy. We don't
 * track `recruiting`-toggle history (that would require a separate
 * audit-log table); `updatedAt` flips on any league mutation, which
 * is a pragmatic "recently active" signal until a dedicated column
 * lands. Within the same `updatedAt` bucket Prisma's ordering is
 * deterministic (id ASC fallback).
 *
 * Renders nothing when there are zero candidate leagues — the
 * multi-league hub stays clean for users whose other leagues are all
 * `PUBLIC_CLOSED` / `PRIVATE`.
 */
export default async function RecruitingHandoff({
  excludeLeagueIds,
}: {
  excludeLeagueIds: ReadonlyArray<string>
}) {
  let candidates: Array<{
    id: string
    name: string
    abbreviation: string | null
    slug: string
    location: string
  }> = []
  try {
    const rows = await prisma.league.findMany({
      where: {
        visibility: 'PUBLIC_OPEN',
        id: { notIn: [...excludeLeagueIds] },
      },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        subdomain: true,
        isDefault: true,
        location: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 2,
    })
    candidates = rows
      .map((row) => {
        const slug = row.subdomain ?? (row.isDefault ? DEFAULT_LEAGUE_SLUG : null)
        if (!slug) return null
        return {
          id: row.id,
          name: row.name,
          abbreviation: row.abbreviation,
          slug,
          location: row.location,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  } catch (err) {
    console.warn('[RecruitingHandoff] read failed; rendering empty:', err)
    candidates = []
  }

  if (candidates.length === 0) return null

  return (
    <section
      data-testid="recruiting-handoff"
      className="mt-3 mb-4 rounded-2xl border border-border-default bg-surface px-3 py-3"
    >
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-low mb-2">
        Also recruiting
      </p>
      <ul className="space-y-2">
        {candidates.map((league) => (
          <li key={league.id}>
            <Link
              href={`/id/${league.slug}`}
              data-testid={`recruiting-handoff-card-${league.slug}`}
              className="flex items-center gap-3 p-2 rounded-xl bg-card border border-border-subtle hover:border-primary/50 transition-colors"
            >
              <div
                aria-hidden
                className="flex-shrink-0 w-10 h-10 rounded-lg bg-surface-md border border-border-subtle flex items-center justify-center font-display font-black text-sm uppercase text-fg-high"
              >
                {(league.abbreviation ?? league.name.charAt(0)).slice(0, 4)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-black uppercase tracking-tight text-fg-high truncate">
                  {league.name}
                </p>
                <p className="text-[10px] uppercase tracking-widest font-bold text-fg-low truncate">
                  {league.location}
                </p>
              </div>
              <span className="flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-primary/15 text-primary">
                Recruiting
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
