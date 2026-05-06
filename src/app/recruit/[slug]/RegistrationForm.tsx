'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { applyToLeague } from '@/app/api/recruiting/actions'

/**
 * v1.67.2 — User-initiated registration form.
 *
 * Mirrors the field shape of `/join/[code]/onboarding/OnboardingForm.tsx`
 * (name + position) so the UX is consistent across both registration
 * paths. Submits to `applyToLeague` which atomically creates Player +
 * PlayerLeagueMembership(PENDING) — the load-bearing fix vs v1.67.0's
 * synthetic-invite path that pre-created an empty Player and a
 * pre-redeemed invite.
 *
 * On success: router.push('/id/<slug>') where the apex
 * RecruitingBanner shows State B ("Application submitted") for the
 * fresh PLM.
 *
 * Position field uses the same enum + "Prefer not to say" copy as
 * OnboardingForm — keep these in sync if you change one.
 */

const POSITIONS: ReadonlyArray<{ value: '' | 'GK' | 'DF' | 'MF' | 'FW'; label: string }> = [
  { value: '',   label: 'Prefer not to say' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

interface Props {
  leagueId: string
  leagueSlug: string
  leagueName: string
}

export default function RegistrationForm({ leagueId, leagueSlug, leagueName }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Your name is required')
      return
    }
    if (trimmed.length > 100) {
      setError('Name must be 100 characters or fewer')
      return
    }
    startTransition(async () => {
      const result = await applyToLeague({
        leagueId,
        name: trimmed,
        position: position === '' ? null : position,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      // PLM(PENDING) is now in place. Land on the league page where
      // the RecruitingBanner shows State B "Application submitted".
      router.push(`/id/${leagueSlug}`)
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5"
      data-testid="recruit-registration-form"
    >
      <label className="block">
        <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Name <span className="text-vibrant-pink">*</span>
        </span>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="e.g. Stefan S"
          className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
          data-testid="recruit-name"
        />
      </label>

      <label className="block">
        <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Position
        </span>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as typeof position)}
          className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
          data-testid="recruit-position"
        >
          {POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        data-testid="recruit-submit"
      >
        {pending ? 'Submitting…' : `Apply to ${leagueName}`}
      </button>

      {error && (
        <p className="text-sm text-vibrant-pink" role="alert" data-testid="recruit-error">
          {error}
        </p>
      )}
    </form>
  )
}
