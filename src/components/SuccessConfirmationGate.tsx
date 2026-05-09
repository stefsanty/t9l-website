'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import SuccessConfirmationModal from './SuccessConfirmationModal'

/**
 * v1.81.0 — Reads `?submitted=<descriptor>` off the URL and renders the
 * matching success popup. Mounted on Dashboard so any league page
 * (`/`, `/id/<slug>`, `/id/<slug>/md/<id>`) participates without
 * touching the server-component signatures.
 *
 * Server actions in the recruiting + onboarding paths redirect to
 * `<originPath>?submitted=<descriptor>` on success; this gate matches
 * the descriptor against `MESSAGES` and renders the configured copy.
 * Unknown descriptors render nothing — defensive against stale URLs
 * users might paste from history.
 *
 * The OK button (and ESC + backdrop) navigate to `pathname` with the
 * `submitted` query param stripped, so the popup doesn't redisplay on
 * refresh and the URL stays clean. `replace` semantics so the popped
 * "?submitted=" entry doesn't pollute browser history.
 */

interface MessageConfig {
  title: string
  description?: string
}

const MESSAGES: Record<string, MessageConfig> = {
  // v1.81.0 — recruiting paths land here. The State D and State C copy
  // is identical: the league admin reviews the application offline.
  applyToLeague: {
    title: 'Application submitted',
    description: 'The league admin will review your application and get back to you.',
  },
  registerToLeague: {
    title: 'Application submitted',
    description: 'The league admin will review your application and get back to you.',
  },
  // v1.81.2 — invite-redemption + onboarding paths. All four redirect to
  // /join/[code]/welcome, where this gate is mounted alongside the
  // existing welcome card.
  redeemInvite: {
    title: 'Invite redeemed',
    description: "You're now a member of the league.",
  },
  completeOnboardingWithId: {
    title: 'Application submitted',
    description: 'The league admin will review your application and get back to you.',
  },
  submitIdUpload: {
    title: 'ID uploaded',
    description: 'Your application is now complete.',
  },
  skipIdUpload: {
    title: 'Application complete',
    description: 'Admin will collect your ID separately.',
  },
}

export default function SuccessConfirmationGate() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const submitted = searchParams?.get('submitted') ?? null
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(!!submitted && !!MESSAGES[submitted])
  }, [submitted])

  const okHref = useMemo(() => {
    if (!searchParams || !pathname) return pathname || '/'
    const next = new URLSearchParams(searchParams.toString())
    next.delete('submitted')
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  if (!submitted) return null
  const config = MESSAGES[submitted]
  if (!config) return null

  return (
    <SuccessConfirmationModal
      open={open}
      title={config.title}
      description={config.description}
      okHref={okHref}
      onClose={() => setOpen(false)}
    />
  )
}
