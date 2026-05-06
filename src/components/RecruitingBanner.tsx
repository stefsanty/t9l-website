'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import ApplyToLeagueModal from './ApplyToLeagueModal'
import type { RecruitingViewerState } from '@/lib/recruitingViewerState'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

/**
 * v1.64.0 / v1.65.1 — Context-aware recruiting banner.
 *
 * Renders one of five surfaces based on the viewer's relationship to
 * the recruiting league:
 *
 * State A ('approved_this'):  status banner — "you are in <league>!
 *                              your team [logo] <name>" — no click action.
 * State B ('pending_this'):   "your application is being reviewed" —
 *                              no click action.
 * State C ('no_player'):      "RECRUITING NOW" CTA — click opens
 *                              `<ApplyToLeagueModal mode="fresh">` with
 *                              the full intake form (name + position).
 * State D ('in_other_league'):"RECRUITING NOW" CTA — click opens
 *                              `<ApplyToLeagueModal mode="existing">`
 *                              with the simplified form (position
 *                              only — the existing Player's name
 *                              carries through). v1.65.1 closes the
 *                              State D bug where this previously
 *                              just toasted "contact admin".
 * State E ('unauthenticated'):"RECRUITING NOW" CTA — click toasts
 *                              "Sign in to apply" with a sign-in
 *                              action button (v1.65.1 — previously
 *                              hard-redirected to /auth/signin).
 *
 * The viewer state is computed server-side via
 * `getRecruitingViewerState(leagueId)` and threaded through Dashboard
 * as a prop — no extra round-trip on first render.
 */

interface Props {
  league: { id: string; name: string }
  viewer: RecruitingViewerState
  /**
   * v1.67.2 — league slug threaded so the State C CTA can navigate
   * to `/recruit/<slug>`. Optional with a default (`DEFAULT_LEAGUE_SLUG`)
   * for callers that haven't been updated; the default points at the
   * apex league so the homepage continues to work without page-level
   * changes.
   */
  leagueSlug?: string
}

export default function RecruitingBanner({
  league,
  viewer,
  leagueSlug = DEFAULT_LEAGUE_SLUG,
}: Props) {
  const [applyOpen, setApplyOpen] = useState(false)
  const router = useRouter()

  // ── State A — approved member of this league ─────────────────────────
  if (viewer.kind === 'approved_this') {
    return (
      <div
        data-testid="recruiting-banner-approved"
        className="w-full mt-2 mb-3 rounded-2xl border border-success/40 bg-success/10 px-4 py-3 relative overflow-hidden"
      >
        <div className="flex items-center gap-3">
          {viewer.team.logoUrl ? (
            <div className="w-10 h-10 rounded-full overflow-hidden bg-background border border-border-default shrink-0">
              <Image
                src={viewer.team.logoUrl}
                alt={viewer.team.name}
                width={40}
                height={40}
                className="object-cover"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-success/15 border border-success/40 flex items-center justify-center text-success font-black text-sm shrink-0">
              {viewer.team.name[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-success">
              You are in {league.name}!
            </p>
            <p className="font-display text-base font-black uppercase tracking-tight text-fg-high leading-tight truncate">
              Your team — {viewer.team.name}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── State B — pending application for this league ────────────────────
  if (viewer.kind === 'pending_this') {
    return (
      <div
        data-testid="recruiting-banner-pending"
        className="w-full mt-2 mb-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 relative overflow-hidden"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-warning/15 border border-warning/40 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-warning">
              Application submitted
            </p>
            <p className="font-display text-base font-black uppercase tracking-tight text-fg-high leading-tight">
              Being reviewed by league admins
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── States C / D / E — recruiting CTA ─────────────────────────────────
  function handleClick() {
    switch (viewer.kind) {
      case 'unauthenticated':
        // State E (v1.65.1) — toast nudge with a sign-in action button.
        // v1.64.0 hard-redirected to /auth/signin; the v1.65.1 brief
        // says "stay on page", so we toast with an action that the
        // user explicitly opts into.
        toast.message('Sign in to apply', {
          description: `Sign in first, then submit your application to ${league.name}.`,
          action: {
            label: 'Sign in',
            onClick: () => signIn(undefined, { callbackUrl: window.location.href }),
          },
        })
        return
      case 'no_player':
        // v1.67.2 — State C navigates to the new `/recruit/<slug>` route
        // which renders an empty registration form. On submit, the
        // existing `applyToLeague` action creates Player + PLM(PENDING)
        // atomically with the user-supplied data — no synthetic invite,
        // no orphan rows.
        //
        // Replaces the v1.67.0 `recruitToLeagueWithOnboarding` flow that
        // pre-created an empty Player + a `usedCount=maxUses=1` invite,
        // which `validateInvite` rejected as 'used-up' BEFORE the
        // existingBinding-detection branch could route to /onboarding.
        router.push(`/recruit/${leagueSlug}`)
        return
      case 'in_other_league':
        // State D (v1.65.1) — open application modal in 'existing'
        // mode (simplified — just position). The action creates a
        // new PLM(PENDING) for the existing Player in this league.
        setApplyOpen(true)
        return
    }
  }

  const ctaTestid =
    viewer.kind === 'unauthenticated'
      ? 'recruiting-banner-cta-unauth'
      : viewer.kind === 'no_player'
        ? 'recruiting-banner-cta-noplayer'
        : 'recruiting-banner-cta-otherleague'

  return (
    <>
      <button
        type="button"
        data-testid={ctaTestid}
        onClick={handleClick}
        className="w-full mt-2 mb-3 rounded-2xl border border-vibrant-pink/60 bg-gradient-to-r from-vibrant-pink to-orange-500 px-4 py-3 text-left relative overflow-hidden hover:opacity-95 transition-opacity active:scale-[0.99]"
      >
        <div className="absolute inset-0 bg-diagonal-pattern opacity-10 pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-2xl font-black uppercase tracking-tight text-white leading-none">
              Recruiting Now
            </p>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/90 mt-1">
              Looking for new players — tap to apply
            </p>
          </div>
          <span aria-hidden className="text-2xl text-white/90 shrink-0">
            →
          </span>
        </div>
      </button>

      {/* v1.67.2 — State D ('in_other_league') uses the inline modal for
          simplified intake (existing Player just needs a position for the
          new league). State C ('no_player') now navigates to /recruit/<slug>
          where the user fills the form before any DB writes happen. */}
      {viewer.kind === 'in_other_league' && (
        <ApplyToLeagueModal
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          leagueId={league.id}
          leagueName={league.name}
          mode="existing"
        />
      )}
    </>
  )
}
