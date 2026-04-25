'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createLeague } from '@/app/admin/leagues/actions'

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function CreateLeagueForm() {
  const [name, setName]           = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [location, setLocation]   = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [subdomainStatus, setSubdomainStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [pending, startTransition] = useTransition()
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-derive subdomain from name
  useEffect(() => {
    if (name) setSubdomain(toSlug(name))
  }, [name])

  // Debounced availability check
  const checkSubdomain = useCallback((slug: string) => {
    if (!slug) { setSubdomainStatus('idle'); return }
    setSubdomainStatus('checking')
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subdomains/check?value=${encodeURIComponent(slug)}`)
        const data = await res.json() as { available: boolean }
        setSubdomainStatus(data.available ? 'available' : 'taken')
      } catch {
        setSubdomainStatus('idle')
      }
    }, 400)
  }, [])

  useEffect(() => {
    checkSubdomain(subdomain)
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current) }
  }, [subdomain, checkSubdomain])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (subdomainStatus === 'taken') return
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await createLeague(fd)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
      {/* League Name */}
      <div>
        <label className="block text-admin-text2 text-sm mb-1.5">
          League Name <span className="text-admin-red">*</span>
        </label>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Tennozu 9-Aside League"
          className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded-lg px-3 py-2.5 outline-none focus:border-admin-green/50 transition-colors placeholder:text-admin-text3"
        />
      </div>

      {/* Subdomain */}
      <div>
        <label className="block text-admin-text2 text-sm mb-1.5">Subdomain</label>
        <div className="relative">
          <div className="flex items-center bg-admin-surface3 border border-admin-border rounded-lg overflow-hidden focus-within:border-admin-green/50 transition-colors">
            <input
              name="subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(toSlug(e.target.value))}
              className="flex-1 bg-transparent text-admin-text text-sm px-3 py-2.5 outline-none font-mono"
              placeholder="league-slug"
            />
            <span className="px-3 text-admin-text3 text-sm font-mono border-l border-admin-border">.t9l.me</span>
            <span className="px-3">
              {subdomainStatus === 'checking' && <Loader2 className="w-3.5 h-3.5 text-admin-text3 animate-spin" />}
              {subdomainStatus === 'available' && <Check className="w-3.5 h-3.5 text-admin-green" />}
              {subdomainStatus === 'taken' && <X className="w-3.5 h-3.5 text-admin-red" />}
            </span>
          </div>
          {subdomainStatus === 'taken' && (
            <p className="text-admin-red text-xs mt-1">This subdomain is already taken.</p>
          )}
          {subdomainStatus === 'available' && (
            <p className="text-admin-green text-xs mt-1">Available!</p>
          )}
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="block text-admin-text2 text-sm mb-1.5">Location</label>
        <input
          name="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Tokyo, Japan"
          className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded-lg px-3 py-2.5 outline-none focus:border-admin-green/50 transition-colors placeholder:text-admin-text3"
        />
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-admin-text2 text-sm mb-1.5">
            Season Start <span className="text-admin-red">*</span>
          </label>
          <input
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded-lg px-3 py-2.5 outline-none focus:border-admin-green/50 transition-colors font-mono"
          />
        </div>
        <div>
          <label className="block text-admin-text2 text-sm mb-1.5">Season End</label>
          <input
            name="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded-lg px-3 py-2.5 outline-none focus:border-admin-green/50 transition-colors font-mono"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending || subdomainStatus === 'taken'}
          className="px-5 py-2.5 bg-admin-green text-admin-bg font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Creating…' : 'Create League'}
        </button>
        <a
          href="/admin"
          className="px-5 py-2.5 border border-admin-border text-admin-text2 text-sm rounded-lg hover:border-admin-border2 hover:text-admin-text transition-colors no-underline"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
