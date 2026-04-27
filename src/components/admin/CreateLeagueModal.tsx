'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { createLeague } from '@/app/admin/leagues/actions'

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

export default function CreateLeagueModal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subStatus, setSubStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [pending, startTransition] = useTransition()
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-derive subdomain from name
  useEffect(() => { if (name) setSubdomain(toSlug(name)) }, [name])

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setName('')
      setSubdomain('')
      setSubStatus('idle')
    }
  }, [open])

  const checkSubdomain = useCallback((slug: string) => {
    if (!slug) { setSubStatus('idle'); return }
    setSubStatus('checking')
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subdomains/check?value=${encodeURIComponent(slug)}`)
        const data = (await res.json()) as { available: boolean }
        setSubStatus(data.available ? 'available' : 'taken')
      } catch {
        setSubStatus('idle')
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (subStatus === 'taken') return
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

        {/* Subdomain */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">
            Subdomain
          </label>
          <div className="flex items-center gap-2">
            <input
              name="subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(toSlug(e.target.value))}
              placeholder="tamachi"
              className="flex-1 rounded-[6px] border border-admin-border2 bg-admin-surface2 px-3 py-[9px] text-sm text-admin-text outline-none transition-colors focus:border-admin-green/60 font-mono"
            />
            <span className="text-sm text-admin-text3">.t9l.me</span>
          </div>
          {subdomain.length > 2 && subStatus !== 'idle' && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded-[6px] bg-admin-surface3 px-2.5 py-1.5 font-mono text-xs">
              {subStatus === 'checking' && <Loader2 className="w-3 h-3 text-admin-text3 animate-spin" />}
              {subStatus === 'available' && <Check className="w-3 h-3 text-admin-green" />}
              {subStatus === 'taken' && <X className="w-3 h-3 text-admin-red" />}
              <span className="text-admin-text2">{subdomain}.t9l.me</span>
              <span className={
                subStatus === 'available' ? 'font-bold text-admin-green'
                : subStatus === 'taken'   ? 'font-bold text-admin-red'
                :                           'text-admin-text3'
              }>
                {subStatus === 'available' ? 'Available' : subStatus === 'taken' ? 'Already in use' : 'Checking…'}
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
            disabled={pending || subStatus === 'taken'}
            className="rounded-[6px] bg-admin-green px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create League'}
          </button>
        </div>
      </form>
    </div>
  )
}
