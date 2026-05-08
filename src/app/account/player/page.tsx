import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDefaultLeagueId } from '@/lib/leagueSlugServer'
import AccountPlayerForm, { type AccountPlayerFormProps } from './AccountPlayerForm'

/**
 * v1.37.0 (PR ι) — user self-service "Change player details".
 *
 * v1.59.1 — fixed gate that blocked legitimate LINE-auth users with a
 * linked Player but no `session.userId` (pre-v1.28.0 sessions, or any
 * case where `User.lineId` linkage drifted). Pre-v1.59.1 the page
 * rejected any session without `userId` as an "admin session" — but
 * `userId` is only set on JWTs created post-v1.28.0 by the PrismaAdapter.
 * A LINE user signed in before v1.28.0 deployed retains a `lineId`-only
 * JWT and was incorrectly bucketed with admin-credentials. This also
 * blocked LINE-auth admins (e.g. Stefan S, whose LINE ID is in
 * `ADMIN_LINE_IDS`) from editing their own player details — admin role
 * is orthogonal to "have a linked Player".
 *
 * New auth model: resolve the linked Player via `userId` first
 * (canonical post-α.5 / v1.27.0 binding) with `lineId` fallback (legacy
 * for grandfathered LINE sessions). The Player lookup is the gate; if
 * no Player resolves, render the appropriate empty state based on
 * what the session offers.
 *
 * Branches (in order):
 *   - No session → redirect to /auth/signin.
 *   - No userId AND no lineId (admin-credentials only) → friendly
 *     "this surface is for player accounts" message.
 *   - Player resolves → render form.
 *   - Otherwise (Google/email lurker, or LINE user with no link) →
 *     friendly "redeem your invite first" message.
 *
 * `force-dynamic` because the page reads the request session and Host
 * header (for league context). Revalidate on every navigation.
 */
export const dynamic = 'force-dynamic'

const ADMIN_CONTACT_EMAIL = 'vitoriatamachi@gmail.com'

export default async function AccountPlayerPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin?callbackUrl=/account/player')
  }

  const userId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty when admin-credentials);
  // coerce empty → null so the OR-fallback chain treats it as absent.
  const lineId = session.lineId || null

  // Admin-credentials sessions have neither — they can't have a player
  // bound. Show the friendly admin shell pointer.
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

  // Try userId first (canonical post-α.5 / v1.27.0 binding), then
  // fallback to lineId (legacy for pre-v1.28.0 LINE sessions). Both
  // identifiers are minted by the auth server; either is a safe lookup
  // key. Looking up by session.playerId (slug) alone is unsafe — admin
  // remap can leave the slug stale relative to the canonical binding.
  // v1.62.0 — drop the now-unused `Player.onboardingPreferences` JSON
  // read from the include (the form no longer surfaces preferences).
  const playerInclude = {
    leagueAssignments: {
      include: { leagueTeam: { include: { team: true, league: true } } },
      orderBy: { fromGameWeek: 'desc' as const },
    },
  }
  let player = userId
    ? await prisma.player.findUnique({ where: { userId }, include: playerInclude })
    : null
  if (!player && lineId) {
    player = await prisma.player.findUnique({ where: { lineId }, include: playerInclude })
  }

  // v1.70.0 — ID upload state lives on User. Fetch via the resolved
  // userId (or via the linked Player.userId fallback for legacy
  // lineId-only sessions).
  const idUserId = userId ?? player?.userId ?? null
  const idUser = idUserId
    ? await prisma.user.findUnique({
        where: { id: idUserId },
        select: { idUploadedAt: true },
      })
    : null

  if (!player) {
    // Authenticated but no Player linked. Two sub-cases share this
    // copy — Google/email lurker who hasn't redeemed an invite, or
    // LINE user with a session but no Player.lineId/userId match.
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

  // v1.53.0 — subdomain teardown. /account/player always operates on
  // the default league. A future PR can scope this to a per-league URL
  // if account editing per-league becomes a requirement.
  const leagueId = await getDefaultLeagueId()

  // Pick the assignment that matches the default league — falls back
  // to the most recent assignment if there's no match (e.g. user is
  // rostered only in a non-default league via /league/<slug>).
  // v1.65.0 — only consider memberships with a real leagueTeam (PENDING
  // applicants without a team aren't shown a "your team is X" surface).
  const realAssignments = player.leagueAssignments.filter((a) => a.leagueTeam !== null)
  const activeAssignment =
    (leagueId
      ? realAssignments.find((a) => a.leagueTeam!.leagueId === leagueId && a.toGameWeek === null)
      : null) ??
    realAssignments.find((a) => a.toGameWeek === null) ??
    realAssignments[0] ??
    null

  // v1.62.0 — `sessionPictureUrl` is the OAuth-provided picture (LINE
  // CDN for LINE users via `session.linePictureUrl`; Google profile
  // image is exposed at `session.user?.image` for non-LINE users). It
  // surfaces as the avatar/upload-preview default when the user has
  // neither uploaded a custom picture nor linked via the legacy
  // `/assign-player` mirror flow.
  const sessionPictureUrl =
    session.linePictureUrl ||
    (session.user as { image?: string | null } | undefined)?.image ||
    null

  const formProps: AccountPlayerFormProps = {
    initialName: player.name ?? '',
    // v1.65.4 — position lives on PlayerLeagueMembership, not Player.
    // Surface the position from the active membership in the default
    // league (or the most recent assignment as a fallback).
    initialPosition:
      activeAssignment?.position ??
      realAssignments[0]?.position ??
      null,
    profilePictureUrl: player.profilePictureUrl ?? null,
    pictureUrl: player.pictureUrl ?? null,
    sessionPictureUrl,
    blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    currentTeamName: activeAssignment?.leagueTeam?.team.name ?? null,
    currentLeagueName: activeAssignment?.leagueTeam?.league.name ?? null,
    hasUploadedId: !!idUser?.idUploadedAt,
    adminContactEmail: ADMIN_CONTACT_EMAIL,
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
          Update your name, picture, position, and preferences.
        </p>
        {children}
      </div>
    </div>
  )
}

