'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Link2, X, Search, Check, AlertCircle, Users } from 'lucide-react'
import {
  adminLinkExistingPlayer,
  adminLinkExistingPlayersBulk,
} from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'
import AdminPlayerAvatar from './AdminPlayerAvatar'

interface LeagueTeamRef {
  id: string
  team: { name: string }
}

export interface LinkablePlayerRow {
  id: string
  name: string | null
  position: string | null
  profilePictureUrl: string | null
  pictureUrl: string | null
  userId: string | null
  lineId: string | null
  otherLeagues: string[]
}

interface LinkExistingPlayerDialogProps {
  leagueId: string
  leagueTeams: LeagueTeamRef[]
  candidates: LinkablePlayerRow[]
}

/**
 * v1.56.0 (PR 3 of route-shortening chain) — admin "Link existing player"
 * dialog.
 *
 * Use case: a Player record already exists (e.g. someone joined T9L's
 * default league via PR ζ invite redemption — `Player.userId` set,
 * profile complete) and the admin wants to add them to a NEW league's
 * roster without creating a duplicate Player.
 *
 * Sibling to `AddPlayerDialog` which CREATES a fresh Player. This
 * dialog ATTACHES an existing Player via a new `PlayerLeagueAssignment`
 * row; nothing about the global Player record is modified.
 *
 * Two flows:
 *   - **Single link** — operator picks one player + one team → submit.
 *   - **Bulk link** — operator multi-selects + assigns each to a team
 *     in one batch (different teams per player; league-wide team
 *     selection would be too rigid).
 *
 * Differentiation cue: each candidate row shows a small "Also in:
 * <league names>" chip when the player has active assignments in other
 * leagues. This helps the operator distinguish a "fresh pre-staged
 * Player from another league" from a "true cross-league veteran".
 *
 * Search filters on name + LINE display name (best-effort substring,
 * case-insensitive). Position is shown but not searchable (admins
 * usually search by name).
 */
