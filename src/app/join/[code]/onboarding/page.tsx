import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import OnboardingForm from './OnboardingForm'

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

  const [league, leagueTeams, currentBinding, existingPlayers] = await Promise.all([
    prisma.league.findUnique({
      where: { id: invite.leagueId },
      select: { id: true, name: true, subdomain: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: invite.leagueId },
      include: { team: true },
    }),
    prisma.playerLeagueAssignment.findFirst({
      where: {
        leagueTeam: { leagueId: invite.leagueId },
        player: { userId },
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            onboardingPreferences: true,
          },
        },
        leagueTeam: { include: { team: true } },
      },
    }),
    prisma.player.findMany({
      where: {
        leagueAssignments: {
          some: { leagueTeam: { leagueId: invite.leagueId } },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  if (!league || !currentBinding) {
    // Not bound — re-route through the resolver.
    redirect(`/join/${code}`)
  }

  // Pre-populate existing values from a prior submission (idempotent
  // re-render after admin resets onboarding, or after user came back
  // mid-flow). The JSON shape mirrors the `submitOnboarding` write.
  const prefs = (currentBinding.player.onboardingPreferences ?? null) as null | {
    preferredLeagueTeamId?: string | null
    preferredTeammateIds?: string[]
    preferredTeammatesFreeText?: string | null
  }

  const teammateOptions = existingPlayers
    .filter((p) => p.id !== currentBinding.player.id)
    .map((p) => ({ id: p.id, name: p.name ?? 'Unnamed' }))

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
          on <strong className="text-fg-high">{currentBinding.leagueTeam.team.name}</strong>.
          Filling this in helps the admin schedule matches.
        </p>

        <OnboardingForm
          code={code}
          playerId={currentBinding.player.id}
          initialName={currentBinding.player.name ?? ''}
          initialPosition={(currentBinding.player.position as 'GK' | 'DF' | 'MF' | 'FW' | null) ?? null}
          initialPreferredLeagueTeamId={prefs?.preferredLeagueTeamId ?? null}
          initialPreferredTeammateIds={prefs?.preferredTeammateIds ?? []}
          initialPreferredTeammatesFreeText={prefs?.preferredTeammatesFreeText ?? null}
          leagueTeams={leagueTeams.map((lt) => ({ id: lt.id, name: lt.team.name }))}
          teammateOptions={teammateOptions}
        />
      </div>
    </main>
  )
}
