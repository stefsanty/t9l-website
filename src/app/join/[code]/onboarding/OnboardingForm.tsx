'use client'

import { useState, useTransition } from 'react'
import { submitOnboarding } from '../actions'

/**
 * v1.34.0 (PR ζ) — client-side onboarding form for the redeemed-but-not-
 * yet-onboarded state. Captures:
 *
 *   - Name (required, ≤100 chars; prefilled if admin pre-staged a name).
 *   - Position (optional: GK / DF / MF / FW).
 *   - Preferred team (optional, only if the bound assignment doesn't
 *     already pin one — admin pre-stages with a team usually do, leaving
 *     this dropdown unused).
 *   - Preferred teammates (multi-select of existing players in the
 *     league; "Other" free-text for names not on the roster yet).
 *
 * Submit → `submitOnboarding` server action → redirect to welcome.
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
  initialPreferredLeagueTeamId: string | null
  initialPreferredTeammateIds: string[]
  initialPreferredTeammatesFreeText: string | null
  leagueTeams: Array<{ id: string; name: string }>
  teammateOptions: Array<{ id: string; name: string }>
}

export default function OnboardingForm({
  code,
  playerId,
  initialName,
  initialPosition,
  initialPreferredLeagueTeamId,
  initialPreferredTeammateIds,
  initialPreferredTeammatesFreeText,
  leagueTeams,
  teammateOptions,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>(initialPosition ?? '')
  const [preferredLeagueTeamId, setPreferredLeagueTeamId] = useState(
    initialPreferredLeagueTeamId ?? '',
  )
  const [preferredTeammateIds, setPreferredTeammateIds] = useState<string[]>(
    initialPreferredTeammateIds,
  )
  const [preferredTeammatesFreeText, setPreferredTeammatesFreeText] = useState(
    initialPreferredTeammatesFreeText ?? '',
  )
  const [error, setError] = useState<string | null>(null)

  function toggleTeammate(id: string) {
    setPreferredTeammateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

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
          preferredLeagueTeamId: preferredLeagueTeamId === '' ? null : preferredLeagueTeamId,
          preferredTeammateIds,
          preferredTeammatesFreeText:
            preferredTeammatesFreeText.trim() === '' ? null : preferredTeammatesFreeText.trim(),
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

      <label className="block">
        <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Preferred team (optional)
        </span>
        <select
          value={preferredLeagueTeamId}
          onChange={(e) => setPreferredLeagueTeamId(e.target.value)}
          className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
          data-testid="onboarding-preferred-team"
        >
          <option value="">No preference</option>
          {leagueTeams.map((lt) => (
            <option key={lt.id} value={lt.id}>{lt.name}</option>
          ))}
        </select>
        <p className="text-fg-low text-xs mt-1">
          The admin will see this when assigning teams. Doesn't change your current team.
        </p>
      </label>

      <fieldset className="space-y-2">
        <legend className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Players I'd like to play with (optional)
        </legend>
        <div className="space-y-1 max-h-48 overflow-y-auto pr-1 border border-border-default rounded-lg p-2 bg-background">
          {teammateOptions.length === 0 ? (
            <p className="text-fg-low text-xs italic">No other players to choose from yet.</p>
          ) : (
            teammateOptions.map((opt) => {
              const checked = preferredTeammateIds.includes(opt.id)
              return (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 text-sm text-fg-mid cursor-pointer"
                  data-testid={`onboarding-teammate-${opt.id}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTeammate(opt.id)}
                  />
                  <span>{opt.name}</span>
                </label>
              )
            })
          )}
        </div>
        <input
          type="text"
          value={preferredTeammatesFreeText}
          onChange={(e) => setPreferredTeammatesFreeText(e.target.value)}
          maxLength={500}
          placeholder="Other (someone not on the list)"
          className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
          data-testid="onboarding-teammates-other"
        />
      </fieldset>

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
