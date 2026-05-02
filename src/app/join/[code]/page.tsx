import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateInvite } from '@/lib/joinValidation'
import { formatInviteCodeForDisplay } from '@/lib/inviteCodes'
import RedeemPersonalForm from './RedeemPersonalForm'
import RedeemCodePicker from './RedeemCodePicker'

/**
 * v1.34.0 (PR ζ of the onboarding chain) — public redemption landing.
 *
 * Resolves the invite code → renders one of seven branches:
 *   1. Unknown / typo                  → "we don't recognise this code"
 *   2. Expired                         → "this invite expired on X"
 *   3. Revoked                         → "this invite has been revoked"
 *   4. Used-up                         → "this invite has been used N/N times"
 *   5. Valid + signed-out              → preview card + sign-in CTA
 *      (PERSONAL: shows pinned target; CODE: shows league name)
 *   6. Valid + signed-in + PERSONAL    → "Is this you?" confirm card
 *   7. Valid + signed-in + CODE        → roster picker
 *
 * After successful redemption (`redeemInvite` server action), the user
 * lands on either `/join/[code]/onboarding` (form) or `/join/[code]/welcome`
 * (skipOnboarding=true) per the action's `redirectTo`.
 *
 * Public route — no auth required to view. Sign-in is the YES gate, not
 * a render-time gate, because PERSONAL invites are personalised
 * previews that must be readable to confirm.
 */

interface Props {
  params: Promise<{ code: string }>
}

// JSON-friendly shape for the client components — Date / Decimal / etc.
// don't cross the server-component boundary cleanly.
interface PreviewLeague {
  id: string
  name: string
  subdomain: string | null
}
interface PreviewPlayer {
  id: string
  name: string | null
  position: string | null
  pictureUrl: string | null
  teamName: string | null
}
interface PreviewLeagueTeam {
  id: string
  name: string
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params

