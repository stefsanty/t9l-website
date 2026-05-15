'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Search, Filter, ExternalLink, Unlink2, Shield, Mail, Smartphone, Eye, X } from 'lucide-react'
import { adminUnlinkUserFromPlayer } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'
import AdminPlayerAvatar from './AdminPlayerAvatar'
import { formatJstDayMonth } from '@/lib/jst'

export interface UserRow {
  id: string
  name: string | null
  email: string | null
  image: string | null
  pictureUrl: string | null
  lineId: string | null
  role: 'ADMIN' | 'VIEWER'
  createdAt: string
  providers: string[]
  linkedPlayer: {
    id: string
    name: string | null
    otherLeagues: string[]
  } | null
  lineLastSeenAt: string | null
  idFrontUrl: string | null
  idBackUrl: string | null
  idUploadedAt: string | null
}

interface UsersListProps {
  users: UserRow[]
}

type LinkedFilter = 'all' | 'linked' | 'unlinked'

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  line: <Smartphone className="w-3 h-3" />,
  google: <Shield className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
}

const PROVIDER_LABELS: Record<string, string> = {
  line: 'LINE',
  google: 'Google',
  email: 'Email',
}

/**
 * v1.57.0 (PR 4 of route-shortening chain) — admin Users list view.
 *
 * Columns:
 *   - Avatar + display name + email
 *   - Auth providers (small icon-tagged pills)
 *   - Linked Player (with leagues; or "No player linked")
 *   - Last LINE seen (when applicable)
 *   - Created at
 *   - Per-row Unlink action (when linked)
 *
 * Search filters by display name, email, and linked-player name.
 * Linked-state filter (All / Linked / Unlinked) trims the list to the
 * common "show me users without players" admin chore.
 */
