import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import OnboardingForm from './OnboardingForm'
import { getTeamPickerOptions } from '@/lib/onboarding-team-options'

/**
 * v1.34.0 (PR ζ) — onboarding form, reached after `redeemInvite`
 * succeeds with `skipOnboarding=false`.
 *
 * Resolves the user's now-bound Player + their league context, then
 * renders the form (name / position / team preference / teammate
 * preferences). The form server-action `submitOnboarding` writes the
 * collected data and flips `onboardingStatus` to COMPLETED, redirecting
 * to `/join/[code]/welcome`.
 *
 * If the user lands here without being signed in OR without being
 * bound to a player in this league, bounce back to `/join/[code]`
 * for the canonical resolver to surface the correct state.
 *
 * Idempotent on re-visit: if onboardingStatus is already COMPLETED,
 * we still render the form (it's safe to re-submit) but pre-populate
 * the existing values. PR θ's "Reset onboarding" admin action flips
 * the status back to NOT_YET, which is what gets the user redirected
 * here on next visit.
 */

interface Props {
  params: Promise<{ code: string }>
}

export default async function OnboardingPage({ params }: Props) {
  const { code } = await params

  const session = await getServerSession(authOptions)
  const userId = (session as { userId?: string | null } | null)?.userId ?? null
  if (!userId) {
    redirect(`/join/${code}`)
  }

  const invite = await prisma.leagueInvite.findUnique({
    where: { code },
    select: { leagueId: true, skipOnboarding: true },
  })
  if (!invite) {
    redirect(`/join/${code}`)
  }

  // v1.62.0 — preferred-team / preferred-teammate fields removed from
  // the form. We no longer fetch leagueTeams or the in-league roster
  // for the picker.
  // v1.78.0 — also fetch User.email + emailVerified so the form pre-fills
  // when we already have a verified address.
  const [league, currentBinding, userRow] = await Promise.all([
    prisma.league.findUnique({
      where: { id: invite.leagueId },
      // v1.82.0 — `ballType` drives the position chip vocabulary.
      // v1.93.0 — `idRequired` controls whether the ID-upload section
      // renders in `RegistrationFields`.
      select: {
        id: true,
        name: true,
        subdomain: true,
        ballType: true,
        idRequired: true,
        // v2.2.9 — gates the onboarding team-picker step. Default false.
        allowPlayerTeamPick: true,
      },
    }),
    prisma.playerLeagueMembership.findFirst({
      where: {
        leagueTeam: { leagueId: invite.leagueId },
        player: { userId },
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
          },
        },
        leagueTeam: { include: { team: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    }),
  ])

  if (!league || !currentBinding) {
    // Not bound — re-route through the resolver.
    redirect(`/join/${code}`)
  }
  const initialEmail = userRow?.email && userRow?.emailVerified ? userRow.email : ''

  // v2.2.9 — fetch team-picker options only when the toggle is ON; an
  // empty array keeps the form-side conditional simple.
  const teamPickerOptions = league.allowPlayerTeamPick
    ? await getTeamPickerOptions(league.id, currentBinding.player.id, league.ballType)
    : []

  return (
    <main
      className="min-h-dvh flex items-start justify-center px-4 py-8 bg-background"
      data-testid="join-onboarding"
    >
      <div className="max-w-lg w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-fg-mid text-sm mb-1">{league.name}</p>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-3">
          Tell us a bit about you
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          You're linked to{' '}
          <strong className="text-fg-high">
            {currentBinding.player.name ?? 'this slot'}
          </strong>{' '}
          on <strong className="text-fg-high">{currentBinding.leagueTeam?.team.name ?? 'this team'}</strong>.
          Filling this in helps the admin schedule matches.
        </p>

        <OnboardingForm
          code={code}
          playerId={currentBinding.player.id}
          initialName={currentBinding.player.name ?? ''}
          initialEmail={initialEmail}
          // v1.82.0 — multi-position. Prefer the new `positions[]`
          // array; fall through to the legacy single `position` for
          // memberships that haven't been re-saved since the migration.
          initialPositions={
            currentBinding.positions && currentBinding.positions.length > 0
              ? currentBinding.positions
              : currentBinding.position
                ? [currentBinding.position]
                : []
          }
          ballType={league.ballType}
          idRequired={league.idRequired}
          allowPlayerTeamPick={league.allowPlayerTeamPick}
          teamPickerOptions={teamPickerOptions}
        />
      </div>
    </main>
  )
}
