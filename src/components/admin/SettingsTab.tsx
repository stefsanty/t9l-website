'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import ConfirmDialog from './ConfirmDialog'
import { useToast } from './ToastProvider'
import { updateLeagueInfo, deleteLeague } from '@/app/admin/leagues/actions'

interface League {
  id: string
  name: string
  description: string | null
  subdomain: string | null
  location: string
  startDate: Date
  endDate: Date | null
}

function fmtDate(d: Date | null) {
  if (!d) return ''
  return new Date(d).toISOString().split('T')[0]
}

type SubdomainStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

export default function SettingsTab({ league }: { league: League }) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  const [name, setName]             = useState(league.name)
  const [description, setDesc]      = useState(league.description ?? '')
  const [subdomain, setSubdomain]   = useState(league.subdomain ?? '')
  const [location, setLocation]     = useState(league.location)
  const [startDate, setStartDate]   = useState(fmtDate(league.startDate))
  const [endDate, setEndDate]       = useState(fmtDate(league.endDate))
  const [subStatus, setSubStatus]   = useState<SubdomainStatus>('idle')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live subdomain check
  useEffect(() => {
    const val = subdomain.trim().toLowerCase()
    if (!val) { setSubStatus('idle'); return }

    // Basic format validation
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(val)) {
      setSubStatus('invalid')
      return
    }

    // Skip check if unchanged from saved value
    if (val === (league.subdomain ?? '')) {
      setSubStatus('available')
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSubStatus('checking')
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subdomains/check?value=${encodeURIComponent(val)}&exclude=${league.id}`)
        const { available } = await res.json()
        setSubStatus(available ? 'available' : 'taken')
      } catch {
        setSubStatus('idle')
      }
    }, 400)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain])

  function handleSave() {
    startTransition(async () => {
      try {
        await updateLeagueInfo(league.id, {
          name:        name.trim(),
          description: description.trim() || null,
          subdomain:   subdomain.trim().toLowerCase() || null,
          location:    location.trim(),
          startDate:   startDate || undefined,
          endDate:     endDate || null,
        })
        toast('Settings saved')
      } catch (err: unknown) {
        toast(err instanceof Error ? err.message : 'Failed to save settings')
      }
    })
  }

  function handleStartSeason() {
    startTransition(async () => {
      await updateLeagueInfo(league.id, { startDate: new Date().toISOString().split('T')[0] })
      toast('Season started')
    })
  }

  function handleEndSeason() {
    startTransition(async () => {
      await updateLeagueInfo(league.id, { endDate: new Date().toISOString().split('T')[0] })
      toast('Season ended')
    })
  }

  const saveDisabled = pending || subStatus === 'taken' || subStatus === 'invalid' || !name.trim() || !location.trim()

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-8">

      {/* Main form */}
      <section className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5">
        <h2 className="font-condensed font-bold text-admin-text text-lg">League Info</h2>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">League Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none focus:border-admin-border2"
            placeholder="League name"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none focus:border-admin-border2 resize-none"
            placeholder="Optional description"
          />
        </div>

        {/* Subdomain */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Subdomain</label>
          <div className="relative">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className={cn(
                'w-full bg-admin-surface2 border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none pr-9',
                subStatus === 'available' ? 'border-admin-green/60' :
                subStatus === 'taken'     ? 'border-admin-red/60'   :
                subStatus === 'invalid'   ? 'border-admin-amber/60' :
                                            'border-admin-border focus:border-admin-border2',
              )}
              placeholder="my-league"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {subStatus === 'checking'  && <Loader2 className="w-4 h-4 text-admin-text3 animate-spin" />}
              {subStatus === 'available' && <CheckCircle className="w-4 h-4 text-admin-green" />}
              {subStatus === 'taken'     && <XCircle className="w-4 h-4 text-admin-red" />}
              {subStatus === 'invalid'   && <XCircle className="w-4 h-4 text-admin-amber" />}
            </div>
          </div>
          <p className="text-xs text-admin-text3">
            {subStatus === 'taken'   && 'This subdomain is already taken'}
            {subStatus === 'invalid' && 'Lowercase letters, numbers, hyphens only. Must start/end with alphanumeric.'}
            {subStatus !== 'taken' && subStatus !== 'invalid' && 'Used for the public-facing URL (e.g. my-league.t9l.me)'}
          </p>
        </div>

        {/* Location */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none focus:border-admin-border2"
            placeholder="City, Country"
          />
        </div>

        {/* Season dates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Season Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-admin-border2"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Season End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-admin-border2"
            />
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saveDisabled}
          className="px-5 py-2 bg-admin-green text-admin-ink font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save Changes'}
        </button>
      </section>

      {/* Quick actions */}
      <section className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-4">
        <h2 className="font-condensed font-bold text-admin-text text-lg">Season Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleStartSeason}
            disabled={pending}
            className="px-4 py-2 bg-admin-green text-admin-ink font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Mark Season Started (today)
          </button>
          <button
            onClick={handleEndSeason}
            disabled={pending}
            className="px-4 py-2 bg-admin-surface2 text-admin-text2 border border-admin-border font-medium text-sm rounded-lg hover:border-admin-border2 hover:text-admin-text transition-colors disabled:opacity-40"
          >
            Mark Season Ended (today)
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="bg-admin-surface rounded-xl border border-admin-red/30 p-5 space-y-3">
        <h2 className="font-condensed font-bold text-admin-red text-lg">Danger Zone</h2>
        <p className="text-sm text-admin-text2">
          Permanently delete this league. This cannot be undone. Leagues with completed matches cannot be deleted.
        </p>
        <ConfirmDialog
          trigger={
            <button className="px-4 py-2 bg-admin-red-dim text-admin-red border border-admin-red/30 font-medium text-sm rounded-lg hover:bg-admin-red/20 transition-colors">
              Delete League
            </button>
          }
          title="Delete League"
          description={`Are you sure you want to delete "${league.name}"? All matchdays, matches, and enrollments will be permanently removed.`}
          confirmLabel="Delete League"
          onConfirm={async () => { await deleteLeague(league.id) }}
          variant="danger"
        />
      </section>
    </div>
  )
}
