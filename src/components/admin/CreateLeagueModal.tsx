'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, X, Loader2, AlertCircle } from 'lucide-react'
import { createLeague } from '@/app/admin/leagues/actions'
import { validateLeagueSlug } from '@/lib/leagueSlug'

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

interface Props {
  open: boolean
  onClose: () => void
}

type SubStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'taken' }

const REASON_COPY: Record<string, string> = {
  empty: 'Please enter a slug',
  'too-short': 'Must be at least 3 characters',
  'too-long': 'Must be 30 characters or fewer',
  'invalid-format': 'Use only lowercase letters, numbers, and hyphens (no leading/trailing hyphen)',
  reserved: 'This slug is reserved',
  'in-use': 'Already in use',
}

/**
 * v1.53.1 (PR 5 of the path-routing chain) — Admin "Create League"
 * modal. Slug field gets:
 *   - Warning copy: "Cannot be changed after creation"
 *   - Client-side reserved-word + format validation via the canonical
 *     `validateLeagueSlug` helper (mirrors server-side enforcement in
 *     `createLeague`).
 *   - URL preview shows the canonical path-based form
 *     `/league/<slug>` (replaces the legacy `<slug>.t9l.me` subdomain
 *     preview removed in PR 4).
 *   - Per-failure-reason error copy so the admin sees "too short" vs
 *     "reserved" vs "already in use".
 */
export default function CreateLeagueModal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subStatus, setSubStatus] = useState<SubStatus>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-derive slug from name
  useEffect(() => { if (name) setSubdomain(toSlug(name)) }, [name])

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setName('')
      setSubdomain('')
      setSubStatus({ kind: 'idle' })
    }
  }, [open])

  const checkSubdomain = useCallback((slug: string) => {
    if (!slug) {
      setSubStatus({ kind: 'idle' })
      return
    }
    // Client-side validation up front — instant feedback, no fetch needed
    // for malformed input.
    const local = validateLeagueSlug(slug)
    if (!local.ok) {
      setSubStatus({ kind: 'invalid', reason: local.reason })
      return
    }
    setSubStatus({ kind: 'checking' })
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subdomains/check?value=${encodeURIComponent(slug)}`)
        const data = (await res.json()) as { available: boolean; reason?: string }
        if (data.available) {
          setSubStatus({ kind: 'available' })
        } else if (data.reason && data.reason !== 'in-use') {
          // Server caught something the client missed (race, normalization edge).
          setSubStatus({ kind: 'invalid', reason: data.reason })
        } else {
          setSubStatus({ kind: 'taken' })
        }
      } catch {
        setSubStatus({ kind: 'idle' })
      }
    }, 400)
  }, [])

  useEffect(() => {
    checkSubdomain(subdomain)
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current) }
  }, [subdomain, checkSubdomain])

  // Esc closes
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const submitDisabled =
    pending || subStatus.kind === 'taken' || subStatus.kind === 'invalid' || subStatus.kind === 'checking'

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (subStatus.kind === 'taken' || subStatus.kind === 'invalid') return
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await createLeague(fd)
      onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-[480px] max-w-[calc(100vw-32px)] flex flex-col gap-6 rounded-[10px] border border-admin-border2 bg-admin-surface p-8"
      >
        <h2 className="font-condensed font-extrabold text-[22px] tracking-[0.5px] text-admin-text">
          Create New League
        </h2>

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">
            League Name
          </label>
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tamachi League"
            className="rounded-[6px] border border-admin-border2 bg-admin-surface2 px-3 py-[9px] text-sm text-admin-text outline-none transition-colors focus:border-admin-green/60"
          />
        </div>

        {/* URL slug */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">
            URL slug
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-admin-text3 font-mono">/league/</span>
            <input
              name="subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(toSlug(e.target.value))}
              placeholder="tamachi"
              data-testid="create-league-slug-input"
              className="flex-1 rounded-[6px] border border-admin-border2 bg-admin-surface2 px-3 py-[9px] text-sm text-admin-text outline-none transition-colors focus:border-admin-green/60 font-mono"
            />
          </div>
          <p
            className="mt-1.5 text-[11px] text-admin-text3 leading-relaxed"
            data-testid="create-league-slug-warning"
          >
            <span className="font-bold text-admin-text2">Cannot be changed after creation.</span>
            {' '}
            Lowercase letters, numbers, and hyphens. 3–30 characters. Reserved
            words (admin, auth, api, ...) are not allowed.
          </p>
          {subdomain.length > 0 && subStatus.kind !== 'idle' && (
            <div
              className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded-[6px] bg-admin-surface3 px-2.5 py-1.5 font-mono text-xs"
              data-testid="create-league-slug-status"
            >
              {subStatus.kind === 'checking' && <Loader2 className="w-3 h-3 text-admin-text3 animate-spin" />}
              {subStatus.kind === 'available' && <Check className="w-3 h-3 text-admin-green" />}
              {subStatus.kind === 'taken' && <X className="w-3 h-3 text-admin-red" />}
              {subStatus.kind === 'invalid' && <AlertCircle className="w-3 h-3 text-admin-red" />}
              <span className="text-admin-text2">/league/{subdomain}</span>
              <span className={
                subStatus.kind === 'available' ? 'font-bold text-admin-green'
                : subStatus.kind === 'taken'   ? 'font-bold text-admin-red'
                : subStatus.kind === 'invalid' ? 'font-bold text-admin-red'
                :                                'text-admin-text3'
              }>
                {subStatus.kind === 'available' && 'Available'}
                {subStatus.kind === 'taken' && 'Already in use'}
                {subStatus.kind === 'checking' && 'Checking…'}
                {subStatus.kind === 'invalid' && (REASON_COPY[subStatus.reason] ?? 'Invalid')}
              </span>
            </div>
          )}
        </div>

        {/* Location + Season Start */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">
              Location
            </label>
            <input
              name="location"
              placeholder="e.g. Tamachi Arena"
              className="rounded-[6px] border border-admin-border2 bg-admin-surface2 px-3 py-[9px] text-sm text-admin-text outline-none transition-colors focus:border-admin-green/60"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">
              Season Start
            </label>
            <input
              name="startDate"
              type="date"
              required
              className="rounded-[6px] border border-admin-border2 bg-admin-surface2 px-3 py-[9px] text-sm text-admin-text outline-none transition-colors focus:border-admin-green/60 font-mono"
            />
          </div>
        </div>

        {/* Season End */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">
            Season End <span className="text-admin-text3 normal-case tracking-normal">(optional)</span>
          </label>
          <input
            name="endDate"
            type="date"
            className="rounded-[6px] border border-admin-border2 bg-admin-surface2 px-3 py-[9px] text-sm text-admin-text outline-none transition-colors focus:border-admin-green/60 font-mono"
          />
        </div>

        {/* Footer */}
        <div className="mt-2 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-admin-border bg-transparent px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-text2 transition-colors hover:border-admin-border2 hover:text-admin-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-[6px] bg-admin-green px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create League'}
          </button>
        </div>
      </form>
    </div>
  )
}
