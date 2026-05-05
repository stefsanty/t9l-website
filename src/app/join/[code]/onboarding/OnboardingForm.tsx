'use client'

import { useState, useTransition } from 'react'
import { submitOnboarding } from '../actions'

/**
 * v1.34.0 (PR ζ) — client-side onboarding form for the redeemed-but-not-
 * yet-onboarded state.
 *
 * v1.62.0 — preferred-team / preferred-teammate fields removed. Only
 * captures name + position now. The underlying
 * `Player.onboardingPreferences` JSON column stays in the schema for
 * compatibility but is no longer read or written.
 *
 * Submit → `submitOnboarding` server action → redirect to /id-upload.
 *
 * The form is idempotent: revisiting after a prior submit re-renders
 * with prefilled values (PR θ's "Reset onboarding" flow flips
 * onboardingStatus back to NOT_YET, which routes the user here again
 * to re-confirm).
 */

const POSITIONS: ReadonlyArray<{ value: '' | 'GK' | 'DF' | 'MF' | 'FW'; label: string }> = [
  { value: '',   label: 'Prefer not to say' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

interface Props {
  code: string
  playerId: string
  initialName: string
  initialPosition: 'GK' | 'DF' | 'MF' | 'FW' | null
}

export default function OnboardingForm({
  code,
  playerId,
  initialName,
  initialPosition,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>(initialPosition ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await submitOnboarding({
          code,
          playerId,
          name: name.trim(),
          position: position === '' ? null : position,
        })
        // submitOnboarding redirects on success — this code is unreachable
        // unless a future variant returns instead of throwing/redirecting.
      } catch (err) {
        // Next.js redirect throws a special error; only surface real ones.
        if (err && typeof err === 'object' && 'digest' in err) {
          // Next redirect — re-throw so the framework handles navigation.
          throw err
        }
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="onboarding-form">
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
          data-testid="onboarding-name"
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
          data-testid="onboarding-position"
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
        data-testid="onboarding-submit"
      >
        {pending ? 'Saving…' : 'Save and continue'}
      </button>
      {error && (
        <p className="text-sm text-vibrant-pink" role="alert" data-testid="onboarding-error">
          {error}
        </p>
      )}
    </form>
  )
}
