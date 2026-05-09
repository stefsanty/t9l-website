import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDefaultLeagueId } from '@/lib/leagueSlugServer'
import { resolvePlayerFee } from '@/lib/playerFee'
import { readPositions, type BallType } from '@/lib/positions'
import AccountPlayerForm, {
  type AccountPlayerFormProps,
  type LeagueCardData,
} from './AccountPlayerForm'

/**
 * v1.83.0 — multi-league redesign of "My player details".
 *
 * Pre-v1.83.0 the page resolved `getDefaultLeagueId()` and surfaced
 * exactly ONE PlayerLeagueMembership (the default league's, falling
 * back to the most-recent assignment). A user rostered in two leagues
 * saw only one — and the old `updatePlayerSelf` overwrote every active
 * PLM with the same submitted positions[] (`actions.ts:144-201`
 * pre-rebase), so a player who plays GK in League A and FW in League B
 * literally couldn't represent that.
 *
 * v1.83.0 — read every active membership and pass per-league data to
 * the form. Cards are split server-side into one `LeagueCardData` per
 * active PLM. The form renders one card per league, each with its own
 * `PositionMultiSelect` (driven by THAT league's ballType) and its own
 * Save button → scoped `updatePlayerLeague` server action that writes
 * exactly one PLM. No more cross-league bleed.
 *
 * Auth gate (unchanged from v1.59.1):
 *   - No session → redirect to /auth/signin.
 *   - No userId AND no lineId (admin-credentials only) → friendly
 *     "this surface is for player accounts" message.
 *   - Player resolves → render form.
 *   - Otherwise (Google/email lurker, or LINE user with no link) →
 *     friendly "redeem your invite first" message.
 *
 * Empty-active-memberships (new branch, reachable only post-v1.83.0
 * because the old single-league shape short-circuited via
 * activeAssignment fallback to realAssignments[0]):
 *   - Player resolves but has zero `toGameWeek === null` rows → render
 *     just the profile section (name + picture + ID-upload state) and
 *     a friendly "you're not currently rostered in any league" note.
 *
 * `force-dynamic` because the page reads the request session and
 * (post-v1.83.0) all of the player's memberships, which change as
 * admins approve applications. Revalidate on every navigation.
 */
export const dynamic = 'force-dynamic'

const ADMIN_CONTACT_EMAIL = 'vitoriatamachi@gmail.com'

