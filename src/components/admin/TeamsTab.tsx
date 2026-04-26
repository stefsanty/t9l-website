'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Users, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import ConfirmDialog from './ConfirmDialog'
import { useToast } from './ToastProvider'
import { enrollTeam, removeTeamFromLeague } from '@/app/admin/leagues/actions'

// ── Types ────────────────────────────────────────────────────────────────────

interface PlayerAssignment {
  id: string
  player: { id: string; name: string }
}

interface MatchRef {
  id: string
  homeScore: number
  awayScore: number
  status: string
  homeTeamId: string
  awayTeamId: string
}

interface LeagueTeamFull {
  id: string
  team: { id: string; name: string; logoUrl: string | null }
  playerAssignments: PlayerAssignment[]
  homeMatches: MatchRef[]
  awayMatches: MatchRef[]
}

interface TeamRef {
  id: string
  name: string
}

interface TeamsTabProps {
  leagueId: string
  leagueTeams: LeagueTeamFull[]
  allTeams: TeamRef[]
}

// ── Record computation ───────────────────────────────────────────────────────

function computeRecord(lt: LeagueTeamFull) {
  const matches = [
    ...lt.homeMatches.filter((m) => m.status === 'COMPLETED'),
    ...lt.awayMatches.filter((m) => m.status === 'COMPLETED'),
  ]
  let W = 0, D = 0, L = 0, GF = 0, GA = 0
  for (const m of matches) {
    const isHome = m.homeTeamId === lt.id
    const gf = isHome ? m.homeScore : m.awayScore
    const ga = isHome ? m.awayScore : m.homeScore
    GF += gf; GA += ga
    if (gf > ga) W++
    else if (gf === ga) D++
    else L++
  }
  return { P: matches.length, W, D, L, GF, GA, GD: GF - GA, Pts: W * 3 + D }
}

// ── Team detail panel (shared between mobile accordion and desktop) ──────────

