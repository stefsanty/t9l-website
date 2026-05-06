'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { useToast } from './ToastProvider'
import { updateLeaguePlannedRoster } from '@/app/admin/leagues/actions'
import { formatJstDate } from '@/lib/jst'

/**
 * v1.67.0 — Admin League Settings: "Planned roster" section.
 *
 * Edits `League.plannedPlayersPerTeam`, `plannedNumberOfTeams`, and
 * `registrationDeadline`. Surfaced server-side by the new
 * `PlannedRosterStats` panel between the recruiting banner and the
 * compressed schedule on the public homepage when the league is in
 * preseason mode.
 *
 * Conventions:
 *   - Both numerics are integers ≥ 0. 0 = "not set" — the public stats
 *     panel hides those rows.
 *   - registrationDeadline accepts a JST calendar date via
 *     `<input type="date">` and is stored as UTC midnight by the
 *     server action via `parseJstDateOnly`. Empty string = clear.
 *   - All three fields save together via one server action call.
 */

interface Props {
  leagueId: string
  initialPlannedPlayersPerTeam: number
  initialPlannedNumberOfTeams: number
  initialRegistrationDeadline: Date | null
}

function fmtDateInput(d: Date | null): string {
  if (!d) return ''
  return formatJstDate(d)
}

export default function LeaguePlannedRosterEditor({
  leagueId,
  initialPlannedPlayersPerTeam,
  initialPlannedNumberOfTeams,
  initialRegistrationDeadline,
}: Props) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const [plannedPlayersPerTeam, setPlannedPlayersPerTeam] = useState<number>(
    initialPlannedPlayersPerTeam,
  )
  const [plannedNumberOfTeams, setPlannedNumberOfTeams] = useState<number>(
    initialPlannedNumberOfTeams,
  )
  const [registrationDeadline, setRegistrationDeadline] = useState<string>(
    fmtDateInput(initialRegistrationDeadline),
  )

  function handleSave() {
    startTransition(async () => {
      try {
        await updateLeaguePlannedRoster({
          leagueId,
          plannedPlayersPerTeam: Math.max(0, Math.floor(plannedPlayersPerTeam || 0)),
          plannedNumberOfTeams: Math.max(0, Math.floor(plannedNumberOfTeams || 0)),
          registrationDeadline: registrationDeadline.trim() === '' ? null : registrationDeadline,
        })
        toast('Planned roster saved', 'success')
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to save', 'error')
      }
    })
  }

  return (
    <section
      className="bg-admin-surface border border-admin-border rounded-md p-4 space-y-4"
      data-testid="league-planned-roster-editor"
    >
      <div>
        <h3 className="text-sm font-bold text-fg-high mb-1">Planned roster</h3>
        <p className="text-xs text-fg-mid leading-relaxed">
          Targets surfaced in the preseason stats panel above the planned
          schedule. Set to 0 to hide a row from the public panel.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest font-bold text-fg-mid mb-1.5">
            Planned teams
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={plannedNumberOfTeams}
            onChange={(e) => setPlannedNumberOfTeams(parseInt(e.target.value, 10) || 0)}
            className="w-full bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono"
            data-testid="planned-number-of-teams-input"
          />
        </label>

        <label className="block">
          <span className="block text-xs uppercase tracking-widest font-bold text-fg-mid mb-1.5">
            Planned players / team
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={plannedPlayersPerTeam}
            onChange={(e) => setPlannedPlayersPerTeam(parseInt(e.target.value, 10) || 0)}
            className="w-full bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono"
            data-testid="planned-players-per-team-input"
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-xs uppercase tracking-widest font-bold text-fg-mid mb-1.5">
          Registration deadline
        </span>
        <input
          type="date"
          value={registrationDeadline}
          onChange={(e) => setRegistrationDeadline(e.target.value)}
          className="bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono"
          data-testid="registration-deadline-input"
        />
        <p className="text-[11px] text-fg-low mt-1">
          JST calendar date. Leave empty to hide the deadline row from the public panel.
        </p>
      </label>

      <div className="flex justify-end pt-2 border-t border-admin-border">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary text-on-primary px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest disabled:opacity-50 hover:opacity-90 transition-opacity inline-flex items-center gap-2"
          data-testid="planned-roster-save"
        >
          {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save planned roster
        </button>
      </div>
    </section>
  )
}
