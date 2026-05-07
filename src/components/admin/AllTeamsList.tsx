'use client'

/**
 * v1.74.0 — Global Teams CRUD list at `/admin/teams-all`.
 *
 * Replaces the legacy nav link "All Teams" that 404'd pre-v1.74.0.
 * Surfaces every Team across all leagues with filter (by league),
 * sort (league name → team name), create (name + league required;
 * logo optional), edit (name + logo replace), delete (soft-blocked
 * when the team has player or match references).
 *
 * Logo upload uses the v1.71.1 client-direct Vercel Blob pattern —
 * the browser PUTs straight to Blob via `@vercel/blob/client#upload`
 * and the resulting URL is persisted via `adminUpdateTeamLogo`. This
 * bypasses the 4.5MB Vercel platform body cap.
 */

import { useState, useTransition, useMemo, useRef } from 'react'
import Image from 'next/image'
import { Plus, Trash2, Edit2, Upload, X, Search } from 'lucide-react'
import { upload } from '@vercel/blob/client'
import { useToast } from './ToastProvider'
import ConfirmDialog from './ConfirmDialog'
import {
  adminCreateTeam,
  adminUpdateTeam,
  adminUpdateTeamLogo,
  adminUpdateTeamColor,
  adminDeleteTeam,
} from '@/app/admin/teams-all/actions'

const UPLOAD_TOKEN_URL = '/api/blob/upload-token'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 5 * 1024 * 1024

interface TeamRow {
  id: string
  name: string
  color: string | null
  logoUrl: string | null
  leagues: { id: string; name: string; leagueTeamId: string }[]
  playerCount: number
  matchCount: number
}

interface LeagueRef {
  id: string
  name: string
}

interface AllTeamsListProps {
  teams: TeamRow[]
  leagues: LeagueRef[]
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : 'png'
}