function TeamDetail({
  lt,
  onRemove,
}: {
  lt: LeagueTeamFull
  onRemove: () => void
}) {
  const record = computeRecord(lt)

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="font-condensed font-bold text-admin-text text-2xl">{lt.team.name}</h3>
          <p className="text-admin-text3 text-sm mt-0.5">
            {lt.playerAssignments.length} player{lt.playerAssignments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <ConfirmDialog
          trigger={
            <button className="flex items-center gap-1.5 text-admin-text3 text-xs hover:text-admin-red transition-colors border border-admin-border rounded px-3 py-1.5 hover:border-admin-red/30 min-h-[36px]">
              <X className="w-3 h-3" />
              Remove
            </button>
          }
          title={`Remove ${lt.team.name}?`}
          description="This will unenroll the team from this league. Players will lose their assignments."
          confirmLabel={`Remove ${lt.team.name}`}
          onConfirm={async () => onRemove()}
        />
      </div>

      {record.P > 0 && (
        <div className="mb-6">
          <p className="text-admin-text3 text-xs uppercase tracking-wider mb-3">League Record</p>
          <div className="grid grid-cols-8 gap-0 border border-admin-border rounded-lg overflow-hidden">
            {(['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'] as const).map((col) => (
              <div key={col} className="border-r border-admin-border last:border-r-0">
                <div className="text-admin-text3 text-xs text-center py-1.5 bg-admin-surface2 border-b border-admin-border">
                  {col}
                </div>
                <div className={cn(
                  'text-center py-2 font-mono text-sm font-medium',
                  col === 'Pts' ? 'text-admin-green font-bold' :
                  col === 'GD' ? (record.GD > 0 ? 'text-admin-green' : record.GD < 0 ? 'text-admin-red' : 'text-admin-text2') :
                  'text-admin-text2',
                )}>
                  {col === 'GD' && record.GD > 0 ? `+${record.GD}` : record[col]}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-admin-text3 text-xs uppercase tracking-wider mb-3">
          <span className="flex items-center gap-1.5">
            <Users className="w-3 h-3" />
            Players
          </span>
        </p>
        {lt.playerAssignments.length === 0 ? (
          <p className="text-admin-text3 text-sm">No players assigned to this team.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {lt.playerAssignments.map((pa) => (
              <div
                key={pa.id}
                className="flex items-center px-3 py-2.5 rounded-lg bg-admin-surface2 text-sm text-admin-text min-h-[40px]"
              >
                {pa.player.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TeamsTab({ leagueId, leagueTeams, allTeams }: TeamsTabProps) {
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(leagueTeams[0]?.id ?? null)
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollTeamId, setEnrollTeamId] = useState('')
  const [pending, startTransition] = useTransition()

  const selected = leagueTeams.find((lt) => lt.id === selectedId) ?? null
  const enrolledTeamIds = new Set(leagueTeams.map((lt) => lt.team.id))
  const availableTeams = allTeams.filter((t) => !enrolledTeamIds.has(t.id))

  async function handleEnroll() {
    if (!enrollTeamId) return
    startTransition(async () => {
      try {
        await enrollTeam(leagueId, enrollTeamId)
        toast('Team enrolled')
        setShowEnroll(false)
        setEnrollTeamId('')
      } catch {
        toast('Failed to enroll team', 'error')
      }
    })
  }

  async function handleRemove(leagueTeamId: string, teamName: string) {
    try {
      await removeTeamFromLeague(leagueTeamId, leagueId)
      toast(`${teamName} removed`)
      if (selectedId === leagueTeamId) setSelectedId(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove', 'error')
    }
  }

  const EnrollSection = ({ compact }: { compact?: boolean }) => (
    <div className={cn('border-t border-admin-border', compact ? 'p-3' : 'p-4')}>
      {showEnroll ? (
        <div className="flex flex-col gap-2">
          <select
            value={enrollTeamId}
            onChange={(e) => setEnrollTeamId(e.target.value)}
            className="bg-admin-surface3 border border-admin-border text-admin-text text-xs rounded px-2 py-2 w-full"
          >
            <option value="">Select team…</option>
            {availableTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <button
              onClick={handleEnroll}
              disabled={!enrollTeamId || pending}
              className="flex-1 px-2 py-2 bg-admin-green text-admin-ink text-xs font-medium rounded hover:opacity-90 disabled:opacity-50 min-h-[36px]"
            >
              Enroll
            </button>
            <button
              onClick={() => { setShowEnroll(false); setEnrollTeamId('') }}
              className="px-2 py-2 border border-admin-border text-admin-text2 text-xs rounded hover:border-admin-border2 min-h-[36px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowEnroll(true)}
          disabled={availableTeams.length === 0}
          className="flex items-center gap-1.5 text-admin-text3 text-xs hover:text-admin-green transition-colors disabled:opacity-40 disabled:cursor-not-allowed py-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Enroll Team
        </button>
      )}
    </div>
  )

  return (
    <>
      {/* ── Mobile: accordion ────────────────────────────────────────────── */}
      <div className="md:hidden rounded-xl border border-admin-border overflow-hidden bg-admin-surface">
        <div className="px-4 py-3 bg-admin-surface2 border-b border-admin-border">
          <p className="text-admin-text3 text-xs uppercase tracking-wider">
            Teams ({leagueTeams.length})
          </p>
        </div>

        {leagueTeams.map((lt) => {
          const isOpen = selectedId === lt.id
          return (
            <div key={lt.id} className="border-b border-admin-border last:border-b-0">
              <div
                className="flex items-center gap-3 px-4 min-h-[52px] cursor-pointer hover:bg-admin-surface2 transition-colors"
                onClick={() => setSelectedId(isOpen ? null : lt.id)}
              >
                <ChevronRight
                  className={cn('w-4 h-4 text-admin-text3 transition-transform shrink-0', isOpen && 'rotate-90')}
                />
                <span className="flex-1 text-admin-text text-sm">{lt.team.name}</span>
                <span className="text-admin-text3 text-xs font-mono shrink-0">
                  {lt.playerAssignments.length}
                </span>
              </div>
              {isOpen && (
                <div className="px-4 py-4 border-t border-admin-border bg-admin-surface2/30">
                  <TeamDetail
                    lt={lt}
                    onRemove={() => handleRemove(lt.id, lt.team.name)}
                  />
                </div>
              )}
            </div>
          )
        })}

        <EnrollSection />
      </div>

      {/* ── Desktop: two-panel ───────────────────────────────────────────── */}
      <div className="hidden md:flex gap-0 rounded-xl border border-admin-border overflow-hidden bg-admin-surface">
        {/* Left panel – team list */}
        <div className="w-[220px] shrink-0 border-r border-admin-border flex flex-col">
          <div className="px-4 py-3 border-b border-admin-border">
            <p className="text-admin-text3 text-xs uppercase tracking-wider">Teams ({leagueTeams.length})</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {leagueTeams.map((lt) => (
              <div
                key={lt.id}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors text-sm',
                  selectedId === lt.id
                    ? 'bg-admin-surface2 text-admin-text'
                    : 'text-admin-text2 hover:bg-admin-surface2 hover:text-admin-text',
                )}
                onClick={() => setSelectedId(lt.id)}
              >
                {selectedId === lt.id && (
                  <span className="w-1.5 h-1.5 rounded-full bg-admin-green shrink-0" />
                )}
                {selectedId !== lt.id && <span className="w-1.5 h-1.5 shrink-0" />}
                <span className="truncate">{lt.team.name}</span>
                <span className="ml-auto text-admin-text3 text-xs font-mono">
                  {lt.playerAssignments.length}
                </span>
              </div>
            ))}
          </div>

          <EnrollSection compact />
        </div>

        {/* Right panel – team detail */}
        <div className="flex-1 p-6">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-admin-text3 text-sm">
              Select a team to view details
            </div>
          ) : (
            <TeamDetail
              lt={selected}
              onRemove={() => handleRemove(selected.id, selected.team.name)}
            />
          )}
        </div>
      </div>
    </>
  )
}
