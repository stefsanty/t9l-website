import { unstable_cache } from 'next/cache'
import type { LeagueData } from '@/types'
import { fetchSheetData } from './sheets'
import { parseAllData } from './data'
import { dbToPublicLeagueData } from './dbToPublicLeagueData'
import { getDataSource } from './settings'

/**
 * Two separately-cached source readers + a dispatcher. Per the migration plan
 * (§4 C5), `unstable_cache` keys must be statically known at the call site —
 * we can't read `dataSource` from the DB and feed it as a key. So define one
 * cache wrapper per source; the dispatcher decides which to invoke.
 *
 * Both wrappers share the `public-data` tag so a manual `revalidateTag('public-data')`
 * (e.g. on RSVP write or admin mutation) busts whichever path is currently active.
 */

const getFromSheets = unstable_cache(
  async (): Promise<LeagueData> => parseAllData(await fetchSheetData()),
  ['public-data:sheets'],
  { revalidate: 300, tags: ['public-data', 'sheet-data'] },
)

const getFromDb = unstable_cache(
  async (): Promise<LeagueData> => dbToPublicLeagueData(),
  ['public-data:db'],
  { revalidate: 30, tags: ['public-data', 'leagues'] },
)

/**
 * Returns the public `LeagueData` from the configured source. Default
 * (`Setting.public.dataSource`) is `'sheets'` — preserves existing behavior
 * until the operator flips the toggle in admin Settings (PR 3 lands the UI;
 * PR 4 is the operational flip).
 */
export async function getPublicLeagueData(): Promise<LeagueData> {
  const source = await getDataSource()
  return source === 'db' ? getFromDb() : getFromSheets()
}
