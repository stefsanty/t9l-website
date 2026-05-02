import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueIdFromRequest } from '@/lib/getLeagueFromHost'
import AccountPlayerForm, { type AccountPlayerFormProps } from './AccountPlayerForm'

/**
 * v1.37.0 (PR ι) — user self-service "Change player details".
 *
 * Auth gates (in order):
 *   - No session → redirect to /auth/signin so the user picks a provider.
 *   - admin-credentials session (no userId) → friendly "this surface is
 *     for player accounts" message with a /admin link.
 *   - authenticated lurker (userId but no playerId) → friendly
 *     "redeem your invite first" message.
 *   - bound user → render the form.
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
  if (!userId) {
    return (
      <Shell>
        <div className="bg-card border border-border-default rounded-2xl p-6 text-fg-mid">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high mb-3">
            Admin sessions can't edit here
          </h1>
          <p className="text-sm leading-relaxed">
            This page is for player accounts. Admins manage players through{' '}
            <Link href="/admin" className="text-electric-green hover:underline">
              the admin shell
            </Link>
            .
          </p>
        </div>
      </Shell>
    )
  }

  const playerId = session.playerId ?? null
  if (!playerId) {
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

  const player = await prisma.player.findUnique({
    where: { userId },
    include: {
      leagueAssignments: {
        include: { leagueTeam: { include: { team: true, league: true } } },
        orderBy: { fromGameWeek: 'desc' },
      },
    },
  })

  if (!player) {
    // Session has playerId but Player.userId doesn't resolve. Possible
    // post-admin-remap drift; surface as the lurker view rather than 500.
    return (
      <Shell>
        <div className="bg-card border border-border-default rounded-2xl p-6 text-fg-mid">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high mb-3">
            Player not found
          </h1>
          <p className="text-sm leading-relaxed mb-4">
            Your session references a player that no longer exists or has
            been remapped. Sign out and back in, or contact{' '}
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

  // Resolve the request's league context so we can show the right
  // assignment + roster for the teammate-preference picker.
  const leagueId = await getLeagueIdFromRequest()

  // Pick the assignment that matches the request league (default-league
  // on apex; subdomain's league elsewhere) — falls back to the most
  // recent assignment if there's no match (e.g. user visited the apex
  // but is currently rostered in a subdomain league).
  const activeAssignment =
    (leagueId
      ? player.leagueAssignments.find((a) => a.leagueTeam.leagueId === leagueId && a.toGameWeek === null)
      : null) ??
    player.leagueAssignments.find((a) => a.toGameWeek === null) ??
    player.leagueAssignments[0] ??
    null

  // Roster for the teammate-preference picker — every player in the
  // SAME league as the active assignment (or empty if no assignment yet).
  const teammateOptions = activeAssignment
    ? await prisma.player.findMany({
        where: {
          id: { not: player.id },
          leagueAssignments: {
            some: { leagueTeam: { leagueId: activeAssignment.leagueTeam.leagueId } },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : []

  // Teams in the same league for the team-preference picker.
  const leagueTeams = activeAssignment
    ? await prisma.leagueTeam.findMany({
        where: { leagueId: activeAssignment.leagueTeam.leagueId },
        include: { team: true },
        orderBy: { team: { name: 'asc' } },
      })
    : []

  // Decode prior preferences (JSON) into form-friendly shape.
  const prefs = parsePreferences(player.onboardingPreferences)

  const formProps: AccountPlayerFormProps = {
    initialName: player.name ?? '',
    initialPosition: player.position ?? null,
    initialPreferredLeagueTeamId: prefs.preferredLeagueTeamId,
    initialPreferredTeammateIds: prefs.preferredTeammateIds,
    initialPreferredTeammatesFreeText: prefs.preferredTeammatesFreeText,
    profilePictureUrl: player.profilePictureUrl ?? null,
    pictureUrl: player.pictureUrl ?? null,
    leagueTeams: leagueTeams.map((lt) => ({ id: lt.id, name: lt.team.name })),
    teammateOptions: teammateOptions.map((t) => ({ id: t.id, name: t.name ?? 'Unnamed' })),
    blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    currentTeamName: activeAssignment?.leagueTeam.team.name ?? null,
    currentLeagueName: activeAssignment?.leagueTeam.league.name ?? null,
    hasUploadedId: !!player.idUploadedAt,
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

interface ParsedPreferences {
  preferredLeagueTeamId: string | null
  preferredTeammateIds: string[]
  preferredTeammatesFreeText: string | null
}

function parsePreferences(raw: unknown): ParsedPreferences {
  if (!raw || typeof raw !== 'object') {
    return {
      preferredLeagueTeamId: null,
      preferredTeammateIds: [],
      preferredTeammatesFreeText: null,
    }
  }
  const obj = raw as Record<string, unknown>
  const ids = Array.isArray(obj.preferredTeammateIds)
    ? (obj.preferredTeammateIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return {
    preferredLeagueTeamId:
      typeof obj.preferredLeagueTeamId === 'string' ? obj.preferredLeagueTeamId : null,
    preferredTeammateIds: ids,
    preferredTeammatesFreeText:
      typeof obj.preferredTeammatesFreeText === 'string' ? obj.preferredTeammatesFreeText : null,
  }
}