export default function AllTeamsList({ teams, leagues }: AllTeamsListProps) {
  const [search, setSearch] = useState('')
  const [filterLeagueId, setFilterLeagueId] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let rows = teams
    if (filterLeagueId) {
      rows = rows.filter((t) => t.leagues.some((l) => l.id === filterLeagueId))
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.leagues.some((l) => l.name.toLowerCase().includes(q)),
      )
    }
    return rows
  }, [teams, search, filterLeagueId])

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="font-condensed font-bold text-[11px] uppercase tracking-[3px] text-admin-text3">
          All Teams ({teams.length})
        </h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          data-testid="all-teams-create-button"
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-admin-border bg-admin-surface px-3 py-1.5 text-xs text-admin-text2 transition-colors hover:border-admin-border2 hover:text-admin-text"
        >
          <Plus className="w-3.5 h-3.5" />
          Add team
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-admin-text3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by team or league name…"
            data-testid="all-teams-search"
            className="w-full bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md pl-9 pr-3 py-2 outline-none focus:border-admin-green"
          />
        </div>
        <select
          value={filterLeagueId}
          onChange={(e) => setFilterLeagueId(e.target.value)}
          data-testid="all-teams-league-filter"
          className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green md:w-64"
        >
          <option value="">All leagues</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-admin-text3">
          <p className="font-condensed text-base font-semibold text-admin-text2">
            {teams.length === 0 ? 'No teams yet' : 'No teams match your filter'}
          </p>
          <p className="text-sm">
            {teams.length === 0
              ? 'Add your first team to get started.'
              : 'Try clearing the search or league filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-admin-border">
          <table className="w-full text-sm">
            <thead className="bg-admin-surface2 text-admin-text3">
              <tr>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2 w-12">
                  Logo
                </th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2 w-14">
                  Color
                </th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2">
                  Team
                </th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2">
                  League(s)
                </th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2 hidden md:table-cell">
                  Players
                </th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border" data-testid="all-teams-tbody">
              {filtered.map((t) => (
                <TeamRowView
                  key={t.id}
                  team={t}
                  onEdit={() => setEditingTeamId(t.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateTeamDialog
          leagues={leagues}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editingTeamId && (
        <EditTeamDialog
          team={teams.find((t) => t.id === editingTeamId)!}
          onClose={() => setEditingTeamId(null)}
        />
      )}
    </div>
  )
}

// ── Row view ──────────────────────────────────────────────────────────

function ColorSwatch({ team }: { team: TeamRow }) {
  const { toast } = useToast()
  const colorRef = useRef<HTMLInputElement>(null)

  async function handleColorChange(e: React.ChangeEvent<HTMLInputElement>) {
    const color = e.target.value
    try {
      await adminUpdateTeamColor({ id: team.id, color })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update color')
    }
  }

  return (
    <div className="relative w-7 h-7" title={team.color ?? 'No color set'}>
      <button
        type="button"
        onClick={() => colorRef.current?.click()}
        data-testid={`all-teams-color-swatch-${team.id}`}
        className="w-7 h-7 rounded border border-admin-border focus:outline-none focus:ring-2 focus:ring-admin-green/50 overflow-hidden"
        style={{ backgroundColor: team.color ?? undefined }}
        aria-label={`Set color for ${team.name}`}
      >
        {!team.color && (
          <span className="flex items-center justify-center w-full h-full text-admin-text3 text-[10px]">
            —
          </span>
        )}
      </button>
      <input
        ref={colorRef}
        type="color"
        value={team.color ?? '#ffffff'}
        onChange={handleColorChange}
        data-testid={`all-teams-color-input-${team.id}`}
        className="absolute inset-0 opacity-0 w-0 h-0 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  )
}

function TeamRowView({ team, onEdit }: { team: TeamRow; onEdit: () => void }) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          await adminDeleteTeam({ id: team.id })
          toast('Team deleted')
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed to delete')
        }
        resolve()
      })
    })
  }

  const canDelete = team.playerCount === 0 && team.matchCount === 0
  const blockReason =
    team.playerCount > 0
      ? `${team.playerCount} player${team.playerCount === 1 ? '' : 's'} assigned — reassign first`
      : team.matchCount > 0
      ? `${team.matchCount} match${team.matchCount === 1 ? '' : 'es'} reference this team`
      : 'Delete team'

  return (
    <tr className="text-admin-text2 hover:bg-admin-surface3/40" data-testid={`all-teams-row-${team.id}`}>
      <td className="px-3 py-2">
        {team.logoUrl ? (
          <div className="relative w-8 h-8 rounded bg-admin-surface3 overflow-hidden">
            <Image
              src={team.logoUrl}
              alt={team.name}
              fill
              sizes="32px"
              className="object-contain"
            />
          </div>
        ) : (
          <div className="w-8 h-8 rounded bg-admin-surface3 border border-admin-border flex items-center justify-center text-[10px] text-admin-text3 uppercase">
            {team.name.slice(0, 2)}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <ColorSwatch team={team} />
      </td>
      <td className="px-3 py-2 text-admin-text font-medium">{team.name}</td>
      <td className="px-3 py-2 text-xs">
        {team.leagues.length === 0 ? (
          <span className="text-admin-text3 italic">No league</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {team.leagues.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center rounded border border-admin-border bg-admin-surface2 px-1.5 py-0.5 text-admin-text2"
              >
                {l.name}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 hidden md:table-cell text-xs text-admin-text3">
        {team.playerCount === 0 ? '—' : team.playerCount}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            data-testid={`all-teams-edit-${team.id}`}
            className="rounded-[6px] border border-admin-border bg-transparent p-1.5 text-admin-text3 hover:border-admin-border2 hover:text-admin-text"
            title="Edit team"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={pending || !canDelete}
                title={blockReason}
                data-testid={`all-teams-delete-${team.id}`}
                className="rounded-[6px] border border-admin-border bg-transparent p-1.5 text-admin-text3 hover:border-admin-red hover:text-admin-red disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            }
            title="Delete team?"
            description={`"${team.name}" will be permanently removed.`}
            confirmLabel="Delete"
            onConfirm={handleDelete}
            variant="danger"
          />
        </div>
      </td>
    </tr>
  )
}

// ── Create dialog ─────────────────────────────────────────────────────

function CreateTeamDialog({
  leagues,
  onClose,
}: {
  leagues: LeagueRef[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [leagueId, setLeagueId] = useState(leagues[0]?.id ?? '')
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (!leagueId) return
    startTransition(async () => {
      try {
        await adminCreateTeam({ name: trimmed, leagueId })
        toast('Team created')
        onClose()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to create team')
      }
    })
  }

  return (
    <DialogShell title="Add team" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" data-testid="all-teams-create-form">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[2px] text-admin-text3">
            Team name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="e.g. Mariners FC"
            data-testid="all-teams-create-name"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[2px] text-admin-text3">
            League
          </span>
          <select
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            required
            data-testid="all-teams-create-league"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
          >
            <option value="">Select a league…</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-admin-text3 -mt-1">
          You can upload a logo after the team is created.
        </p>
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-admin-border bg-transparent px-3 py-1.5 text-xs text-admin-text2 hover:border-admin-border2 hover:text-admin-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim() || !leagueId}
            data-testid="all-teams-create-submit"
            className="rounded-[6px] border border-admin-green bg-admin-green/10 px-3 py-1.5 text-xs text-admin-green hover:bg-admin-green/20 disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create team'}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

// ── Edit dialog ───────────────────────────────────────────────────────

function EditTeamDialog({
  team,
  onClose,
}: {
  team: TeamRow
  onClose: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState(team.name)
  const [color, setColor] = useState<string>(team.color ?? '#ffffff')
  const [logoUrl, setLogoUrl] = useState<string | null>(team.logoUrl)
  const [uploading, setUploading] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleColorChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newColor = e.target.value
    setColor(newColor)
    try {
      await adminUpdateTeamColor({ id: team.id, color: newColor })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update color')
    }
  }

  async function handleColorClear() {
    setColor('#ffffff')
    try {
      await adminUpdateTeamColor({ id: team.id, color: null })
      toast('Color cleared')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to clear color')
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast('Logo must be JPG, PNG, WEBP, or SVG')
      return
    }
    if (file.size > MAX_BYTES) {
      toast('Logo must be under 5MB')
      return
    }
    setUploading(true)
    try {
      const ts = Date.now()
      const path = `team-logo/${team.id}/logo-${ts}.${extOf(file.name)}`
      const result = await upload(path, file, {
        access: 'public',
        handleUploadUrl: UPLOAD_TOKEN_URL,
        contentType: file.type || undefined,
      })
      await adminUpdateTeamLogo({ id: team.id, logoUrl: result.url })
      setLogoUrl(result.url)
      toast('Logo uploaded')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemoveLogo() {
    setUploading(true)
    try {
      await adminUpdateTeamLogo({ id: team.id, logoUrl: null })
      setLogoUrl(null)
      toast('Logo removed')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove logo')
    } finally {
      setUploading(false)
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed === team.name) {
      onClose()
      return
    }
    startTransition(async () => {
      try {
        await adminUpdateTeam({ id: team.id, name: trimmed })
        toast('Team updated')
        onClose()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to update team')
      }
    })
  }

  return (
    <DialogShell title="Edit team" onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="all-teams-edit-form">
        {/* Logo section */}
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 rounded bg-admin-surface3 border border-admin-border overflow-hidden flex items-center justify-center">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={team.name}
                fill
                sizes="64px"
                className="object-contain"
              />
            ) : (
              <span className="text-xs text-admin-text3 uppercase">
                {team.name.slice(0, 2)}
              </span>
            )}
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
              data-testid="all-teams-edit-logo-input"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-admin-border bg-admin-surface2 px-3 py-1.5 text-xs text-admin-text2 hover:border-admin-border2 hover:text-admin-text disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            </button>
            {logoUrl && !uploading && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                className="inline-flex items-center gap-1.5 self-start rounded-[6px] border border-transparent px-1 py-0.5 text-[11px] text-admin-text3 hover:text-admin-red"
              >
                Remove logo
              </button>
            )}
            <p className="text-[10px] text-admin-text3">
              JPG, PNG, WEBP, or SVG · max 5MB
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[2px] text-admin-text3">
              Team name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              data-testid="all-teams-edit-name"
              className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[2px] text-admin-text3">
              Team color
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={handleColorChange}
                data-testid="all-teams-edit-color"
                className="w-9 h-9 rounded border border-admin-border2 cursor-pointer bg-admin-surface2 p-0.5"
                title="Pick team color"
              />
              <span className="font-mono text-xs text-admin-text2">{color}</span>
              {team.color && (
                <button
                  type="button"
                  onClick={handleColorClear}
                  className="text-[11px] text-admin-text3 hover:text-admin-red"
                  data-testid="all-teams-edit-color-clear"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[10px] text-admin-text3">
              Used for team styling (e.g. accordion dot, stat highlights).
            </p>
          </div>

          {team.leagues.length > 0 && (
            <div className="text-[11px] text-admin-text3">
              Enrolled in:{' '}
              {team.leagues.map((l) => l.name).join(', ')}
              <span className="block mt-0.5">
                League membership is managed from the per-league Teams tab.
              </span>
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] border border-admin-border bg-transparent px-3 py-1.5 text-xs text-admin-text2 hover:border-admin-border2 hover:text-admin-text"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={pending || !name.trim()}
              data-testid="all-teams-edit-submit"
              className="rounded-[6px] border border-admin-green bg-admin-green/10 px-3 py-1.5 text-xs text-admin-green hover:bg-admin-green/20 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      </div>
    </DialogShell>
  )
}

// ── Dialog shell ──────────────────────────────────────────────────────

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-admin-border bg-admin-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-condensed font-bold text-admin-text text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-admin-text3 hover:text-admin-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
