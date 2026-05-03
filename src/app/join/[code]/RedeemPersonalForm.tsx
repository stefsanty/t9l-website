'use client'

import { useTransition, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { redeemInvite } from './actions'

/**
 * v1.34.0 (PR ζ) — client-side YES/NO buttons for the PERSONAL preview.
 *
 * v1.40.0 — signed-out branch removed. The parent (`page.tsx`) now renders
 * `JoinInlineAuth` directly for signed-out PERSONAL previews so the user
 * picks a provider on the invite page (no bounce to `/auth/signin`). After
 * the OAuth round-trip the page re-renders into the signed-in branch and
 * mounts this component, which fires `redeemInvite` on click.
 *
 * "No, not me": for now just routes home; future PR θ-adjacent could
 * record a rejection audit trail (see brainstorm brief Q4.2).
 */

interface Props {
  code: string
  inviteCode: string
  skipOnboarding: boolean
}

export default function RedeemPersonalForm({ code, skipOnboarding }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleYes() {
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
          : skipOnboarding
            ? 'Yes, that’s me — link my account'
            : 'Yes, that’s me — continue'}
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
