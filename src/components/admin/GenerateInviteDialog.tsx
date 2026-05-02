'use client'

import { useEffect, useState, useTransition } from 'react'
import { X, Download, AlertCircle } from 'lucide-react'
import { adminGenerateInvite, adminGenerateInvitesBulk } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'
import InviteDisplay from './InviteDisplay'
import { formatInviteCodeForDisplay } from '@/lib/inviteCodes'

interface SingleProps {
  mode: 'single'
  leagueId: string
  target: { id: string; name: string | null }
  onClose: () => void
}

interface BulkProps {
  mode: 'bulk'
  leagueId: string
  targets: Array<{ id: string; name: string | null }>
  onClose: () => void
}

type Props = SingleProps | BulkProps

interface SingleResult {
  code: string
  joinUrl: string
  expiresAt: string | null
  skipOnboarding: boolean
}

interface BulkResultRow {
  playerId: string
  playerName: string | null
  ok: boolean
  code: string | null
  joinUrl: string | null
  error: string | null
}

/**
 * v1.33.0 (PR ε) — invite generation dialog. Two modes share the same
 * skipOnboarding form + result display so the admin doesn't switch
 * mental models when going from "issue one" to "issue ten".
 *
 * Single mode: per-row "Invite" button on PlayersTab → opens the dialog
 * locked to that target → shows the generated invite via InviteDisplay.
 *
 * Bulk mode: PlayersTab toolbar exposes "Generate invites (N)" once
 * the admin checks ≥1 player checkbox → opens the dialog with the
 * target list locked → success surface lists every generated invite
 * with a one-click CSV download. Per-row failures are surfaced inline
 * with the error reason so the admin sees partial success rather than
 * a single all-or-nothing toast.
 */
