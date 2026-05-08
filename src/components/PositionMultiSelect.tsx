'use client'

/**
 * v1.82.0 — Chip multi-select for position picking.
 *
 * Renders one toggle button per code in the league's vocabulary
 * (per `ballType`). Tap to toggle in/out of `selected`. Selected codes
 * keep their canonical order from the vocabulary list (NOT click
 * order) so the rendered chip-row is stable across re-renders.
 *
 * Shared by:
 *   - RegistrationFields (recruit + onboarding)
 *   - ApplyToLeagueModal (State D — existing player, new league)
 *   - AccountPlayerForm ("My player details")
 *   - AddPlayerDialog / EditPlayerPanel (admin Players tab)
 *
 * Theming: takes a `variant` prop so admin (admin-* tokens) and public
 * (border-default / surface-md tokens) variants can share one
 * implementation without smuggling Tailwind class strings via props.
 */

import { useMemo } from 'react'
import {
  type BallType,
  getPositionVocabulary,
} from '@/lib/positions'

export interface PositionMultiSelectProps {
  /** Currently-selected codes. Caller owns state. */
  selected: ReadonlyArray<string>
  /**
   * Called with the next selection (canonical-vocab order, never click
   * order). Caller decides whether to dedupe / persist.
   */
  onChange: (next: string[]) => void
  ballType: BallType | null | undefined
  /** Test-id prefix — pinned `${prefix}-toggle-${code}` per chip. */
  testIdPrefix?: string
  /** When true, all chips render disabled (form is submitting). */
  disabled?: boolean
  /** Visual variant. `public` = border-default tokens; `admin` = admin-* tokens. */
  variant?: 'public' | 'admin'
}

export default function PositionMultiSelect({
  selected,
  onChange,
  ballType,
  testIdPrefix,
  disabled,
  variant = 'public',
}: PositionMultiSelectProps) {
  const vocab = useMemo(() => getPositionVocabulary(ballType), [ballType])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  function toggle(code: string) {
    const next = selectedSet.has(code)
      ? selected.filter((c) => c !== code)
      : // Insert in canonical vocab order so the chip row stays stable.
        vocab.map((p) => p.code).filter((c) => selectedSet.has(c) || c === code)
    onChange(next)
  }

  const baseClass = 'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  const variantClasses =
    variant === 'admin'
      ? {
          on:
            'bg-admin-green text-admin-ink border-admin-green hover:opacity-90',
          off:
            'bg-admin-surface2 text-admin-text2 border-admin-border hover:border-admin-border2 hover:text-admin-text',
        }
      : {
          on:
            'bg-primary text-on-primary border-primary hover:opacity-90',
          off:
            'bg-background text-fg-mid border-border-default hover:border-fg-mid hover:text-fg-high',
        }

  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid={testIdPrefix}
      role="group"
      aria-label="Position"
    >
      {vocab.map((p) => {
        const isOn = selectedSet.has(p.code)
        return (
          <button
            type="button"
            key={p.code}
            onClick={() => toggle(p.code)}
            disabled={disabled}
            aria-pressed={isOn}
            title={p.label}
            className={`${baseClass} ${isOn ? variantClasses.on : variantClasses.off}`}
            data-testid={testIdPrefix ? `${testIdPrefix}-toggle-${p.code}` : undefined}
          >
            {p.code}
          </button>
        )
      })}
    </div>
  )
}
