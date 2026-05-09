import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import SuccessConfirmationGate from '@/components/SuccessConfirmationGate'

/**
 * v1.34.0 (PR ζ) — post-redemption landing page.
 *
 * Reached via:
 *   - skipOnboarding invites: directly after `redeemInvite`.
 *   - normal flow: after `submitOnboarding` flips onboardingStatus to COMPLETED.
 *
 * Resolves the user's now-bound Player + the league. Displays a
 * confirmation card and a CTA to the league's home (`/id/<slug>` for
 * non-default leagues, apex `/` for the default league).
 *
 * If the user lands here without being signed in, or without a binding,
 * we redirect back to `/join/[code]` to let the route's normal
 * resolution handle them — they probably refreshed the page after
 * signing out, or shared the URL with someone.
 */

interface Props {
  params: Promise<{ code: string }>
}

export default async function WelcomePage({ params }: Props) {
  const { code } = await params

  const session = await getServerSession(authOptions)
  const userId = (session as { userId?: string | null } | null)?.userId ?? null
  if (!userId) {
    redirect(`/join/${code}`)
  }

  const invite = await prisma.leagueInvite.findUnique({
    where: { code },
    select: { leagueId: true },
  })
  if (!invite) {
    // Invite was revoked or deleted between redemption and welcome view.
    // Bounce back to the canonical resolver which will surface the right error.
    redirect(`/join/${code}`)
  }

  const [league, assignment] = await Promise.all([
    prisma.league.findUnique({
      where: { id: invite.leagueId },
      select: { id: true, name: true, subdomain: true },
    }),
    prisma.playerLeagueMembership.findFirst({
      where: {
        leagueTeam: { leagueId: invite.leagueId },
        player: { userId },
      },
      include: {
        // v1.65.4 — position lives on PLM, not Player; the welcome page
        // doesn't currently surface position so the include doesn't
        // need it, but kept consistent with onboarding/page.tsx.
        player: { select: { id: true, name: true } },
        leagueTeam: { include: { team: true } },
      },
    }),
  ])

  if (!league || !assignment) {
    redirect(`/join/${code}`)
  }

  const playerName = assignment.player.name ?? 'Unnamed'
  // v1.65.0 — leagueTeam nullable post-rework. The welcome page only
  // renders for COMPLETED memberships which always have a real team
  // (admin or invite-redemption flow always assigns one); defensive
  // fallback for the off-chance shape mismatch.
  const teamName = assignment.leagueTeam?.team.name ?? 'your team'
  // v1.55.0 (PR 2 of admin-UI-compat-audit chain): post-redemption home
  // URL flipped from the legacy subdomain form (`<slug>.t9l.me`) to the
  // v1.54.0 canonical path-based form (`/id/<slug>`). Apex stays as the
  // home URL when the league has no slug (only the default league
  // surfaces the apex shortcut).
  const homeUrl = league.subdomain ? `/id/${league.subdomain}` : '/'

  return (
    <main
      className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background"
      data-testid="join-welcome"
    >
      <div className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg text-center">
        <div className="text-5xl mb-4" aria-hidden="true">⚽</div>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-2">
          You're all set!
        </h1>
        <p className="text-fg-mid text-sm mb-1" data-testid="welcome-bind-line">
          You're linked to <strong className="text-fg-high">{playerName}</strong> on{' '}
          <strong className="text-fg-high">{teamName}</strong>.
        </p>
        <p className="text-fg-mid text-sm mb-5" data-testid="welcome-league-line">
          {league.name}
        </p>

        <Link
          href={homeUrl}
          className="inline-block w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          data-testid="welcome-go-home"
        >
          Go to {league.name}
        </Link>

        <p className="text-fg-low text-xs mt-5">
          Question or wrong slot? Contact your league admin.
        </p>
      </div>
      {/*
       * v1.81.2 — post-submit success popup gate. Reads
       * `?submitted=<descriptor>` from the URL and mounts the matching
       * confirmation modal. Wrapped in <Suspense> because
       * SuccessConfirmationGate uses `useSearchParams()`, which Next.js
       * requires to live under a Suspense boundary on a server-component
       * page (otherwise the build wraps the entire page in suspense).
       */}
      <Suspense fallback={null}>
        <SuccessConfirmationGate />
      </Suspense>
    </main>
  )
}
