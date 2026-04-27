import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

export type DataSource = 'sheets' | 'db'
export type WriteMode = 'sheets-only' | 'dual' | 'db-only'

/**
 * Deterministic ids for the two global Setting rows seeded by the
 * 20260427170000_seed_public_settings migration. Server actions in
 * `app/admin/leagues/actions.ts` upsert by these ids.
 */
export const SETTING_IDS = {
  publicDataSource: 's-public-dataSource-global',
  publicWriteMode: 's-public-writeMode-global',
} as const

/**
 * Returns the current public-site data source, falling back to 'sheets' if
 * the Setting row is absent (first-deploy default).
 *
 * Cached 30s under tag 'settings'. Toggle flips call `revalidateTag('settings')`.
 */
export const getDataSource = unstable_cache(
  async (): Promise<DataSource> => {
    const row = await prisma.setting.findUnique({
      where: { id: SETTING_IDS.publicDataSource },
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
    const row = await prisma.setting.findUnique({
      where: { id: SETTING_IDS.publicWriteMode },
    })
    const v = row?.value
    if (v === 'sheets-only' || v === 'dual' || v === 'db-only') return v
    return 'dual'
  },
  ['setting:public:writeMode:global'],
  { revalidate: 30, tags: ['settings'] },
)