export default function UsersList({ users }: UsersListProps) {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [linkedFilter, setLinkedFilter] = useState<LinkedFilter>('all')
  const [pending, startTransition] = useTransition()
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [viewingIdUser, setViewingIdUser] = useState<UserRow | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (linkedFilter === 'linked' && !u.linkedPlayer) return false
      if (linkedFilter === 'unlinked' && u.linkedPlayer) return false
      if (!q) return true
      const name = (u.name ?? '').toLowerCase()
      const email = (u.email ?? '').toLowerCase()
      const player = (u.linkedPlayer?.name ?? '').toLowerCase()
      return name.includes(q) || email.includes(q) || player.includes(q)
    })
  }, [users, search, linkedFilter])

  function handleUnlink(userRow: UserRow) {
    if (!userRow.linkedPlayer) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Unlink ${userRow.name ?? userRow.email ?? 'this user'} from ${userRow.linkedPlayer.name ?? 'the player'}? Both records survive — only the binding is cleared.`,
      )
    ) {
      return
    }
    setPendingUserId(userRow.id)
    startTransition(async () => {
      try {
        await adminUnlinkUserFromPlayer({ userId: userRow.id })
        toast(`Unlinked ${userRow.name ?? userRow.email ?? 'user'}`)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to unlink', 'error')
      } finally {
        setPendingUserId(null)
      }
    })
  }

  const linkedCount = users.filter((u) => u.linkedPlayer).length
  const unlinkedCount = users.length - linkedCount

  return (
    <div className="px-4 md:px-8 py-6">
      {viewingIdUser && (
        <UserIdModal user={viewingIdUser} onClose={() => setViewingIdUser(null)} />
      )}
      {/* Header */}
      <div className="mb-5">
        <h1 className="font-condensed font-extrabold text-admin-text text-[26px] leading-tight">
          Users
        </h1>
        <p className="mt-1 text-sm text-admin-text3" data-testid="admin-users-summary">
          {users.length} total · {linkedCount} linked to a player · {unlinkedCount} unlinked
        </p>
      </div>

      {/* Toolbar — search + filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-admin-text3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or linked player…"
            className="w-full rounded-[6px] border border-admin-border2 bg-admin-surface2 pl-9 pr-3 py-[8px] text-sm text-admin-text outline-none focus:border-admin-green/60"
            data-testid="admin-users-search"
          />
        </div>
        <div className="inline-flex items-center gap-1 rounded-[6px] border border-admin-border2 bg-admin-surface2 px-1 py-1 text-xs">
          <Filter className="w-3 h-3 text-admin-text3 ml-1" />
          {(['all', 'linked', 'unlinked'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLinkedFilter(opt)}
              className={`rounded-[4px] px-2 py-0.5 transition-colors ${
                linkedFilter === opt
                  ? 'bg-admin-green text-admin-ink font-semibold'
                  : 'text-admin-text2 hover:text-admin-text'
              }`}
              data-testid={`admin-users-filter-${opt}`}
            >
              {opt === 'all' ? 'All' : opt === 'linked' ? 'Linked' : 'Unlinked'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-admin-text3 text-sm bg-admin-surface rounded-xl border border-admin-border">
          {users.length === 0 ? 'No users in the system yet.' : 'No users match the filter.'}
        </div>
      ) : (
        <div
          className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden"
          data-testid="admin-users-list"
        >
          {/* Desktop grid */}
          <div className="hidden md:block">
            <div
              className="grid items-center gap-3 px-5 py-2 border-b border-admin-border text-[10px] font-semibold uppercase tracking-[1.5px] text-admin-text3"
              style={{ gridTemplateColumns: '40px 1fr 180px 200px 48px 100px 80px' }}
            >
              <span />
              <span>Name / email</span>
              <span>Providers</span>
              <span>Linked player</span>
              <span>ID</span>
              <span>Last seen</span>
              <span className="text-right">Actions</span>
            </div>
            <ul className="divide-y divide-admin-border">
              {filtered.map((u) => (
                <li
                  key={u.id}
                  className="grid items-center gap-3 px-5 py-3 hover:bg-admin-surface2/40"
                  style={{ gridTemplateColumns: '40px 1fr 180px 200px 48px 100px 80px' }}
                  data-testid={`admin-users-row-${u.id}`}
                >
                  <AdminPlayerAvatar name={u.name} pictureUrl={u.image ?? u.pictureUrl} size={32} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-admin-text truncate">
                      {u.name ?? <span className="italic text-admin-text3">Unnamed</span>}
                      {u.role === 'ADMIN' && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 rounded-[4px] bg-admin-amber/15 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[1px] text-admin-amber"
                          data-testid={`admin-users-role-${u.id}`}
                        >
                          <Shield className="w-2.5 h-2.5" />
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-admin-text3 font-mono">
                      {u.email ?? '—'}
                    </p>
                  </div>
                  <ProviderPills providers={u.providers} userId={u.id} />
                  <LinkedPlayerCell
                    userId={u.id}
                    linkedPlayer={u.linkedPlayer}
                  />
                  <IdThumbnailCell user={u} onView={() => setViewingIdUser(u)} />
                  <span className="text-[11px] text-admin-text3 font-mono">
                    {u.lineLastSeenAt
                      ? formatJstDayMonth(new Date(u.lineLastSeenAt))
                      : '—'}
                  </span>
                  <div className="flex justify-end">
                    {u.linkedPlayer && (
                      <button
                        type="button"
                        onClick={() => handleUnlink(u)}
                        disabled={pending && pendingUserId === u.id}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-admin-border2 px-2 py-1 text-[11px] font-semibold text-admin-text hover:bg-admin-surface3 disabled:opacity-50"
                        data-testid={`admin-users-unlink-${u.id}`}
                      >
                        <Unlink2 className="w-3 h-3" />
                        Unlink
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden divide-y divide-admin-border">
            {filtered.map((u) => (
              <li
                key={u.id}
                className="px-4 py-3"
                data-testid={`admin-users-row-mobile-${u.id}`}
              >
                <div className="flex items-start gap-3">
                  <AdminPlayerAvatar name={u.name} pictureUrl={u.image ?? u.pictureUrl} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-admin-text truncate">
                      {u.name ?? <span className="italic text-admin-text3">Unnamed</span>}
                      {u.role === 'ADMIN' && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-[4px] bg-admin-amber/15 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[1px] text-admin-amber">
                          <Shield className="w-2.5 h-2.5" />
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-admin-text3 font-mono">
                      {u.email ?? '—'}
                    </p>
                    <div className="mt-2">
                      <ProviderPills providers={u.providers} userId={u.id} />
                    </div>
                    <div className="mt-2 text-[11px] text-admin-text3">
                      <LinkedPlayerCell
                        userId={u.id}
                        linkedPlayer={u.linkedPlayer}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {u.idFrontUrl && (
                      <button
                        type="button"
                        onClick={() => setViewingIdUser(u)}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-admin-border2 px-2 py-1 text-[11px] font-semibold text-admin-text hover:bg-admin-surface3"
                        data-testid={`admin-users-view-id-mobile-${u.id}`}
                      >
                        <Eye className="w-3 h-3" />
                        ID
                      </button>
                    )}
                    {u.linkedPlayer && (
                      <button
                        type="button"
                        onClick={() => handleUnlink(u)}
                        disabled={pending && pendingUserId === u.id}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-admin-border2 px-2 py-1 text-[11px] font-semibold text-admin-text hover:bg-admin-surface3 disabled:opacity-50"
                        data-testid={`admin-users-unlink-mobile-${u.id}`}
                      >
                        <Unlink2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ProviderPills({ providers, userId }: { providers: string[]; userId: string }) {
  if (providers.length === 0) {
    return (
      <span
        className="text-[11px] text-admin-text3 italic"
        data-testid={`admin-users-providers-${userId}`}
      >
        No providers
      </span>
    )
  }
  return (
    <div
      className="flex items-center gap-1 flex-wrap"
      data-testid={`admin-users-providers-${userId}`}
    >
      {providers.map((p) => (
        <span
          key={p}
          className="inline-flex items-center gap-1 rounded-[4px] bg-admin-surface3 px-1.5 py-0.5 text-[10px] font-semibold text-admin-text2"
          data-testid={`admin-users-provider-${userId}-${p}`}
        >
          {PROVIDER_ICONS[p] ?? null}
          {PROVIDER_LABELS[p] ?? p}
        </span>
      ))}
    </div>
  )
}

function IdThumbnailCell({ user, onView }: { user: UserRow; onView: () => void }) {
  if (!user.idFrontUrl) {
    return (
      <span
        className="text-[11px] text-admin-text3"
        data-testid={`admin-users-id-none-${user.id}`}
      >
        —
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onView}
      className="relative block w-10 h-10 rounded overflow-hidden border border-admin-border hover:border-admin-green/60 group"
      data-testid={`admin-users-id-thumb-${user.id}`}
      aria-label="View ID"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/admin/id-image/${user.id}/front`}
        alt="ID front thumbnail"
        className="w-full h-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
        <Eye className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
      </span>
    </button>
  )
}

function UserIdModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="user-id-modal"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-3xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-admin-text font-condensed font-bold text-lg">
              ID for {user.name ?? user.email ?? 'Unnamed user'}
            </h3>
            {user.idUploadedAt && (
              <p className="text-admin-text3 text-xs mt-0.5">
                Uploaded{' '}
                {new Date(user.idUploadedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-admin-text3 hover:text-admin-text"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IdModalPane
            label="Front"
            src={user.idFrontUrl ? `/api/admin/id-image/${user.id}/front` : null}
            testid="user-id-modal-front"
          />
          <IdModalPane
            label="Back"
            src={user.idBackUrl ? `/api/admin/id-image/${user.id}/back` : null}
            testid="user-id-modal-back"
          />
        </div>
      </div>
    </div>
  )
}

function IdModalPane({ label, src, testid }: { label: string; src: string | null; testid: string }) {
  if (!src) {
    return (
      <div className="rounded-md border border-admin-border bg-admin-surface2 p-4 text-center text-admin-text3 text-xs italic">
        {label}: not available
      </div>
    )
  }
  return (
    <div className="rounded-md border border-admin-border bg-admin-surface2 p-2">
      <p className="text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1.5">
        {label}
      </p>
      <a href={src} target="_blank" rel="noopener noreferrer" data-testid={`${testid}-link`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${label} of ID`}
          className="w-full max-h-80 object-contain rounded bg-background"
          data-testid={testid}
        />
      </a>
    </div>
  )
}

function LinkedPlayerCell({
  userId,
  linkedPlayer,
}: {
  userId: string
  linkedPlayer: UserRow['linkedPlayer']
}) {
  if (!linkedPlayer) {
    return (
      <span
        className="text-[11px] text-admin-text3 italic"
        data-testid={`admin-users-linked-${userId}`}
      >
        No player linked
      </span>
    )
  }
  // Deep-link target: there's no canonical "view this player in
  // primary league" route post-v1.56.0, so the link bounces to the
  // first league the player is in. Falls back to the global Player
  // list page if the player has no leagues. The link is best-effort
  // navigation — admins typically know which league they're managing.
  const href = '/admin'
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-admin-text2 hover:text-admin-text no-underline"
      data-testid={`admin-users-linked-${userId}`}
    >
      <span className="truncate">
        {linkedPlayer.name ?? <span className="italic text-admin-text3">Unnamed</span>}
        {linkedPlayer.otherLeagues.length > 0 && (
          <span className="ml-1 text-[10px] text-admin-text3 font-mono">
            ({linkedPlayer.otherLeagues.join(', ')})
          </span>
        )}
      </span>
      <ExternalLink className="w-3 h-3 shrink-0 text-admin-text3" />
    </Link>
  )
}
