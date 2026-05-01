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
 * Pure resolver for the dataSource setting. Pulled out so the
 * fallback-on-missing-row contract can be unit-tested without Prisma mocking.
 *
 * Pre-v1.12 the fallback was `'sheets'` — that mirrored the pre-cutover
 * default during the migration, but post-cutover (PR 4 / 2026-04-27) every
 * environment runs on `'db'`. Leaving `'sheets'` as the fallback meant a
 * misconfigured restore — Setting row deleted, missing seed migration,
 * pointed at a fresh Neon branch — would silently route the public site at
 * the legacy Sheets parser. v1.12 inverts the default so a missing row
 * fails-safe to the Postgres path; operators flipping back to Sheets must
 * do so explicitly via the admin Settings UI.
 */
export function resolveDataSource(value: string | null | undefined): DataSource {
  return value === 'sheets' ? 'sheets' : 'db'
}

/**
 * Returns the current public-site data source.
 *
 * Cached 30s under tag 'settings'. Toggle flips call `revalidate({ domain: 'settings' })`.
 */
export const getDataSource = unstable_cache(
  async (): Promise<DataSource> => {
    const row = await prisma.setting.findUnique({
      where: { id: SETTING_IDS.publicDataSource },
    })
    return resolveDataSource(row?.value)
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

/**
 * v1.30.0 (stage γ) — identity-rework read-source flag.
 *
 * 'legacy' (default): JWT callback resolves Player by `Player.lineId @unique`.
 * 'user'           : JWT callback resolves Player by
 *                    `User.lineId → User.playerId → Player`.
 *
 * Both resolvers return the same shape (`{ playerId, playerName, teamId }`)
 * for the same input. The flag exists to gate the cutover safely:
 * stage 4 retires the legacy column, but only AFTER an extended soak with
 * the flag set to 'user' and zero drift between the two paths.
 *
 * Default 'legacy' is the load-bearing safety property — γ ships with the
 * code in place but inert. The operator-driven flip happens in a separate
 * step (PR #5 in the rollout sequence; not yet shipped) once the
 * backfillUserPlayerLink has populated User.playerId / Player.userId for
 * every existing linked human.
 */
export type IdentityReadSource = 'legacy' | 'user'

export const SETTING_ID_IDENTITY_READ_SOURCE = 's-identity-readSource-global'

export function resolveIdentityReadSource(
  value: string | null | undefined,
): IdentityReadSource {
  return value === 'user' ? 'user' : 'legacy'
}

export const getIdentityReadSource = unstable_cache(
  async (): Promise<IdentityReadSource> => {
    const row = await prisma.setting.findUnique({
      where: { id: SETTING_ID_IDENTITY_READ_SOURCE },
    })
    return resolveIdentityReadSource(row?.value)
  },
  ['setting:identity:readSource:global'],
  { revalidate: 30, tags: ['settings'] },
)
