import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

export type DataSource = 'sheets' | 'db'
export type WriteMode = 'sheets-only' | 'dual' | 'db-only'

/**
 * Returns the current public-site data source, falling back to 'sheets' if
 * the Setting row is absent (first-deploy default).
 *
 * Cached 30s under tag 'settings'. Toggle flips call `revalidateTag('settings')`.
 */
export const getDataSource = unstable_cache(
  async (): Promise<DataSource> => {
    // findFirst (not findUnique): the (category, key, leagueId) composite has
    // a nullable leagueId. Postgres treats NULL != NULL in unique indexes,
    // so Prisma's findUnique typing rejects null in that slot. The unique
    // constraint still prevents duplicate global rows in practice.
    const row = await prisma.setting.findFirst({
      where: { category: 'public', key: 'dataSource', leagueId: null },
    })
    const v = row?.value
    return v === 'db' ? 'db' : 'sheets'
  },
  ['setting:public:dataSource:global'],
  { revalidate: 30, tags: ['settings'] },
)

/**
 * Returns the current RSVP write mode, falling back to 'dual' if absent.
 * 'dual' is the safe pre-cutover default — both stores stay in sync.
 *
 * Cached 30s under tag 'settings'.
 */
export const getWriteMode = unstable_cache(
  async (): Promise<WriteMode> => {
    const row = await prisma.setting.findFirst({
      where: { category: 'public', key: 'writeMode', leagueId: null },
    })
    const v = row?.value
    if (v === 'sheets-only' || v === 'dual' || v === 'db-only') return v
    return 'dual'
  },
  ['setting:public:writeMode:global'],
  { revalidate: 30, tags: ['settings'] },
)
