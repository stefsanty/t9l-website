import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

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

/**
 * v1.65.2 / v1.65.3 / v1.65.4 — Membership-spec rework read-flip flag.
 *
 * Stage 3 (v1.65.2) shipped this flag with default 'legacy' (inert);
 * v1.65.3 flipped the default to 'plm'; v1.65.4 dropped the legacy
 * `Player.position` / `Player.applicationStatus` / `Player.applicationLeagueId`
 * columns entirely.
 *
 * Post-v1.65.4 the flag is **load-bearing for nothing** — every read
 * site is PLM-canonical because the legacy fields no longer exist in
 * the schema. The helper is preserved for backwards compat (so any
 * stale Setting rows or external references don't trip), but the
 * resolved value has no effect on application behavior.
 *
 * The Setting row can be safely deleted by an operator post-v1.65.4:
 *
 *   DELETE FROM "Setting"
 *    WHERE id = 's-playerData-readSource-global';
 *
 * A future cleanup PR (v1.66+) can drop this helper entirely when
 * confidence is high that no external consumer references it.
 */
export type PlayerDataReadSource = 'legacy' | 'plm'

export const SETTING_ID_PLAYER_DATA_READ_SOURCE = 's-playerData-readSource-global'

export function resolvePlayerDataReadSource(
  value: string | null | undefined,
): PlayerDataReadSource {
  return value === 'legacy' ? 'legacy' : 'plm'
}

export const getPlayerDataReadSource = unstable_cache(
  async (): Promise<PlayerDataReadSource> => {
    try {
      const row = await prisma.setting.findUnique({
        where: { id: SETTING_ID_PLAYER_DATA_READ_SOURCE },
      })
      return resolvePlayerDataReadSource(row?.value)
    } catch (err) {
      console.warn(
        '[settings] getPlayerDataReadSource failed; falling back to plm:',
        err,
      )
      return 'plm'
    }
  },
  ['setting:playerData:readSource:global'],
  { revalidate: 30, tags: ['settings'] },
)
