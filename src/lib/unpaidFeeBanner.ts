/**
 * v1.66.0 — Server-side resolver for the unpaid-fee banner.
 *
 * Per outputs/v1.66.0-player-payment-status-spec.md. Returns the data
 * needed to render the unpaid-fee banner for the calling user in a
 * given league. Callers (Dashboard, /schedule, /stats — every league-
 * scoped public surface) thread the result through to the
 * UnpaidFeeBanner client component.
 *
 * Returns null when the banner should NOT render:
 *   - no session (visitor)
 *   - admin-credentials session (no userId)
 *   - User has no Player binding
 *   - Player has no PLM in this league
 *   - PLM.paidStatus === 'PAID'
 *   - resolved fee is 0 (no fee configured for this league)
 *   - League.paymentBannerEnabled === false (v1.96.0 — admin opt-out)
 *
 * Returns `{ membershipId, fee, leagueName }` when the banner SHOULD
 * render. The membershipId is included for future "pay now" CTA wiring;
 * v1.66.0 only uses the fee + leagueName to render the message.
 *
 * Defensive try/catch — Prisma read failure returns null (banner stays
 * hidden). Better to under-render than over-render an incorrect surface.
 *
 * v1.98.0 — session + user resolution moved into the shared
 * `getViewer()` helper (request-scoped via React `cache()`). This
 * function now skips the `getServerSession + user.findUnique`
 * preamble and reads the cached viewer directly. The per-league
 * `playerLeagueMembership.findFirst` + `league.findUnique` queries
 * are unchanged — they're genuinely scoped to leagueId.
 */
import { prisma } from '@/lib/prisma'
import { resolvePlayerFee } from '@/lib/playerFee'
import { getViewer } from '@/lib/viewer'

export interface UnpaidFeeBannerData {
  membershipId: string
  fee: number
  leagueName: string
}

export async function getUnpaidFeeBannerData(
  leagueId: string,
): Promise<UnpaidFeeBannerData | null> {
  const viewer = await getViewer()
  // Banner never renders for unauthenticated visitors OR for sessions
  // without a public-side identifier (admin-credentials). Pre-v1.98.0
  // the gate was `!session || !userId`; the new shape collapses both
  // into `!viewer.user` since `getViewer()` returns user=null in both
  // those branches.
  if (!viewer.user) return null
  if (!viewer.user.playerId) return null

  try {
    // Find the active PLM for this user in this league. Match by direct
    // leagueId column (v1.65.0 + dual-write) OR via leagueTeam.leagueId
    // (legacy backfilled rows). toGameWeek=null restricts to active.
    // v1.87.0 — exclude retired memberships; retired players no longer
    // owe the league fee.
    const plm = await prisma.playerLeagueMembership.findFirst({
      where: {
        playerId: viewer.user.playerId,
        toGameWeek: null,
        retiredAt: null,
        OR: [{ leagueId }, { leagueTeam: { leagueId } }],
      },
      select: {
        id: true,
        position: true,
        feeOverride: true,
        paidStatus: true,
      },
    })
    if (!plm) return null
    if (plm.paidStatus === 'PAID') return null

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        name: true,
        defaultFee: true,
        // v1.96.0 — admin-toggleable banner suppression. When the league
        // has the toggle off, short-circuit before resolving the fee.
        paymentBannerEnabled: true,
        positionFees: { select: { position: true, fee: true } },
      },
    })
    if (!league) return null
    if (!league.paymentBannerEnabled) return null

    const fee = resolvePlayerFee(
      { position: plm.position, feeOverride: plm.feeOverride },
      { defaultFee: league.defaultFee, positionFees: league.positionFees },
    )
    if (fee === 0) return null // no-fee leagues — banner stays hidden

    return {
      membershipId: plm.id,
      fee,
      leagueName: league.name,
    }
  } catch (err) {
    console.warn('[unpaidFeeBanner] resolver failed; banner stays hidden:', err)
    return null
  }
}
