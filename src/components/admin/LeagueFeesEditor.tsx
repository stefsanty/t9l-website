'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { useToast } from './ToastProvider'
import { updateLeagueFeeSettings } from '@/app/admin/leagues/actions'
import { formatJpyFee } from '@/lib/playerFee'

/**
 * v1.66.0 — Admin League Settings: "Player Fees" section.
 *
 * Per outputs/v1.66.0-player-payment-status-spec.md. Edits the league's
 * `defaultFee` + per-position fee rows. Save replaces the positionFees
 * set atomically (delete-and-recreate inside a transaction); the
 * resolver in `lib/playerFee.ts` looks up `LeaguePositionFee.position`
 * by case-sensitive exact match against `PlayerLeagueMembership.position`.
 *
 * Conventions:
 *   - Position is free-text (admin types 'GK' / 'FP' / 'DF' / etc.).
 *     'GK' / 'DF' / 'MF' / 'FW' match the PlayerPosition enum literals.
 *   - 'FP' is a logical "field player" label that matches no enum value
 *     and so falls through to `defaultFee` for those positions — admins
 *     can use this to set GK at one rate and everyone else at default.
 *   - Fees are JPY integers (no decimals). 0 means "no fee" — the
 *     banner stays hidden for memberships resolving to 0.
 */

interface FeeRow {
  position: string
  fee: number
}

interface Props {
  leagueId: string
  initialDefaultFee: number
  initialPositionFees: ReadonlyArray<FeeRow>
}

export default function LeagueFeesEditor({
  leagueId,
  initialDefaultFee,
  initialPositionFees,
}: Props) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const [defaultFee, setDefaultFee] = useState<number>(initialDefaultFee)
  const [rows, setRows] = useState<FeeRow[]>([...initialPositionFees])

  function addRow() {
    setRows([...rows, { position: '', fee: 0 }])
  }
  function removeRow(idx: number) {
    setRows(rows.filter((_, i) => i !== idx))
  }
  function updateRow(idx: number, patch: Partial<FeeRow>) {
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateLeagueFeeSettings({
          leagueId,
          defaultFee,
          positionFees: rows
            .map((r) => ({ position: r.position.trim(), fee: Math.max(0, Math.floor(r.fee || 0)) }))
            .filter((r) => r.position),
        })
        toast('Fee settings saved', 'success')
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to save', 'error')
      }
    })
  }

  return (
    <section
      className="bg-admin-surface border border-admin-border rounded-md p-4 space-y-4"
      data-testid="league-fees-editor"
    >
      <div>
        <h3 className="text-sm font-bold text-admin-text mb-1">Player fees</h3>
        <p className="text-xs text-admin-text2 leading-relaxed">
          Default fee applies to every player whose position has no
          override below. Per-position rows match
          <code className="mx-1 px-1 bg-admin-surface2 rounded text-[11px] font-mono text-admin-text">PlayerLeagueMembership.position</code>
          via case-sensitive exact match (e.g. <code>GK</code> = 5,000 + default = 4,000).
        </p>
      </div>

      <label className="block">
        <span className="block text-xs uppercase tracking-widest font-bold text-admin-text2 mb-1.5">
          Default fee (JPY)
        </span>
        <input
          type="number"
          min={0}
          step={100}
          value={defaultFee}
          onChange={(e) => setDefaultFee(parseInt(e.target.value, 10) || 0)}
          className="w-32 bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
          data-testid="default-fee-input"
        />
        <p className="text-[11px] text-admin-text3 mt-1">
          {formatJpyFee(defaultFee)} per matchday (or season — your call)
        </p>
      </label>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest font-bold text-admin-text2">Per-position overrides</p>
        {rows.length === 0 && (
          <p className="text-xs text-admin-text3 italic">No per-position overrides — every player pays the default fee.</p>
        )}
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2"
            data-testid={`fee-row-${idx}`}
          >
            <input
              type="text"
              value={row.position}
              onChange={(e) => updateRow(idx, { position: e.target.value })}
              placeholder="GK"
              maxLength={32}
              className="w-20 bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono uppercase text-admin-text placeholder:text-admin-text3"
              data-testid={`fee-position-${idx}`}
            />
            <input
              type="number"
              min={0}
              step={100}
              value={row.fee}
              onChange={(e) => updateRow(idx, { fee: parseInt(e.target.value, 10) || 0 })}
              className="w-32 bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
              data-testid={`fee-amount-${idx}`}
            />
            <span className="text-[11px] text-admin-text3">{formatJpyFee(row.fee)}</span>
            <button
              type="button"
              onClick={() => removeRow(idx)}
              aria-label="Remove fee row"
              className="ml-auto w-7 h-7 flex items-center justify-center rounded text-admin-text3 hover:text-admin-text hover:bg-admin-surface2 transition-colors"
              data-testid={`fee-remove-${idx}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-admin-text2 hover:text-admin-text px-2 py-1 rounded border border-dashed border-admin-border hover:border-admin-border2 transition-colors"
          data-testid="fee-add-row"
        >
          <Plus className="w-3.5 h-3.5" />
          Add position fee
        </button>
      </div>

      <div className="flex justify-end pt-2 border-t border-admin-border">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary text-on-primary px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest disabled:opacity-50 hover:opacity-90 transition-opacity inline-flex items-center gap-2"
          data-testid="fee-save"
        >
          {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save fees
        </button>
      </div>
    </section>
  )
}