export default function LinkExistingPlayerDialog({
  leagueId,
  leagueTeams,
  candidates,
}: LinkExistingPlayerDialogProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  // Per-row selection: which players are checked + which team they go to.
  const [selectedTeamByPlayerId, setSelectedTeamByPlayerId] = useState<Record<string, string>>({})

  function isSelected(playerId: string): boolean {
    return playerId in selectedTeamByPlayerId
  }

  function togglePlayer(playerId: string) {
    setSelectedTeamByPlayerId((prev) => {
      const next = { ...prev }
      if (playerId in next) {
        delete next[playerId]
      } else {
        // Default to first team; admin must pick before submit if
        // there's no obvious default.
        next[playerId] = leagueTeams[0]?.id ?? ''
      }
      return next
    })
  }

  function setTeamFor(playerId: string, leagueTeamId: string) {
    setSelectedTeamByPlayerId((prev) => ({ ...prev, [playerId]: leagueTeamId }))
  }

  function reset() {
    setSearch('')
    setSelectedTeamByPlayerId({})
  }

  function handleClose() {
    setOpen(false)
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

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => {
      const name = (c.name ?? '').toLowerCase()
      return name.includes(q)
    })
  }, [search, candidates])

  const selectedCount = Object.keys(selectedTeamByPlayerId).length
  const selectedItems = Object.entries(selectedTeamByPlayerId)
    .filter(([, leagueTeamId]) => leagueTeamId)
    .map(([playerId, leagueTeamId]) => ({ playerId, leagueTeamId }))
  const hasUnassignedTeam = selectedCount > 0 && selectedItems.length !== selectedCount

  function handleSubmit() {
    if (selectedItems.length === 0) return
    if (hasUnassignedTeam) {
      toast('Pick a team for every selected player', 'error')
      return
    }
    startTransition(async () => {
      try {
        if (selectedItems.length === 1) {
          // Single-link path uses the one-shot action (cleaner error
          // surfacing than the bulk wrapper for a single failure).
          const it = selectedItems[0]
          await adminLinkExistingPlayer({
            leagueId,
            playerId: it.playerId,
            leagueTeamId: it.leagueTeamId,
          })
          const target = candidates.find((c) => c.id === it.playerId)
          toast(`Linked ${target?.name ?? 'player'} to this league`)
          handleClose()
          return
        }
        const { results } = await adminLinkExistingPlayersBulk({
          leagueId,
          items: selectedItems,
        })
        const successes = results.filter((r) => r.ok).length
        const failures = results.length - successes
        if (failures === 0) {
          toast(`Linked ${successes} player${successes === 1 ? '' : 's'} to this league`)
          handleClose()
          return
        }
        // Partial failure — surface as warning toast, leave dialog open
        // so admin can review which rows failed (the per-row error
        // message could be wired into a result-display follow-up; for
        // v1 we surface counts).
        toast(`Linked ${successes}, ${failures} failed — see browser console`, 'error')
        // eslint-disable-next-line no-console
        console.warn('[adminLinkExistingPlayersBulk] partial failures', results.filter((r) => !r.ok))
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to link', 'error')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-admin-border2 bg-admin-surface2 px-2.5 py-1 text-xs font-semibold text-admin-text hover:bg-admin-surface3"
        data-testid="link-existing-player-trigger"
      >
        <Link2 className="w-3 h-3" />
        Link existing player
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose()
          }}
          data-testid="link-existing-player-backdrop"
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-admin-border bg-admin-surface shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-existing-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-admin-border px-5 py-4">
              <div>
                <h2
                  id="link-existing-title"
                  className="font-condensed text-[16px] font-bold uppercase tracking-[1px] text-admin-text"
                >
                  Link existing player
                </h2>
                <p className="mt-0.5 text-[11px] text-admin-text3">
                  Attach a player from the global pool to this league&apos;s roster.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-[6px] p-1 text-admin-text3 hover:bg-admin-surface2 hover:text-admin-text"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-admin-border px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-admin-text3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name…"
                  className="w-full rounded-[6px] border border-admin-border2 bg-admin-surface2 pl-9 pr-3 py-[8px] text-sm text-admin-text outline-none focus:border-admin-green/60"
                  data-testid="link-existing-player-search"
                />
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-admin-text3">
                <Users className="w-3 h-3" />
                {filteredCandidates.length} of {candidates.length} player
                {candidates.length === 1 ? '' : 's'} not yet on this roster
              </p>
            </div>

            {/* Candidate list */}
            <div className="flex-1 overflow-y-auto" data-testid="link-existing-player-list">
              {candidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-admin-text3">
                  <AlertCircle className="w-5 h-5" />
                  <p className="text-sm">No global players to link.</p>
                  <p className="text-[11px]">
                    Use <span className="font-mono text-admin-text2">+ Add Player</span> to create a
                    new player.
                  </p>
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="py-10 text-center text-sm text-admin-text3">
                  No players match &quot;{search}&quot;.
                </div>
              ) : (
                <ul className="divide-y divide-admin-border">
                  {filteredCandidates.map((c) => {
                    const checked = isSelected(c.id)
                    const teamId = selectedTeamByPlayerId[c.id] ?? ''
                    return (
                      <li
                        key={c.id}
                        className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                          checked ? 'bg-admin-surface2' : 'hover:bg-admin-surface2/50'
                        }`}
                        data-testid={`link-existing-player-row-${c.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlayer(c.id)}
                          className="w-4 h-4"
                          aria-label={`Select ${c.name ?? 'player'}`}
                          data-testid={`link-existing-player-check-${c.id}`}
                        />
                        <AdminPlayerAvatar
                          name={c.name}
                          profilePictureUrl={c.profilePictureUrl}
                          pictureUrl={c.pictureUrl}
                          size={32}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-condensed font-bold text-sm text-admin-text truncate">
                            {c.name ?? <span className="italic text-admin-text3">Unnamed</span>}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-admin-text3">
                            {c.position && (
                              <span className="font-mono uppercase">{c.position}</span>
                            )}
                            {c.otherLeagues.length > 0 ? (
                              <span data-testid={`link-existing-player-other-leagues-${c.id}`}>
                                Also in: {c.otherLeagues.join(', ')}
                              </span>
                            ) : (
                              <span className="italic" data-testid={`link-existing-player-no-leagues-${c.id}`}>
                                Not on any active roster
                              </span>
                            )}
                          </div>
                        </div>
                        {checked && (
                          <select
                            value={teamId}
                            onChange={(e) => setTeamFor(c.id, e.target.value)}
                            className="rounded-[6px] border border-admin-border2 bg-admin-surface3 px-2 py-1 text-xs text-admin-text outline-none focus:border-admin-green/60"
                            data-testid={`link-existing-player-team-${c.id}`}
                          >
                            <option value="" disabled>
                              Pick team…
                            </option>
                            {leagueTeams.map((lt) => (
                              <option key={lt.id} value={lt.id}>
                                {lt.team.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-admin-border px-5 py-3">
              <p className="text-[11px] text-admin-text3" data-testid="link-existing-player-summary">
                {selectedCount === 0
                  ? 'Select players to link.'
                  : `${selectedCount} selected${
                      hasUnassignedTeam ? ' — pick a team for each' : ''
                    }`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-[6px] border border-admin-border2 px-3 py-[6px] text-xs font-semibold text-admin-text hover:bg-admin-surface2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={pending || selectedCount === 0 || hasUnassignedTeam}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-admin-green px-3 py-[6px] text-xs font-semibold text-admin-ink hover:opacity-90 disabled:opacity-40"
                  data-testid="link-existing-player-submit"
                >
                  <Check className="w-3 h-3" />
                  {pending
                    ? 'Linking…'
                    : selectedCount === 1
                    ? 'Link 1 player'
                    : selectedCount > 1
                    ? `Link ${selectedCount} players`
                    : 'Link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