  // 1. Lookup invite
  const invite = await prisma.leagueInvite.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      kind: true,
      leagueId: true,
      targetPlayerId: true,
      expiresAt: true,
      revokedAt: true,
      usedCount: true,
      maxUses: true,
      skipOnboarding: true,
    },
  })

  // 2. Validate
  const validation = validateInvite(invite, { now: new Date() })

  if (validation.kind !== 'ok') {
    return <ErrorState validation={validation} code={code} />
  }
  // After the kind === 'ok' guard, `invite` is non-null.
  if (!invite) return <ErrorState validation={{ kind: 'not-found' }} code={code} />

  // 3. Resolve preview data — league + (for PERSONAL) the target Player.
  const league = await prisma.league.findUnique({
    where: { id: invite.leagueId },
    select: { id: true, name: true, subdomain: true },
  })
  if (!league) {
    // League was deleted out from under the invite — treat as not-found.
    return <ErrorState validation={{ kind: 'not-found' }} code={code} />
  }

  // 4. Branch on signed-in state.
  const session = await getServerSession(authOptions)
  const isSignedIn = !!session
  const userId = (session as { userId?: string | null } | null)?.userId ?? null

  // If already signed in AND already bound to a player in this league,
  // route to the right step in the flow. Idempotent re-visit.
  if (isSignedIn && userId) {
    const existingBinding = await prisma.playerLeagueAssignment.findFirst({
      where: {
        leagueTeam: { leagueId: invite.leagueId },
        player: { userId },
      },
      select: {
        onboardingStatus: true,
        player: { select: { name: true } },
      },
    })
    if (existingBinding) {
      // Three-stage resolver post-η:
      //   COMPLETED                   → /welcome
      //   NOT_YET + name set          → /id-upload (form done, ID pending)
      //   NOT_YET + no name           → /onboarding (form not done)
      if (existingBinding.onboardingStatus === 'COMPLETED') {
        redirect(`/join/${code}/welcome`)
      } else if (existingBinding.player.name) {
        redirect(`/join/${code}/id-upload`)
      } else {
        redirect(`/join/${code}/onboarding`)
      }
    }
  }

  if (invite.kind === 'PERSONAL') {
    if (!invite.targetPlayerId) {
      return <ErrorState validation={{ kind: 'not-found' }} code={code} />
    }
    const target = await prisma.player.findUnique({
      where: { id: invite.targetPlayerId },
      select: {
        id: true,
        name: true,
        position: true,
        pictureUrl: true,
        leagueAssignments: {
          where: { leagueTeam: { leagueId: invite.leagueId } },
          take: 1,
          orderBy: { fromGameWeek: 'desc' },
          include: { leagueTeam: { include: { team: true } } },
        },
      },
    })
    if (!target) return <ErrorState validation={{ kind: 'not-found' }} code={code} />

    const player: PreviewPlayer = {
      id: target.id,
      name: target.name,
      position: target.position,
      pictureUrl: target.pictureUrl,
      teamName: target.leagueAssignments[0]?.leagueTeam.team.name ?? null,
    }

    return (
      <PersonalPreview
        league={league}
        player={player}
        code={code}
        isSignedIn={isSignedIn}
        skipOnboarding={invite.skipOnboarding}
      />
    )
  }

  // CODE flavor — present roster picker (signed-in) OR league preview + sign-in CTA.
  if (!isSignedIn) {
    return (
      <CodePreviewSignedOut
        league={league}
        code={code}
      />
    )
  }

  // Signed-in CODE flow: fetch unlinked players in this league for the picker.
  const leagueTeams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id },
    include: {
      team: true,
      playerAssignments: {
        where: { toGameWeek: null }, // current assignments only
        include: { player: true },
      },
    },
  })
  const teamRefs: PreviewLeagueTeam[] = leagueTeams.map((lt) => ({
    id: lt.id,
    name: lt.team.name,
  }))
  const unlinkedPlayers = leagueTeams.flatMap((lt) =>
    lt.playerAssignments
      .filter((pa) => pa.player.userId === null)
      .map((pa) => ({
        id: pa.player.id,
        name: pa.player.name,
        position: pa.player.position,
        pictureUrl: pa.player.pictureUrl,
        teamId: lt.id,
        teamName: lt.team.name,
      })),
  )

  return (
    <CodePreviewSignedIn
      league={league}
      code={code}
      players={unlinkedPlayers}
      leagueTeams={teamRefs}
      skipOnboarding={invite.skipOnboarding}
    />
  )
}

// ── Error states ─────────────────────────────────────────────────────────────

function ErrorState({
  validation,
  code,
}: {
  validation: ReturnType<typeof validateInvite>
  code: string
}) {
  let title = 'Invite issue'
  let body = ''
  switch (validation.kind) {
    case 'not-found':
      title = 'Invite not recognised'
      body = `We couldn’t find an invite for the code “${code}”. Check for typos, or ask the league admin for a new one.`
      break
    case 'expired':
      title = 'This invite has expired'
      body = `Expired on ${validation.expiredAt.toLocaleDateString()}. Ask the league admin for a fresh invite.`
      break
    case 'revoked':
      title = 'This invite has been revoked'
      body = `The league admin revoked this invite on ${validation.revokedAt.toLocaleDateString()}. Ask them for a new one.`
      break
    case 'used-up':
      title = 'This invite has been used'
      body = `It’s been redeemed ${validation.usedCount} of ${validation.maxUses} allowed times. Ask the admin to issue a new invite.`
      break
    case 'wrong-league':
      title = 'Invite mismatch'
      body = 'This invite is not for the league you’re trying to join.'
      break
    case 'ok':
      // Unreachable — caller only invokes ErrorState on non-ok.
      break
  }
  return (
    <main
      className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background"
      data-testid="join-error"
    >
      <div className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <h1 className="text-2xl font-display font-bold text-fg-high mb-3">{title}</h1>
        <p className="text-fg-mid text-sm mb-5" data-testid="join-error-body">{body}</p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Go to homepage
        </Link>
      </div>
    </main>
  )
}

// ── Personal preview (signed-in or signed-out) ───────────────────────────────