export default function GenerateInviteDialog(props: Props) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const [skipOnboarding, setSkipOnboarding] = useState(false)
  const [singleResult, setSingleResult] = useState<SingleResult | null>(null)
  const [bulkResult, setBulkResult] = useState<{ results: BulkResultRow[]; csv: string } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit() {
    startTransition(async () => {
      try {
        if (props.mode === 'single') {
          const invite = await adminGenerateInvite({
            leagueId: props.leagueId,
            targetPlayerId: props.target.id,
            skipOnboarding,
          })
          setSingleResult({
            code: invite.code,
            joinUrl: invite.joinUrl,
            expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
            skipOnboarding: invite.skipOnboarding,
          })
          toast(`Invite generated for ${props.target.name ?? 'Unnamed player'}`, 'success')
        } else {
          const result = await adminGenerateInvitesBulk({
            leagueId: props.leagueId,
            targetPlayerIds: props.targets.map((t) => t.id),
            skipOnboarding,
          })
          setBulkResult({
            results: result.results.map((r) => ({
              playerId: r.playerId,
              playerName: r.playerName,
              ok: r.ok,
              code: r.code,
              joinUrl: r.joinUrl,
              error: r.error,
            })),
            csv: result.csv,
          })
          const successCount = result.results.filter((r) => r.ok).length
          const failCount = result.results.length - successCount
          toast(
            failCount === 0
              ? `Generated ${successCount} invites`
              : `Generated ${successCount} invites (${failCount} failed)`,
            failCount === 0 ? 'success' : 'error',
          )
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Generation failed', 'error')
      }
    })
  }

  function downloadCsv() {
    if (!bulkResult) return
    const blob = new Blob([bulkResult.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date().toISOString().slice(0, 10)
    a.download = `invites-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const title =
    props.mode === 'single'
      ? singleResult
        ? `Invite for ${props.target.name ?? 'Unnamed player'}`
        : `Generate invite for ${props.target.name ?? 'Unnamed player'}`
      : bulkResult
        ? `${bulkResult.results.filter((r) => r.ok).length} invites generated`
        : `Generate ${props.targets.length} invites`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="generate-invite-dialog">
      <div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-admin-text font-condensed font-bold text-lg">{title}</h3>
          <button onClick={props.onClose} className="text-admin-text3 hover:text-admin-text" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Result surface (single) */}
        {props.mode === 'single' && singleResult && (
          <>
            <p className="text-admin-text2 text-sm mb-4">
              Share with {props.target.name ?? 'this player'} — they sign in with any
              provider and the invite binds them to this slot.
            </p>
            <InviteDisplay
              code={singleResult.code}
              joinUrl={singleResult.joinUrl}
              expiresAt={singleResult.expiresAt}
              skipOnboarding={singleResult.skipOnboarding}
            />
            <div className="mt-5 flex justify-end">
              <button
                onClick={props.onClose}
                className="px-4 py-2 rounded-lg text-sm bg-admin-green text-admin-ink font-medium hover:opacity-90"
              >
                Done
              </button>
            </div>
          </>
        )}

        {/* Result surface (bulk) */}
        {props.mode === 'bulk' && bulkResult && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-admin-text2 text-sm">
                {bulkResult.results.filter((r) => r.ok).length} of {bulkResult.results.length} invites
                generated. Download the CSV to share or mail-merge.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadCsv}
              className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-admin-border bg-admin-surface2 px-3 py-2 text-sm text-admin-text hover:border-admin-border2"
              data-testid="bulk-csv-download"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </button>

            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {bulkResult.results.map((r) => (
                <div
                  key={r.playerId}
                  className="flex items-start gap-2 text-xs bg-admin-surface2 border border-admin-border rounded px-2 py-1.5"
                  data-testid={`bulk-row-${r.playerId}`}
                >
                  <span className="flex-1 truncate text-admin-text">
                    {r.playerName ?? 'Unnamed player'}
                  </span>
                  {r.ok && r.code ? (
                    <code className="font-mono text-admin-text2">{formatInviteCodeForDisplay(r.code)}</code>
                  ) : (
                    <span className="flex items-center gap-1 text-admin-red" data-testid={`bulk-error-${r.playerId}`}>
                      <AlertCircle className="w-3 h-3" />
                      <span>{r.error ?? 'Failed'}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={props.onClose}
                className="px-4 py-2 rounded-lg text-sm bg-admin-green text-admin-ink font-medium hover:opacity-90"
              >
                Done
              </button>
            </div>
          </>
        )}

        {/* Form (pre-submit, both modes) */}
        {!singleResult && !bulkResult && (
          <>
            <p className="text-admin-text2 text-sm mb-4">
              {props.mode === 'single'
                ? 'Generate a 7-day personal invite. The recipient signs in with any provider and is bound to this player slot.'
                : `Generate ${props.targets.length} personal invites — each pre-bound to its target player slot. Outputs a CSV with code + join URL per row.`}
            </p>

            {props.mode === 'bulk' && (
              <div className="mb-4 max-h-32 overflow-y-auto bg-admin-surface2 border border-admin-border rounded-md p-2 text-xs space-y-0.5">
                {props.targets.map((t) => (
                  <div key={t.id} className="text-admin-text2">
                    {t.name ?? <span className="italic text-admin-text3">Unnamed</span>}
                  </div>
                ))}
              </div>
            )}

            <label className="mb-5 flex items-start gap-2 text-sm text-admin-text2 cursor-pointer bg-admin-surface2 border border-admin-border rounded-md p-3">
              <input
                type="checkbox"
                checked={skipOnboarding}
                onChange={(e) => setSkipOnboarding(e.target.checked)}
                className="mt-0.5"
                data-testid="invite-skip-onboarding"
              />
              <span>
                <span className="font-medium text-admin-text">Skip onboarding form</span>
                <span className="block text-xs text-admin-text3 mt-0.5">
                  Recipient is bound to the player slot immediately on sign-in, without
                  filling the name / position form. Only check when you already have
                  their data.
                </span>
              </span>
            </label>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={props.onClose}
                className="px-4 py-2 rounded-lg text-sm text-admin-text2 border border-admin-border hover:border-admin-border2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={pending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-admin-green text-admin-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="generate-invite-submit"
              >
                {pending
                  ? 'Generating…'
                  : props.mode === 'single'
                    ? 'Generate invite'
                    : `Generate ${props.targets.length} invites`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
