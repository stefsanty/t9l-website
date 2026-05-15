import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import { getTeamPickerOptions } from '@/lib/onboarding-team-options'
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
 *   - v1.80.10 — admin-orthogonal-UX rule: route resolves the User row
 *     by `userId` OR `lineId` (User.lineId @unique). Sessions that
 *     resolve to neither (admin-credentials shared-password) get a
 *     neutral "sign in with a player account" surface — no admin-shaming
 *     copy, mirrors the action gate in `applyToLeague` /
 *     `registerToLeague`.
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
    // v1.82.0 — `ballType` drives the position chip vocabulary in
    // RegistrationFields (SOCCER → 12 codes; FUTSAL → GK/FIXO/ALA/PIVOT).
    // v2.2.11 — also select `allowPlayerTeamPick` so the recruit
    // self-serve form can mount `TeamPickerSection` when the toggle is
    // on. Closes the recruit-flow picker-bypass surface identified in
    // the v2.2.11 entry-path audit.
    select: {
      id: true,
      name: true,
      recruiting: true,
      subdomain: true,
      ballType: true,
      idRequired: true,
      allowPlayerTeamPick: true,
    },
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
  // session.lineId is typed `string` (empty string for admin-credentials).
  const lineId = session.lineId || null
  if (!userId && !lineId) {
    return <NoPlayerAccountSurface />
  }

  // v1.80.10 — resolve User by `userId` first, falling back to `lineId`
  // so legacy LINE sessions (and LINE-auth admins, whose admin role is
  // orthogonal to player binding per docs/admin-orthogonal-ux.md) flow
  // through identically to non-admins. Mirrors the v1.59.1 fallback
  // pattern in `account/player/actions.ts`.
  // State C requires NO Player at all. State A/B/D users are routed back
  // to the apex `/id/<slug>` where RecruitingBanner shows the right
  // surface. v1.78.0 — also pull email + emailVerified so the form
  // pre-fills the email input when we already have a verified address
  // (Google OAuth / magic-link). Un-verified emails are not pre-filled.
  let user: { id: string; playerId: string | null; email: string | null; emailVerified: Date | null } | null = null
  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, playerId: true, email: true, emailVerified: true },
    })
  }
  if (!user && lineId) {
    user = await prisma.user.findUnique({
      where: { lineId },
      select: { id: true, playerId: true, email: true, emailVerified: true },
    })
  }
  if (!user) {
    return <NoPlayerAccountSurface />
  }
  if (user.playerId) {
    redirect(`/id/${slug}`)
  }
  const initialEmail = user.email && user.emailVerified ? user.email : ''

  // v2.2.11 — fetch team-picker options only when the toggle is ON. The
  // recruit form is the State C entry path (fresh Player, no
  // currentPlayerId yet), so `getTeamPickerOptions` is called with
  // `currentPlayerId = null` — every active member of every team in the
  // league shows up (no self-exclusion). Mirrors the shape used by
  // `src/app/join/[code]/onboarding/page.tsx`.
  const teamPickerOptions = league.allowPlayerTeamPick
    ? await getTeamPickerOptions(league.id, null, league.ballType)
    : []

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
          userId={user.id}
          initialEmail={initialEmail}
          ballType={league.ballType}
          idRequired={league.idRequired}
          allowPlayerTeamPick={league.allowPlayerTeamPick}
          teamPickerOptions={teamPickerOptions}
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

/**
 * v1.80.10 — replaces the v1.67.2 `AdminSessionSurface`. Admin role is
 * orthogonal to user-facing UX (docs/admin-orthogonal-ux.md); copy is
 * neutral — the only thing missing is a player account, which any
 * session without a userId or lineId lacks.
 */
function NoPlayerAccountSurface() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-8 bg-background">
      <div
        className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 text-center"
        data-testid="recruit-no-player-account"
      >
        <h1 className="text-xl font-display font-bold text-fg-high mb-2">
          Sign in with a player account
        </h1>
        <p className="text-fg-mid text-sm mb-5">
          Your current sign-in isn&apos;t linked to a player. Sign in with LINE,
          Google, or your email to submit an application.
        </p>
        <Link
          href="/auth/signin"
          className="inline-block bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </main>
  )
}
