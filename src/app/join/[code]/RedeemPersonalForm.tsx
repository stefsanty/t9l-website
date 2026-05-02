'use client'

import { useTransition, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { redeemInvite } from './actions'

/**
 * v1.34.0 (PR ζ) — client-side YES/NO buttons for the PERSONAL preview.
 *
 * Signed-out: "Yes, that's me" routes to `/auth/signin?callbackUrl=/join/<code>`.
 * After sign-in, the page re-renders and the user lands here signed-in.
 *
 * Signed-in: "Yes, that's me" calls `redeemInvite` and the server action
 * redirects to either `/join/<code>/welcome` (skipOnboarding) or
 * `/join/<code>/onboarding`. We follow with `router.push` for the
 * non-redirecting return path (Next 16 server actions can return values
 * OR redirect; we use the value form so the client can show inline
 * errors before navigating).
 *
 * "No, not me": for now just routes home; future PR θ-adjacent could
 * record a rejection audit trail (see brainstorm brief Q4.2).
 */

interface Props {
  code: string
  isSignedIn: boolean
  inviteCode: string
  skipOnboarding: boolean
}

export default function RedeemPersonalForm({ code, isSignedIn, skipOnboarding }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleYes() {
    if (!isSignedIn) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(`/join/${code}`)}`)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await redeemInvite({ code })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(result.redirectTo)
    })
  }

  return (
    <div className="space-y-3" data-testid="redeem-personal-form">
      <button
        type="button"
        onClick={handleYes}
        disabled={pending}
        className="w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        data-testid="redeem-yes"
      >
        {pending
          ? 'Linking…'
          : isSignedIn
            ? skipOnboarding
              ? 'Yes, that’s me — link my account'
              : 'Yes, that’s me — continue'
            : 'Yes, that’s me — sign in to confirm'}
      </button>
      <Link
        href="/"
        className="block w-full text-center rounded-lg border border-border-default text-fg-mid px-4 py-2.5 text-sm hover:border-border-strong transition-colors"
        data-testid="redeem-no"
      >
        No, not me
      </Link>
      {error && (
        <p className="text-sm text-vibrant-pink" role="alert" data-testid="redeem-error">
          {error}
        </p>
      )}
    </div>
  )
}
