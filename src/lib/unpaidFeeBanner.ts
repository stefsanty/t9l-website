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
 *
 * Returns `{ membershipId, fee, leagueName }` when the banner SHOULD
 * render. The membershipId is included for future "pay now" CTA wiring;
 * v1.66.0 only uses the fee + leagueName to render the message.
 *
 * Defensive try/catch — Prisma read failure returns null (banner stays
 * hidden). Better to under-render than over-render an incorrect surface.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolvePlayerFee } from '@/lib/playerFee'

export interface UnpaidFeeBannerData {
  membershipId: string
  fee: number
  leagueName: string
}

export async function getUnpaidFeeBannerData(
  leagueId: string,
): Promise<UnpaidFeeBannerData | null> {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) return null

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { playerId: true },
    })
    if (!user?.playerId) return null

    // Find the active PLM for this user in this league. Match by direct
    // leagueId column (v1.65.0 + dual-write) OR via leagueTeam.leagueId
    // (legacy backfilled rows). toGameWeek=null restricts to active.
    const plm = await prisma.playerLeagueMembership.findFirst({
      where: {
        playerId: user.playerId,
        toGameWeek: null,
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
        positionFees: { select: { position: true, fee: true } },
      },
    })
    if (!league) return null

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