export default async function AccountPlayerPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin?callbackUrl=/account/player')
  }

  const userId = (session as { userId?: string | null }).userId ?? null
  const lineId = session.lineId || null

  if (!userId && !lineId) {
    return (
      <Shell>
        <div className="bg-card border border-border-default rounded-2xl p-6 text-fg-mid">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high mb-3">
            Admin-only sessions can't edit here
          </h1>
          <p className="text-sm leading-relaxed">
            This page is for player accounts. Sign in via LINE / Google /
            email to edit your linked player, or manage players through{' '}
            <Link href="/admin" className="text-electric-green hover:underline">
              the admin shell
            </Link>
            .
          </p>
        </div>
      </Shell>
    )
  }

  // v1.83.0 — include EVERY active membership's needed fields. Eager-
  // load `league.positionFees` so the per-card fee resolver runs from
  // the same data without an extra round-trip.
  const playerInclude = {
    leagueAssignments: {
      include: {
        leagueTeam: { include: { team: true, league: true } },
        league: {
          include: {
            positionFees: { select: { position: true, fee: true } },
          },
        },
      },
      orderBy: { fromGameWeek: 'desc' as const },
    },
  }
  let player = userId
    ? await prisma.player.findUnique({ where: { userId }, include: playerInclude })
    : null
  if (!player && lineId) {
    player = await prisma.player.findUnique({ where: { lineId }, include: playerInclude })
  }

  const idUserId = userId ?? player?.userId ?? null
  const idUser = idUserId
    ? await prisma.user.findUnique({
        where: { id: idUserId },
        select: { idUploadedAt: true },
      })
    : null

  if (!player) {
    return (
      <Shell>
        <div className="bg-card border border-border-default rounded-2xl p-6 text-fg-mid">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high mb-3">
            No player linked yet
          </h1>
          <p className="text-sm leading-relaxed mb-4">
            You're signed in but haven't been linked to a player yet. Once
            an admin sends you a join link (or you redeem an open invite),
            you'll be able to edit your details here.
          </p>
          <p className="text-sm leading-relaxed">
            Need a link? Email{' '}
            <a
              href={`mailto:${ADMIN_CONTACT_EMAIL}`}
              className="text-electric-green hover:underline"
            >
              {ADMIN_CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </Shell>
    )
  }

  const sessionPictureUrl =
    session.linePictureUrl ||
    (session.user as { image?: string | null } | undefined)?.image ||
    null

  const defaultLeagueId = await getDefaultLeagueId()

  // v1.83.0 — build one LeagueCardData per ACTIVE membership
  // (toGameWeek === null). PENDING applications surface as cards too —
  // they have no leagueTeam but still carry leagueId + applicationStatus.
  // Cards sort: default league first, then APPROVED alphabetical, then
  // PENDING (alphabetical) last.
  const activeMemberships = player.leagueAssignments.filter(
    (m) => m.toGameWeek === null,
  )
  const leagueCards: LeagueCardData[] = activeMemberships
    .map((m): LeagueCardData | null => {
      // The membership has `leagueId` directly (v1.65.0); fall back to
      // the join through leagueTeam for older rows that haven't backfilled.
      const league =
        (m.league as typeof m.league | null) ??
        m.leagueTeam?.league ??
        null
      if (!league) return null
      const ballType = (league.ballType as BallType | undefined) ?? 'SOCCER'
      const teamName = m.leagueTeam?.team.name ?? null
      const positions = readPositions({
        positions: m.positions ?? null,
        position: m.position ?? null,
      })
      const positionFees =
        ('positionFees' in league && Array.isArray(league.positionFees)
          ? league.positionFees
          : []) as ReadonlyArray<{ position: string; fee: number }>
      const resolvedFeeJpy = resolvePlayerFee(
        { position: m.position ?? null, feeOverride: m.feeOverride ?? null },
        { defaultFee: league.defaultFee ?? 0, positionFees },
      )
      return {
        leagueId: league.id,
        leagueName: league.name,
        leagueAbbreviation: league.abbreviation ?? null,
        ballType,
        applicationStatus: m.applicationStatus,
        membershipStatus: m.status,
        teamName,
        positions,
        jerseyNumber: m.jerseyNumber ?? null,
        resolvedFeeJpy,
        hasFeeOverride: m.feeOverride !== null,
        paidStatus: m.paidStatus,
        idShared: m.idShared,
        comments: m.comments ?? null,
        isDefaultLeague: defaultLeagueId !== null && league.id === defaultLeagueId,
      }
    })
    .filter((c): c is LeagueCardData => c !== null)
    .sort((a, b) => {
      // Default league always first.
      if (a.isDefaultLeague && !b.isDefaultLeague) return -1
      if (!a.isDefaultLeague && b.isDefaultLeague) return 1
      // APPROVED before PENDING.
      if (a.applicationStatus !== b.applicationStatus) {
        return a.applicationStatus === 'APPROVED' ? -1 : 1
      }
      // Alphabetical within the same status.
      return a.leagueName.localeCompare(b.leagueName)
    })

  const formProps: AccountPlayerFormProps = {
    initialName: player.name ?? '',
    profilePictureUrl: player.profilePictureUrl ?? null,
    pictureUrl: player.pictureUrl ?? null,
    sessionPictureUrl,
    blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    hasUploadedId: !!idUser?.idUploadedAt,
    adminContactEmail: ADMIN_CONTACT_EMAIL,
    leagues: leagueCards,
  }

  return (
    <Shell>
      <AccountPlayerForm {...formProps} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-fg-mid hover:text-fg-high text-xs uppercase tracking-widest font-bold mb-6"
        >
          ← Home
        </Link>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight text-fg-high mb-1">
          My player details
        </h1>
        <p className="text-sm text-fg-mid mb-8">
          Update your name, picture, and per-league settings.
        </p>
        {children}
      </div>
    </div>
  )
}
