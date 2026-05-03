'use client'

import { useEffect, useState, useCallback } from 'react'
import { signIn, getProviders } from 'next-auth/react'

/**
 * v1.40.0 — Inline auth picker for the public `/join/[code]` redemption
 * page (signed-out branches: PERSONAL preview + CODE preview).
 *
 * Pre-v1.40.0 the signed-out flow was: invite preview → "Yes, that's me"
 * (PERSONAL) or "Sign in to continue" (CODE) → `/auth/signin?callbackUrl=/join/<code>`
 * → user picks LINE / Google / email → bounces back to `/join/<code>`. Two
 * round-trips of branding context loss before the user can claim the slot.
 *
 * v1.40.0 collapses the YES step: picking a provider IS the confirmation.
 * The three buttons render inline below the invite preview ("Hi NAME, you've
 * been invited to LEAGUE — pick how you'd like to sign in"). Each button
 * fires `signIn(provider, { callbackUrl: '/join/<code>' })` directly. After
 * NextAuth's OAuth round-trip the user lands back on `/join/<code>` already
 * authenticated; the page re-renders into the signed-in branch which kicks
 * off `redeemInvite` (PERSONAL) or shows the roster picker (CODE).
 *
 * Visual language mirrors `SignInLightbox.tsx` (v1.32.1) — same buttons,
 * same provider-gate-via-getProviders, same email magic-link transition —
 * but inline (no modal, no portal, no focus trap, no body-scroll lock).
 *
 * Already-signed-in users never see this component (the page's signed-in
 * branches render `RedeemPersonalForm` or `RedeemCodePicker` instead).
 */

interface Props {
  /**
   * Bare invite code (no hyphens). Used to build the callbackUrl that
   * NextAuth returns to after the OAuth round-trip.
   */
  code: string
}

interface ProvidersState {
  loading: boolean
  google: boolean
  email: boolean
}

function LineIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596a.603.603 0 0 1-.199.031c-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595a.657.657 0 0 1 .194-.033c.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  )
}

function GoogleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function MailIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

export default function JoinInlineAuth({ code }: Props) {
  const callbackUrl = `/join/${code}`
  const [providers, setProviders] = useState<ProvidersState>({
    loading: true,
    google: false,
    email: false,
  })
  const [step, setStep] = useState<'pick' | 'email-form' | 'email-sent'>('pick')
  const [email, setEmail] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)

  // Detect which providers are wired (env vars set on the server).
  // Mirrors SignInLightbox's resolution path so non-LINE buttons hide
  // gracefully when GOOGLE_CLIENT_ID / EMAIL_SERVER aren't set.
  useEffect(() => {
    let cancelled = false
    getProviders()
      .then((p) => {
        if (cancelled) return
        setProviders({
          loading: false,
          google: !!p?.google,
          email: !!p?.email,
        })
      })
      .catch(() => {
        if (!cancelled) setProviders({ loading: false, google: false, email: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleEmailSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!email || emailSubmitting) return
      setEmailSubmitting(true)
      try {
        // Inline transition to a "check your email" surface — same shape
        // as SignInLightbox so the email path doesn't bounce off-page.
        await signIn('email', { email, callbackUrl, redirect: false })
        setStep('email-sent')
      } finally {
        setEmailSubmitting(false)
      }
    },
    [email, emailSubmitting, callbackUrl],
  )

  if (step === 'email-sent') {
    return (
      <div data-testid="join-inline-auth-email-sent" className="space-y-3">
        <p className="text-sm text-fg-high">
          A sign-in link is on its way to <span className="font-bold">{email}</span>.
        </p>
        <p className="text-[12px] text-fg-mid leading-relaxed">
          Click the link in the email to finish signing in and redeem your invite. The link
          works once and expires after 10 minutes.
        </p>
        <button
          type="button"
          onClick={() => setStep('pick')}
          className="text-[11px] text-fg-mid hover:text-fg-high transition-colors"
        >
          ← Back to providers
        </button>
      </div>
    )
  }

  if (step === 'email-form') {
    return (
      <form
        onSubmit={handleEmailSubmit}
        className="flex flex-col gap-3"
        data-testid="join-inline-auth-email-form"
      >
        <label
          htmlFor="join-email"
          className="text-[10px] font-black uppercase tracking-[0.15em] text-fg-mid"
        >
          Email address
        </label>
        <input
          id="join-email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={emailSubmitting}
          className="w-full rounded-2xl bg-surface border border-border-default px-4 py-3 text-sm text-fg-high placeholder:text-fg-mid focus:outline-none focus:ring-2 focus:ring-electric-green"
          data-testid="join-inline-auth-email-input"
        />
        <button
          type="submit"
          disabled={!email || emailSubmitting}
          className="w-full rounded-2xl bg-electric-green hover:opacity-90 active:scale-[0.98] px-5 py-3 text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          data-testid="join-inline-auth-email-submit"
        >
          {emailSubmitting ? 'Sending…' : 'Send sign-in link'}
        </button>
        <button
          type="button"
          onClick={() => setStep('pick')}
          className="text-[11px] text-fg-mid hover:text-fg-high transition-colors"
        >
          ← Back to providers
        </button>
        <p className="text-[11px] text-fg-mid leading-snug">
          We&apos;ll email you a one-shot link. No password.
        </p>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid="join-inline-auth">
      <button
        type="button"
        onClick={() => signIn('line', { callbackUrl })}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#06C755] hover:bg-[#05b34c] active:scale-[0.98] px-5 py-3 text-white font-bold text-sm transition-all shadow-[0_4px_12px_rgba(6,199,85,0.2)]"
        data-testid="join-inline-auth-line"
      >
        <LineIcon className="w-4 h-4" />
        Continue with LINE
      </button>

      {providers.google && (
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl })}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-white hover:bg-gray-100 active:scale-[0.98] px-5 py-3 text-gray-900 font-bold text-sm transition-all border border-gray-200"
          data-testid="join-inline-auth-google"
        >
          <GoogleIcon className="w-4 h-4" />
          Continue with Google
        </button>
      )}

      {providers.email && (
        <button
          type="button"
          onClick={() => setStep('email-form')}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-surface hover:bg-surface-md active:scale-[0.98] px-5 py-3 text-fg-high font-bold text-sm transition-all border border-border-default"
          data-testid="join-inline-auth-email"
        >
          <MailIcon className="w-4 h-4" />
          Continue with email
        </button>
      )}

      {!providers.loading && !providers.google && !providers.email && (
        <p className="text-[11px] text-fg-mid text-center mt-1">
          Other sign-in methods will be available soon.
        </p>
      )}
    </div>
  )
}
