'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import PositionMultiSelect from './PositionMultiSelect'
import { setMatchdayGuests, type GuestRowInput } from '@/app/api/guests/actions'
import type { BallType } from '@/lib/positions'
import type { MatchdayGuestEntry } from '@/types'

/**
 * v1.93.0 — Guests-for-team modal. Replaces the v1.91.0 two-input
 * count modal with a sectioned table: League Guests on top, External
 * Guests below. Each section is a list of rows; each row carries a
 * `PositionMultiSelect` for that guest's positions, plus a delete
 * (trash) button. "+ Add row" buttons append rows per section. Submit
 * sends the full set to `setMatchdayGuests` which replaces the
 * server-side rows in one transaction.
 *
 * Numbering ("League Guest 1 / 2 / 3", "Ext Guest 1 / 2") is purely
 * presentational here — computed from `index + 1` within each section.
 * The server re-derives `displayOrder` on every submit so deleted rows
 * don't leave gaps in the persisted state.
 *
 * Modal contract mirrors `ApplyToLeagueModal` / `SignInLightbox`:
 * portal, ESC dismiss, backdrop dismiss, body-scroll-lock, role=dialog.
 */

interface Props {
  open: boolean
  onClose: () => void
  leagueSlug: string
  matchdayPublicId: string
  teamPublicId: string
  teamName: string
  matchdayLabel: string
  ballType: BallType | null | undefined
  initialGuests: MatchdayGuestEntry[]
}

interface RowState {
  /** Local key for React; not sent to the server. */
  key: string
  type: 'EXTERNAL' | 'LEAGUE'
  positions: string[]
}

const MAX_GUESTS_PER_TEAM = 50
let rowKeySeed = 0
function nextRowKey(): string {
  rowKeySeed += 1
  return `row-${rowKeySeed}`
}

function rowsFromInitial(initial: MatchdayGuestEntry[]): RowState[] {
  // Order: LEAGUE first (matches modal UI order), then EXTERNAL.
  const league: RowState[] = []
  const external: RowState[] = []
  for (const g of initial) {
    const r: RowState = { key: nextRowKey(), type: g.type, positions: [...g.positions] }
    if (g.type === 'LEAGUE') league.push(r)
    else external.push(r)
  }
  // Caller passes `initialGuests` already sorted by (type asc, displayOrder
  // asc) from `dbToPublicLeagueData`, so re-bucketing by type preserves
  // per-section displayOrder. No further sort needed.
  return [...league, ...external]
}

function rowsToSubmit(rows: RowState[]): GuestRowInput[] {
  return rows.map((r) => ({ type: r.type, positions: r.positions }))
}

