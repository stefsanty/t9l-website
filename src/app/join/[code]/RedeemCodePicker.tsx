'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { redeemInvite } from './actions'

/**
 * v1.34.0 (PR ζ) — client-side picker for the CODE-flavor invite.
 *
 * Lists unlinked Players in this league, grouped by team. User picks
 * one and confirms; server action redirects to onboarding or welcome.
 *
 * The picker hides players already bound to a User (those have
 * `userId !== null`) — surfaced server-side, not via client filter,
 * so the data crossing the boundary is already-filtered (avoids the
 * v1.4.x "false-success on already-claimed" footgun by construction).
 */

interface PlayerOption {
  id: string
  name: string | null
  position: string | null
  pictureUrl: string | null
  teamId: string
  teamName: string
}

interface LeagueTeamRef {
  id: string
  name: string
}

interface Props {
  code: string
  players: PlayerOption[]
  leagueTeams: LeagueTeamRef[]
  skipOnboarding: boolean
}

export default function RedeemCodePicker({ code, players, leagueTeams, skipOnboarding }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const playersByTeam = useMemo(() => {
    const grouped = new Map<string, PlayerOption[]>()
    for (const p of players) {
      if (!grouped.has(p.teamId)) grouped.set(p.teamId, [])
      grouped.get(p.teamId)!.push(p)
    }
    return grouped
  }, [players])

  function handleConfirm() {
    if (!pickedId) return
    setError(null)
    startTransition(async () => {
      const result = await redeemInvite({ code, pickedPlayerId: pickedId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(result.redirectTo)
    })
  }

  return (
    <div className="space-y-4" data-testid="redeem-code-picker">
      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {leagueTeams.map((lt) => {
          const teamPlayers = playersByTeam.get(lt.id) ?? []
          if (teamPlayers.length === 0) return null
          return (
            <div key={lt.id}>
              <h3 className="text-fg-mid text-xs uppercase tracking-wider font-bold mb-1.5">
                {lt.name}
              </h3>
              <div className="space-y-1">
                {teamPlayers.map((p) => {
                  const checked = pickedId === p.id
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                        checked
                          ? 'border-primary bg-primary/10'
                          : 'border-border-default hover:border-border-strong bg-background'
                      }`}
                      data-testid={`pick-player-${p.id}`}
                    >
                      <input
                        type="radio"
                        name="pickedPlayer"
                        value={p.id}
                        checked={checked}
                        onChange={() => setPickedId(p.id)}
                        className="sr-only"
                      />
                      {p.pictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.pictureUrl}
                          alt={p.name ?? ''}
                          className="w-10 h-10 rounded-full object-cover bg-surface border border-border-subtle shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-surface border border-border-subtle flex items-center justify-center text-fg-mid font-bold text-sm shrink-0">
                          {p.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-fg-high text-sm truncate">
                          {p.name ?? <span className="italic text-fg-mid">Unnamed</span>}
                        </p>
                        {p.position && (
                          <p className="text-fg-low text-xs uppercase tracking-wider">{p.position}</p>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!pickedId || pending}
        className="w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        data-testid="redeem-code-submit"
      >
        {pending
          ? 'Linking…'
          : pickedId
            ? skipOnboarding
              ? 'Claim this slot'
              : 'Claim this slot — continue'
            : 'Pick a player above'}
      </button>
      {error && (
        <p className="text-sm text-vibrant-pink" role="alert" data-testid="redeem-error">
          {error}
        </p>
      )}
    </div>
  )
}
