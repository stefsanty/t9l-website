import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import RegistrationForm from './RegistrationForm'

/**
 * v1.67.2 — User-initiated registration route.
 *
 * Replaces the v1.67.0 `recruitToLeagueWithOnboarding` synthetic-invite
 * flow that left orphan empty Player + PLM rows in prod and surfaced
 * the "This invite has been used" error to the user (the synthetic
 * invite was created with `usedCount = maxUses = 1`, which `validateInvite`
 * rejects as `'used-up'` BEFORE the existingBinding-detection branch
 * could route to /onboarding).
 *
 * v1.67.2 design: NO Player or PLM created upfront. The user lands on
 * an empty form; on submit, the existing `applyToLeague` server action
 * creates Player + PLM(PENDING) atomically with all the collected
 * data. Same atomicity contract as admin invites, no synthetic-invite
 * gymnastics, no orphan rows on click-and-bounce.
 *
 * Route gates (server-side):
 *   - League not found → 404
 *   - League not recruiting → friendly "not recruiting" surface
 *   - No session → friendly "sign in to apply" surface
 *   - Admin-credentials session (no userId) → friendly "admin sessions
 *     can't apply" surface
 *   - User has existing Player → redirect to `/id/<slug>` (the apex
 *     RecruitingBanner already handles States A/B/D for them)
 *   - All gates passed (true State C) → render <RegistrationForm/>
 *
 * Form submit (handled in `RegistrationForm.tsx`):
 *   - Calls `applyToLeague({ leagueId, name, position })`
 *   - On success → router.push('/id/<slug>') where banner shows State B
 *     ("Application submitted")
 */

interface Props {
  params: Promise<{ slug: string }>
}

export default async function RecruitPage({ params }: Props) {
  const { slug: rawSlug } = await params
  const slug = normalizeLeagueSlug(rawSlug)

  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) notFound()

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, recruiting: true, subdomain: true },
  })
  if (!league) notFound()

  if (!league.recruiting) {
    return <NotRecruitingSurface leagueName={league.name} slug={slug} />
  }

  const session = await getServerSession(authOptions)
  if (!session) {
    return <SignInSurface slug={slug} leagueName={league.name} />
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) {
    return <AdminSessionSurface />
  }

  // Check user's existing Player binding. State C requires NO Player at all.
  // State A/B/D users are routed back to the apex `/id/<slug>` where the
  // RecruitingBanner already shows the right surface for their state.
  // v1.78.0 — also pull email + emailVerified so the form pre-fills the
  // email input when we already have a verified address (Google OAuth /
  // magic-link). Un-verified emails are not pre-filled — that would
  // soft-confirm an unverified address through this flow.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { playerId: true, email: true, emailVerified: true },
  })
  if (user?.playerId) {
    redirect(`/id/${slug}`)
  }
  const initialEmail = user?.email && user?.emailVerified ? user.email : ''

  return (
    <main
      className="min-h-dvh flex items-start justify-center px-4 py-8 bg-background"
      data-testid="recruit-registration"
    >
      <div className="max-w-lg w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-fg-mid text-sm mb-1">{league.name}</p>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-3">
          Apply to join
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          Tell us a bit about you. The league admin will review your application
          and assign you a team.
        </p>
        <RegistrationForm
          leagueId={league.id}
          leagueSlug={slug}
          leagueName={league.name}
          userId={userId}
          initialEmail={initialEmail}
        />
      </div>
    </main>
  )
}

function NotRecruitingSurface({ leagueName, slug }: { leagueName: string; slug: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background">
      <div
        className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 text-center"
        data-testid="recruit-not-recruiting"
      >
        <h1 className="text-xl font-display font-bold text-fg-high mb-2">
          Not currently recruiting
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          {leagueName} isn&apos;t accepting new applications right now. Check back
          later or contact the league admin.
        </p>
        <Link
          href={`/id/${slug}`}
          className="inline-block bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          Go to {leagueName}
        </Link>
      </div>
    </main>
  )
}

function SignInSurface({ slug, leagueName }: { slug: string; leagueName: string }) {
  const callback = `/recruit/${slug}`
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background">
      <div
        className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 text-center"
        data-testid="recruit-sign-in"
      >
        <h1 className="text-xl font-display font-bold text-fg-high mb-2">
          Sign in to apply
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          Sign in first to submit your application to {leagueName}.
        </p>
        <Link
          href={`/auth/signin?callbackUrl=${encodeURIComponent(callback)}`}
          className="inline-block bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </main>
  )
}

function AdminSessionSurface() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background">
      <div
        className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 text-center"
        data-testid="recruit-admin-session"
      >
        <h1 className="text-xl font-display font-bold text-fg-high mb-2">
          Admin sessions can&apos;t apply
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          You&apos;re signed in with an admin account. Sign in with a player
          account to submit an application.
        </p>
        <Link
          href="/admin"
          className="inline-block bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          Go to admin
        </Link>
      </div>
    </main>
  )
}
