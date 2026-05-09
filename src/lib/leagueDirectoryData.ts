/**
 * v1.85.0 — homepage redesign phase 1b. Server-only read for the public
 * `<LeagueDirectory>` listing.
 *
 * Surfaces every `League.visibility !== 'PRIVATE'` row with the bare
 * minimum needed to render a card (name, abbreviation, slug, location,
 * ballType, season label, status). PRIVATE leagues are hidden — the
 * directory is the discovery surface, and PRIVATE leagues require an
 * invite via `/join/<code>`.
 *
 * Cached for 60s under the `'leagues'` tag so admin visibility flips
 * (`setLeagueVisibility` → `revalidate({ domain: 'public' })`) propagate
 * to the directory on the next render.
 */

import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

export type DirectoryLeagueStatus = 'recruiting' | 'closed'

export interface DirectoryLeague {
  id: string
  name: string
  abbreviation: string | null
  slug: string
  location: string
  ballType: 'SOCCER' | 'FUTSAL'
  /**
   * Season label derived from `League.startDate` / `endDate`. Hand-picked
   * by an admin in a future phase; for now we synthesise a short
   * `"YYYY 春"`/`"YYYY 秋"` per JST month to match the existing brand
   * voice (e.g. `"T9L '26 春"` in the header). Returns `null` when
   * `startDate` is not parseable, in which case the card hides the row.
   */
  seasonLabel: string | null
  status: DirectoryLeagueStatus
}

const readDirectoryLeagues = unstable_cache(
  async (): Promise<DirectoryLeague[]> => {
    try {
      const rows = await prisma.league.findMany({
        where: { visibility: { not: 'PRIVATE' } },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          subdomain: true,
          isDefault: true,
          location: true,
          ballType: true,
          startDate: true,
          visibility: true,
        },
        orderBy: { name: 'asc' },
      })
      return rows
        .map((row): DirectoryLeague | null => {
          const slug = row.subdomain ?? (row.isDefault ? DEFAULT_LEAGUE_SLUG : null)
          if (!slug) return null
          return {
            id: row.id,
            name: row.name,
            abbreviation: row.abbreviation,
            slug,
            location: row.location,
            ballType: row.ballType,
            seasonLabel: deriveSeasonLabel(row.startDate),
            status: row.visibility === 'PUBLIC_OPEN' ? 'recruiting' : 'closed',
          }
        })
        .filter((row): row is DirectoryLeague => row !== null)
    } catch (err) {
      console.warn('[leagueDirectoryData] read failed; returning empty:', err)
      return []
    }
  },
  ['league-directory-public'],
  { revalidate: 60, tags: ['leagues'] },
)

export async function getDirectoryLeagues(): Promise<DirectoryLeague[]> {
  return readDirectoryLeagues()
}

/**
 * Pure: derive a short JST season label from a UTC startDate. JST is
 * UTC+9, so we add 9h before reading the month/year. Months 3–8 →
 * "YYYY 春", 9–12 + 1–2 → "YYYY 秋". `null` when the date isn't valid.
 *
 * Exported for unit testing without a DB read.
 */
export function deriveSeasonLabel(startDate: Date | null): string | null {
  if (!startDate) return null
  const ms = startDate.getTime()
  if (Number.isNaN(ms)) return null
  const jst = new Date(ms + 9 * 60 * 60 * 1000)
  const year = jst.getUTCFullYear()
  const month = jst.getUTCMonth() + 1
  const yy = String(year).slice(-2)
  if (month >= 3 && month <= 8) return `'${yy} 春`
  return `'${yy} 秋`
}
