'use client'

import { useEffect, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { adminCreatePlayer, adminGenerateInvite } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'
import InviteDisplay from './InviteDisplay'

interface LeagueTeamRef {
  id: string
  team: { name: string }
}

interface AddPlayerDialogProps {
  leagueId: string
  leagueTeams: LeagueTeamRef[]
}

const POSITION_OPTIONS: ReadonlyArray<{ value: '' | 'GK' | 'DF' | 'MF' | 'FW'; label: string }> = [
  { value: '',   label: 'No position' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

/**
 * v1.33.0 (PR ε of the onboarding chain) — admin "Add Player" affordance.
 *
 * All three profile fields (name / team / position) are OPTIONAL because
 * the next PR (ζ) ships the public `/join/[code]` flow that lets the
 * eventual user fill in their own name + position. Pre-staging an empty
 * slot now lets the admin generate a personal invite (also via this
 * dialog, post-create) and hand that to a recruit before knowing
 * anything about them.
 *
 * Two modes:
 *   - **Create only** — admin clicks "Create player", dialog closes,
 *     player appears in the table.
 *   - **Create + invite** — admin checks "Generate invite immediately
 *     after creating", dialog stays open showing the new invite's
 *     copy / QR / share URL via `InviteDisplay`.
 *
 * The skipOnboarding checkbox flows into the invite when generated;
 * the eventual /join/[code] route (PR ζ) reads it. Default off — the
 * onboarding form is the safe path.
 */
export default function AddPlayerDialog({ leagueId, leagueTeams }: AddPlayerDialogProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Form state
  const [name, setName] = useState('')
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>('')
  const [leagueTeamId, setLeagueTeamId] = useState('')
  const [generateInviteAfter, setGenerateInviteAfter] = useState(false)
  const [skipOnboarding, setSkipOnboarding] = useState(false)

  // Result state — populated after a successful create+invite
  const [generatedInvite, setGeneratedInvite] = useState<{
    code: string
    joinUrl: string
    expiresAt: string | null
    skipOnboarding: boolean
    playerName: string
  } | null>(null)

  function reset() {
    setName('')
    setPosition('')
    setLeagueTeamId('')
    setGenerateInviteAfter(false)
    setSkipOnboarding(false)
    setGeneratedInvite(null)
  }

  function handleClose() {
    setOpen(false)
    // small delay before reset so the close animation doesn't flicker
    setTimeout(reset, 200)
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      try {
        const trimmedName = name.trim()
        const created = await adminCreatePlayer({
          leagueId,
          name: trimmedName === '' ? null : trimmedName,
          position: position === '' ? null : position,
          leagueTeamId: leagueTeamId === '' ? null : leagueTeamId,
        })
        if (generateInviteAfter) {
          const invite = await adminGenerateInvite({
            leagueId,
            targetPlayerId: created.id,
            skipOnboarding,
          })
          setGeneratedInvite({
            code: invite.code,
            joinUrl: invite.joinUrl,
            expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
            skipOnboarding: invite.skipOnboarding,
            playerName: trimmedName === '' ? 'Unnamed player' : trimmedName,
          })
          toast(`Player created and invite generated`, 'success')
        } else {
          toast(
            trimmedName ? `${trimmedName} added to league` : 'Pre-staged player slot created',
            'success',
          )
          handleClose()
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to create player', 'error')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add a new player to this league (pre-stage a roster slot, optionally generate an invite)"
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-admin-green px-2.5 py-1 text-xs font-semibold text-admin-ink hover:opacity-90"
        data-testid="add-player-button"
      >
        <Plus className="w-3 h-3" />
        Add Player
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="add-player-dialog">
          <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
          <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-admin-text font-condensed font-bold text-lg">
                {generatedInvite ? 'Invite generated' : 'Add player'}
              </h3>
              <button onClick={handleClose} className="text-admin-text3 hover:text-admin-text" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {generatedInvite ? (
              <>
                <p className="text-admin-text2 text-sm mb-4">
                  {generatedInvite.playerName} added.{' '}
                  Share the invite below — it expires in 7 days.
                </p>
                <InviteDisplay
                  code={generatedInvite.code}
                  joinUrl={generatedInvite.joinUrl}
                  expiresAt={generatedInvite.expiresAt}
                  skipOnboarding={generatedInvite.skipOnboarding}
                />
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg text-sm bg-admin-green text-admin-ink font-medium hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <p className="text-admin-text2 text-sm mb-4">
                  All fields are optional. Pre-stage a slot now and the user fills their
                  details via the join code; or fill what you know and the user
                  confirms.
                </p>

                <div className="space-y-3 mb-5">
                  <label className="block">
                    <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                      Name
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      placeholder="e.g. Ian Noseda (optional)"
                      className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
                      data-testid="add-player-name"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                      Team
                    </span>
                    <select
                      value={leagueTeamId}
                      onChange={(e) => setLeagueTeamId(e.target.value)}
                      className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
                      data-testid="add-player-team"
                    >
                      <option value="">No team (pre-stage)</option>
                      {leagueTeams.map((lt) => (
                        <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                      Position
                    </span>
                    <select
                      value={position}
                      onChange={(e) => setPosition(e.target.value as typeof position)}
                      className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
                      data-testid="add-player-position"
                    >
                      {POSITION_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="space-y-2 mb-5 bg-admin-surface2 border border-admin-border rounded-md p-3">
                  <label className="flex items-start gap-2 text-sm text-admin-text2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={generateInviteAfter}
                      onChange={(e) => setGenerateInviteAfter(e.target.checked)}
                      className="mt-0.5"
                      data-testid="add-player-generate-invite"
                    />
                    <span>
                      <span className="font-medium text-admin-text">Generate invite immediately</span>
                      <span className="block text-xs text-admin-text3 mt-0.5">
                        Creates a 7-day personal invite link you can copy or share via QR.
                      </span>
                    </span>
                  </label>

                  {generateInviteAfter && (
                    <label className="flex items-start gap-2 text-sm text-admin-text2 cursor-pointer pl-6">
                      <input
                        type="checkbox"
                        checked={skipOnboarding}
                        onChange={(e) => setSkipOnboarding(e.target.checked)}
                        className="mt-0.5"
                        data-testid="add-player-skip-onboarding"
                      />
                      <span>
                        <span className="font-medium text-admin-text">Skip onboarding form</span>
                        <span className="block text-xs text-admin-text3 mt-0.5">
                          Recipient lands signed-in without filling the name / position form.
                          Only use when you already have their data.
                        </span>
                      </span>
                    </label>
                  )}
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg text-sm text-admin-text2 border border-admin-border hover:border-admin-border2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-admin-green text-admin-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="add-player-submit"
                  >
                    {pending ? 'Creating…' : generateInviteAfter ? 'Create + invite' : 'Create player'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