export default function AddGuestsModal({
  open,
  onClose,
  leagueSlug,
  matchdayPublicId,
  teamPublicId,
  teamName,
  matchdayLabel,
  ballType,
  initialGuests,
}: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<RowState[]>(() => rowsFromInitial(initialGuests))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Re-sync on re-open — fresh data each click.
  useEffect(() => {
    if (!open) return
    setRows(rowsFromInitial(initialGuests))
    setError(null)
  }, [open, initialGuests])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const leagueRows = rows.filter((r) => r.type === 'LEAGUE')
  const externalRows = rows.filter((r) => r.type === 'EXTERNAL')
  const totalRows = rows.length

  function addRow(type: 'EXTERNAL' | 'LEAGUE') {
    if (totalRows >= MAX_GUESTS_PER_TEAM) {
      setError(`At most ${MAX_GUESTS_PER_TEAM} guests per team`)
      return
    }
    setError(null)
    setRows((prev) => [...prev, { key: nextRowKey(), type, positions: [] }])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function updateRowPositions(key: string, positions: string[]) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, positions } : r)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        // Submit order: LEAGUE rows first, then EXTERNAL — matches modal
        // top-to-bottom ordering. Server re-derives displayOrder per type
        // section (0..N-1 each).
        const ordered = [
          ...rows.filter((r) => r.type === 'LEAGUE'),
          ...rows.filter((r) => r.type === 'EXTERNAL'),
        ]
        await setMatchdayGuests({
          leagueSlug,
          matchdayPublicId,
          teamPublicId,
          guests: rowsToSubmit(ordered),
        })
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submit failed')
      }
    })
  }

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center px-4 py-8 sm:py-12 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Guests for ${teamName}`}
      data-testid="add-guests-modal"
    >
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        data-testid="add-guests-modal-backdrop"
      />
      <div className="relative w-full max-w-lg mx-auto bg-card border border-border-default rounded-3xl shadow-2xl">
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
                {matchdayLabel} · Guests
              </p>
              <h2
                className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight"
                translate="no"
              >
                {`Guests for ${teamName}`}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-fg-mid hover:text-fg-high hover:bg-surface transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm text-fg-mid mb-5 leading-relaxed">
            Add one row per guest joining the team. Set each guest&apos;s positions so they slot into the formation.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5" data-testid="add-guests-form">
            <GuestSection
              title="League Guests"
              hint="T9L players from another team filling in for this match."
              type="LEAGUE"
              rows={leagueRows}
              ballType={ballType}
              pending={pending}
              onAdd={() => addRow('LEAGUE')}
              onRemove={removeRow}
              onChangePositions={updateRowPositions}
            />

            <GuestSection
              title="External Guests"
              hint="Friends, colleagues — anyone not on T9L."
              type="EXTERNAL"
              rows={externalRows}
              ballType={ballType}
              pending={pending}
              onAdd={() => addRow('EXTERNAL')}
              onRemove={removeRow}
              onChangePositions={updateRowPositions}
            />

            <div className="flex items-center justify-between text-xs text-fg-mid bg-surface rounded-lg px-3 py-2">
              <span className="uppercase tracking-widest font-bold">Total guests</span>
              <span
                className="font-black text-fg-high text-base"
                data-testid="add-guests-total"
              >
                {totalRows}
              </span>
            </div>

            {error && (
              <p
                className="text-sm text-vibrant-pink"
                role="alert"
                data-testid="add-guests-error"
              >
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="flex-1 rounded-lg border border-border-default px-4 py-2.5 text-sm font-bold text-fg-mid hover:text-fg-high transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                data-testid="add-guests-submit"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function GuestSection({
  title,
  hint,
  type,
  rows,
  ballType,
  pending,
  onAdd,
  onRemove,
  onChangePositions,
}: {
  title: string
  hint: string
  type: 'EXTERNAL' | 'LEAGUE'
  rows: RowState[]
  ballType: BallType | null | undefined
  pending: boolean
  onAdd: () => void
  onRemove: (key: string) => void
  onChangePositions: (key: string, positions: string[]) => void
}) {
  const labelPrefix = type === 'EXTERNAL' ? 'Ext Guest' : 'League Guest'
  const emptyMessage =
    type === 'EXTERNAL' ? 'No external guests yet.' : 'No league guests yet.'
  const sectionTestId = `add-guests-section-${type.toLowerCase()}`

  return (
    <div
      data-testid={sectionTestId}
      className="rounded-lg border border-border-subtle bg-surface/50 px-3 py-3"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-fg-high text-xs uppercase tracking-widest font-black">
          {title}
        </h3>
        <span
          className="text-[10px] uppercase tracking-widest text-fg-low font-bold"
          data-testid={`${sectionTestId}-count`}
        >
          {rows.length}
        </span>
      </div>
      <p className="text-fg-low text-[11px] mb-3">{hint}</p>

      {rows.length === 0 ? (
        <p
          className="text-[12px] text-fg-mid italic py-2"
          data-testid={`${sectionTestId}-empty`}
        >
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-3" data-testid={`${sectionTestId}-rows`}>
          {rows.map((row, idx) => (
            <li
              key={row.key}
              className="rounded-md bg-background border border-border-subtle px-3 py-2.5"
              data-testid={`${sectionTestId}-row-${idx}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span
                  className="text-[12px] font-bold text-fg-high"
                  data-testid={`${sectionTestId}-row-label-${idx}`}
                >
                  {`${labelPrefix} ${idx + 1}`}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(row.key)}
                  disabled={pending}
                  aria-label={`Remove ${labelPrefix} ${idx + 1}`}
                  className="text-fg-mid hover:text-vibrant-pink disabled:opacity-50 transition-colors p-1"
                  data-testid={`${sectionTestId}-row-remove-${idx}`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                    />
                  </svg>
                </button>
              </div>
              <PositionMultiSelect
                selected={row.positions}
                onChange={(next) => onChangePositions(row.key, next)}
                ballType={ballType}
                testIdPrefix={`${sectionTestId}-positions-${idx}`}
                disabled={pending}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onAdd}
        disabled={pending}
        className="mt-3 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-fg-mid hover:text-fg-high px-2 py-1 rounded border border-border-default disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        data-testid={`${sectionTestId}-add`}
      >
        <span aria-hidden="true">+</span>
        <span>Add row</span>
      </button>
    </div>
  )
}