function PersonalPreview({
  league,
  player,
  code,
  isSignedIn,
  skipOnboarding,
}: {
  league: PreviewLeague
  player: PreviewPlayer
  code: string
  isSignedIn: boolean
  skipOnboarding: boolean
}) {
  return (
    <main
      className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background"
      data-testid="join-personal"
    >
      <div className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-fg-mid text-sm mb-1">You're being invited to</p>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-5" data-testid="join-league-name">
          {league.name}
        </h1>

        <div className="flex items-center gap-4 mb-5 p-4 bg-background rounded-md border border-border-default">
          {player.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.pictureUrl}
              alt={player.name ?? 'Player'}
              className="w-16 h-16 rounded-full object-cover bg-surface border border-border-subtle"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-surface border border-border-subtle flex items-center justify-center text-fg-mid font-bold text-lg">
              {player.name?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-fg-high text-lg" data-testid="join-target-name">
              {player.name ?? <span className="italic text-fg-mid">Unnamed slot</span>}
            </p>
            {player.position && (
              <p className="text-fg-mid text-xs uppercase tracking-wider" data-testid="join-target-position">
                {player.position}
              </p>
            )}
            {player.teamName && (
              <p className="text-fg-mid text-sm" data-testid="join-target-team">
                Team: {player.teamName}
              </p>
            )}
          </div>
        </div>

        <p className="text-fg-mid text-sm mb-5">Is this you?</p>

        <RedeemPersonalForm
          code={code}
          isSignedIn={isSignedIn}
          inviteCode={code}
          skipOnboarding={skipOnboarding}
        />

        <p className="text-fg-low text-xs mt-4 text-center font-mono" data-testid="join-code-display">
          {formatInviteCodeForDisplay(code)}
        </p>
      </div>
    </main>
  )
}

// ── Code preview, signed out (just sign-in CTA) ──────────────────────────────

function CodePreviewSignedOut({
  league,
  code,
}: {
  league: PreviewLeague
  code: string
}) {
  return (
    <main
      className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background"
      data-testid="join-code-signed-out"
    >
      <div className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-fg-mid text-sm mb-1">You're invited to join</p>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-3" data-testid="join-league-name">
          {league.name}
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          Sign in below, then pick the player slot you'd like to claim.
        </p>
        <Link
          href={`/auth/signin?callbackUrl=${encodeURIComponent(`/join/${code}`)}`}
          className="inline-block w-full text-center rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          data-testid="join-signin-cta"
        >
          Sign in to continue
        </Link>
        <p className="text-fg-low text-xs mt-4 text-center font-mono" data-testid="join-code-display">
          {formatInviteCodeForDisplay(code)}
        </p>
      </div>
    </main>
  )
}

// ── Code preview, signed in (roster picker) ──────────────────────────────────

function CodePreviewSignedIn({
  league,
  code,
  players,
  leagueTeams,
  skipOnboarding,
}: {
  league: PreviewLeague
  code: string
  players: Array<{
    id: string
    name: string | null
    position: string | null
    pictureUrl: string | null
    teamId: string
    teamName: string
  }>
  leagueTeams: PreviewLeagueTeam[]
  skipOnboarding: boolean
}) {
  if (players.length === 0) {
    return (
      <main
        className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background"
        data-testid="join-code-empty"
      >
        <div className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
          <p className="text-fg-mid text-sm mb-1">{league.name}</p>
          <h1 className="text-2xl font-display font-bold text-fg-high mb-3">Roster is full</h1>
          <p className="text-fg-mid text-sm mb-5">
            Every roster slot in this league is already claimed. Ask the league admin to add a slot for you.
          </p>
          <Link
            href="/"
            className="inline-block rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Go to homepage
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-dvh flex items-start justify-center px-4 py-8 bg-background"
      data-testid="join-code-signed-in"
    >
      <div className="max-w-lg w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-fg-mid text-sm mb-1">Welcome to</p>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-3" data-testid="join-league-name">
          {league.name}
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          Pick the player slot you'd like to claim. Don't see your name? Ask the admin to add a slot for you.
        </p>
        <RedeemCodePicker
          code={code}
          players={players}
          leagueTeams={leagueTeams}
          skipOnboarding={skipOnboarding}
        />
      </div>
    </main>
  )
}
