'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import ConfirmDialog from './ConfirmDialog'
import { useToast } from './ToastProvider'
import {
  updateLeagueInfo,
  updateLeagueAbbreviation,
  deleteLeague,
  setLeagueAllowSelfLink,
  setLeagueAllowPlayerTeamPick,
  setLeaguePreseasonMode,
  setLeagueRecruiting,
  setLeagueVisibility,
} from '@/app/admin/leagues/actions'
import { formatJstDate } from '@/lib/jst'
import LeagueDetailsEditor from './LeagueDetailsEditor'

interface League {
  id: string
  name: string
  description: string | null
  subdomain: string | null
  location: string
  startDate: Date
  endDate: Date | null
  // v1.60.0 — per-league self-link toggle. Threaded from `getLeagueSettings`
  // (which returns the full League row); default true preserves backward
  // compat for any league that hasn't been touched since v1.59.x.
  allowSelfLink: boolean
  // v2.2.9 — per-league "allow player team pick" toggle. When true, the
  // onboarding form surfaces a team-picker step before the ID section.
  // Default false preserves backward compat.
  allowPlayerTeamPick: boolean
  // v1.63.0 — per-league pre-season + recruiting toggles. Both default
  // false; threaded from `getLeagueSettings` alongside `allowSelfLink`.
  preseasonMode: boolean
  recruiting: boolean
  // v1.84.0 — homepage redesign phase 1a. Three-tier visibility radio.
  // Surfaced alongside the legacy `recruiting` toggle this phase; the
  // public banner gate now reads `visibility === 'PUBLIC_OPEN'` via
  // `getLeagueFlags`. Threaded from `getLeagueSettings`.
  visibility: 'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN'
  // v1.66.0 — per-league fee defaults + per-position fee rows. Both
  // threaded from getLeagueSettings's include.
  defaultFee: number
  positionFees: ReadonlyArray<{ position: string; fee: number }>
  // v1.67.0 — planned-roster targets surfaced in the preseason stats panel.
  plannedPlayersPerTeam: number
  plannedNumberOfTeams: number
  registrationDeadline: Date | null
  // v1.73.0 — short display label for header + page title.
  abbreviation: string | null
  // v1.75.0 — League details fields. All threaded straight from the
  // `getLeagueSettings` Prisma row. Defaults are guaranteed by the
  // schema migration; the LeagueDetailsEditor receives raw enum
  // strings + booleans.
  ballType: 'SOCCER' | 'FUTSAL'
  goalSize: 'FUTSAL' | 'YOUTH_SOCCER' | 'FULL_SIZE_SOCCER'
  throwInType: 'THROW_IN' | 'KICK_IN'
  goalKickType: 'THROW' | 'KICK'
  offsideRule: boolean
  backpassRule: boolean
  matchDurationMinutes: number | null
  playerFormat: number | null
  unlimitedSubstitutions: boolean
  organizerMessage: string | null
  showLeagueDetails: boolean
  // v1.93.0 — per-league ID requirement on the onboarding form.
  idRequired: boolean
  // v1.94.0 — admin-toggleable private join link.
  privateJoinLinkEnabled: boolean
  // v1.96.0 — admin-toggleable suppression of the unpaid-fee banner.
  paymentBannerEnabled: boolean
}

// JST calendar date as YYYY-MM-DD for `<input type="date">`. See lib/jst.ts.
function fmtDate(d: Date | null) {
  if (!d) return ''
  return formatJstDate(d)
}

// v1.84.0 — visibility radio labels. Order pinned to match the radio
// render order (private first, public_closed in the middle, public_open
// at the end so the most-permissive state is rightmost). Each option
// carries its own literal testid so the value appears as a grep-able
// static string in source — easier for downstream regression checks.
const VISIBILITY_OPTIONS: ReadonlyArray<{
  value: 'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN'
  label: string
  helper: string
  testId: string
}> = [
  {
    value: 'PRIVATE',
    label: 'Private',
    helper: 'Hidden from the public directory. Apply by invite link only.',
    testId: 'settings-tab-visibility-private',
  },
  {
    value: 'PUBLIC_CLOSED',
    label: 'Public — closed',
    helper: 'Listed in the directory. Direct apply works; recruiting banner stays hidden.',
    testId: 'settings-tab-visibility-public_closed',
  },
  {
    value: 'PUBLIC_OPEN',
    label: 'Public — open',
    helper: 'Listed in the directory. Recruiting banner shows on the league page.',
    testId: 'settings-tab-visibility-public_open',
  },
]
const VISIBILITY_LABELS: Record<'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN', string> = {
  PRIVATE: 'Private',
  PUBLIC_CLOSED: 'Public — closed',
  PUBLIC_OPEN: 'Public — open',
}

// v1.55.0 — internal type alias kept as `SubdomainStatus` because the
// underlying `League.subdomain` column is unchanged (column rename to
// `slug` deferred). Externally-facing copy uses "URL slug".
type SubdomainStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

interface SettingsTabProps {
  league: League
}

export default function SettingsTab({ league }: SettingsTabProps) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const [allowSelfLink, setAllowSelfLinkState] = useState<boolean>(league.allowSelfLink)
  const [allowPlayerTeamPick, setAllowPlayerTeamPickState] = useState<boolean>(
    league.allowPlayerTeamPick,
  )
  const [preseasonMode, setPreseasonModeState] = useState<boolean>(league.preseasonMode)
  const [recruiting, setRecruitingState] = useState<boolean>(league.recruiting)
  const [visibility, setVisibilityState] = useState<'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN'>(
    league.visibility,
  )
  const [savingToggle, setSavingToggle] = useState<
    'allowSelfLink' | 'allowPlayerTeamPick' | 'preseasonMode' | 'recruiting' | 'visibility' | null
  >(null)

  const [name, setName]             = useState(league.name)
  const [description, setDesc]      = useState(league.description ?? '')
  const [subdomain, setSubdomain]   = useState(league.subdomain ?? '')
  const [location, setLocation]     = useState(league.location)
  const [startDate, setStartDate]   = useState(fmtDate(league.startDate))
  const [endDate, setEndDate]       = useState(fmtDate(league.endDate))
  const [abbreviation, setAbbreviation] = useState(league.abbreviation ?? '')
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
        await Promise.all([
          updateLeagueInfo(league.id, {
            name:        name.trim(),
            description: description.trim() || null,
            subdomain:   subdomain.trim().toLowerCase() || null,
            location:    location.trim(),
            startDate:   startDate || undefined,
            endDate:     endDate || null,
          }),
          updateLeagueAbbreviation(league.id, abbreviation.trim() || null),
        ])
        toast('Settings saved')
      } catch (err: unknown) {
        toast(err instanceof Error ? err.message : 'Failed to save settings')
      }
    })
  }

  function handleStartSeason() {
    startTransition(async () => {
      await updateLeagueInfo(league.id, { startDate: formatJstDate(new Date()) })
      toast('Season started')
    })
  }

  function handleEndSeason() {
    startTransition(async () => {
      await updateLeagueInfo(league.id, { endDate: formatJstDate(new Date()) })
      toast('Season ended')
    })
  }

  // v1.60.0 — per-league self-link toggle handler. Optimistic flip with
  // rollback on rejection; same pattern as the data-source / write-mode
  // toggles above.
  async function handleAllowSelfLinkChange(value: boolean) {
    if (value === allowSelfLink) return
    setSavingToggle('allowSelfLink')
    const prev = allowSelfLink
    setAllowSelfLinkState(value)
    try {
      await setLeagueAllowSelfLink(league.id, value)
      toast(value ? 'Open self-linking enabled' : 'Open self-linking disabled')
    } catch (err) {
      setAllowSelfLinkState(prev)
      toast(err instanceof Error ? err.message : 'Failed to set self-link toggle')
    } finally {
      setSavingToggle(null)
    }
  }

  // v2.2.9 — allow-player-team-pick toggle handler. Same optimistic-flip-with-
  // rollback shape as the other toggles. Flipping ON exposes a team-picker
  // step in the onboarding form before the ID section.
  async function handleAllowPlayerTeamPickChange(value: boolean) {
    if (value === allowPlayerTeamPick) return
    setSavingToggle('allowPlayerTeamPick')
    const prev = allowPlayerTeamPick
    setAllowPlayerTeamPickState(value)
    try {
      await setLeagueAllowPlayerTeamPick(league.id, value)
      toast(value ? 'Player team picker enabled' : 'Player team picker disabled')
    } catch (err) {
      setAllowPlayerTeamPickState(prev)
      toast(err instanceof Error ? err.message : 'Failed to set team-picker toggle')
    } finally {
      setSavingToggle(null)
    }
  }

  // v1.63.0 — pre-season toggle handler. Same optimistic-flip-with-rollback
  // shape as the other toggles. Flipping ON swaps the homepage to the
  // compressed-schedule view and hides /stats.
  async function handlePreseasonModeChange(value: boolean) {
    if (value === preseasonMode) return
    setSavingToggle('preseasonMode')
    const prev = preseasonMode
    setPreseasonModeState(value)
    try {
      await setLeaguePreseasonMode(league.id, value)
      toast(value ? 'Pre-season mode enabled' : 'Pre-season mode disabled')
    } catch (err) {
      setPreseasonModeState(prev)
      toast(err instanceof Error ? err.message : 'Failed to set pre-season mode')
    } finally {
      setSavingToggle(null)
    }
  }

  // v1.63.0 — recruiting toggle handler. Surfaces the "RECRUITING NOW"
  // banner at the top of the homepage when enabled.
  async function handleRecruitingChange(value: boolean) {
    if (value === recruiting) return
    setSavingToggle('recruiting')
    const prev = recruiting
    setRecruitingState(value)
    try {
      await setLeagueRecruiting(league.id, value)
      toast(value ? 'Recruiting banner enabled' : 'Recruiting banner disabled')
    } catch (err) {
      setRecruitingState(prev)
      toast(err instanceof Error ? err.message : 'Failed to set recruiting toggle')
    } finally {
      setSavingToggle(null)
    }
  }

  // v1.84.0 — visibility radio handler. Optimistic flip with rollback on
  // server rejection; same shape as the boolean toggles above.
  async function handleVisibilityChange(value: 'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN') {
    if (value === visibility) return
    setSavingToggle('visibility')
    const prev = visibility
    setVisibilityState(value)
    try {
      await setLeagueVisibility(league.id, value)
      toast(`Visibility set to ${VISIBILITY_LABELS[value]}`)
    } catch (err) {
      setVisibilityState(prev)
      toast(err instanceof Error ? err.message : 'Failed to set visibility')
    } finally {
      setSavingToggle(null)
    }
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

        {/* Abbreviation — v1.73.0: short display label used in the header
            home button and page <title>. When empty, the header falls back
            to League.name. */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">League Abbreviation</label>
          <input
            type="text"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none focus:border-admin-border2"
            placeholder="e.g. T9L '26 春"
            maxLength={40}
            data-testid="settings-tab-abbreviation-input"
          />
          <p className="text-xs text-admin-text3">Used in the page title and header home button.</p>
        </div>

        {/* URL slug — v1.55.0 (PR 2 of admin-UI-compat-audit chain): label
            flipped from "Subdomain" to "URL slug"; URL preview flipped from
            `<slug>.t9l.me` to `/id/<slug>` (matches the v1.54.0 canonical
            tenant URL form). The underlying DB column is still
            `League.subdomain` — column rename to `slug` is deferred. */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">URL slug</label>
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
              data-testid="settings-tab-slug-input"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {subStatus === 'checking'  && <Loader2 className="w-4 h-4 text-admin-text3 animate-spin" />}
              {subStatus === 'available' && <CheckCircle className="w-4 h-4 text-admin-green" />}
              {subStatus === 'taken'     && <XCircle className="w-4 h-4 text-admin-red" />}
              {subStatus === 'invalid'   && <XCircle className="w-4 h-4 text-admin-amber" />}
            </div>
          </div>
          <p className="text-xs text-admin-text3" data-testid="settings-tab-slug-helper">
            {subStatus === 'taken'   && 'This slug is already taken'}
            {subStatus === 'invalid' && 'Lowercase letters, numbers, hyphens only. Must start/end with alphanumeric.'}
            {subStatus !== 'taken' && subStatus !== 'invalid' && (
              <>Used for the public-facing URL (<span className="font-mono text-admin-text2">/id/{subdomain || 'my-league'}</span>)</>
            )}
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

      {/* v1.60.0 — Player self-linking toggle. Per-league control over the
          legacy /assign-player open picker. Default ON preserves the
          existing flow for every league. Flip OFF to require invite-link
          redemption (`/join/[code]`) for new players in this league. */}
      <section
        data-testid="settings-tab-self-link-section"
        className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5"
      >
        <div>
          <h2 className="font-condensed font-bold text-admin-text text-lg">Player self-linking</h2>
          <p className="text-xs text-admin-text3 mt-1 leading-relaxed">
            When enabled, anyone signed in via LINE can claim an unlinked player slot from this league&apos;s roster. When disabled, only invite-link holders can claim a slot — admins generate invites from the Players tab.
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide block">
            Allow open self-linking
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="settings-tab-self-link-on"
              disabled={savingToggle !== null}
              onClick={() => handleAllowSelfLinkChange(true)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                allowSelfLink
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">On</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                LINE users can self-claim unlinked slots.
              </div>
            </button>
            <button
              type="button"
              data-testid="settings-tab-self-link-off"
              disabled={savingToggle !== null}
              onClick={() => handleAllowSelfLinkChange(false)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                !allowSelfLink
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">Off</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                Invite-only. Admin sends personal invite links.
              </div>
            </button>
          </div>
        </div>

        {savingToggle === 'allowSelfLink' && (
          <div className="text-xs text-admin-text3 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving self-linking toggle…
          </div>
        )}
      </section>

      {/* v2.2.9 — Allow players to pick their own teams. When ON, the
          onboarding form at /join/[code]/onboarding adds a team-picker
          step before the ID section. Players choose which team they want
          to join (or defer to the organizer via "balanced team — assign
          me later"). Default OFF preserves existing flow. */}
      <section
        data-testid="settings-tab-team-pick-section"
        className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5"
      >
        <div>
          <h2 className="font-condensed font-bold text-admin-text text-lg">Allow players to pick their own teams</h2>
          <p className="text-xs text-admin-text3 mt-1 leading-relaxed">
            When enabled, onboarding asks the player which team they want to join — with one card per team plus a &ldquo;balanced team&rdquo; opt-out that defers placement to you. When disabled, you assign teams as you do today.
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide block">
            Onboarding team picker
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="settings-tab-team-pick-on"
              disabled={savingToggle !== null}
              onClick={() => handleAllowPlayerTeamPickChange(true)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                allowPlayerTeamPick
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">On</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                Onboarding includes a team-picker step.
              </div>
            </button>
            <button
              type="button"
              data-testid="settings-tab-team-pick-off"
              disabled={savingToggle !== null}
              onClick={() => handleAllowPlayerTeamPickChange(false)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                !allowPlayerTeamPick
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">Off</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                Admin places players (no team-picker step).
              </div>
            </button>
          </div>
        </div>

        {savingToggle === 'allowPlayerTeamPick' && (
          <div className="text-xs text-admin-text3 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving team-picker toggle…
          </div>
        )}
      </section>

      {/* v1.63.0 — Pre-season mode. When ON, the public homepage swaps the
          NextMatchdayBanner + MatchdayAvailability + RsvpBar (the "Classic
          League Homepage") for a compact CompressedMatchdaySchedule view,
          and the /stats page is hidden (header link removed; route
          redirects to home). Default OFF preserves existing behavior. */}
      <section
        data-testid="settings-tab-preseason-section"
        className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5"
      >
        <div>
          <h2 className="font-condensed font-bold text-admin-text text-lg">Pre-season mode</h2>
          <p className="text-xs text-admin-text3 mt-1 leading-relaxed">
            Replaces the homepage matchday banner, player availability, and RSVP bar with a compressed schedule view (all matchdays at a glance). Hides the Stats page.
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide block">
            Pre-season mode
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="settings-tab-preseason-on"
              disabled={savingToggle !== null}
              onClick={() => handlePreseasonModeChange(true)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                preseasonMode
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">On</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                Compressed schedule. Stats hidden.
              </div>
            </button>
            <button
              type="button"
              data-testid="settings-tab-preseason-off"
              disabled={savingToggle !== null}
              onClick={() => handlePreseasonModeChange(false)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                !preseasonMode
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">Off</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                Classic homepage. Stats visible.
              </div>
            </button>
          </div>
        </div>

        {savingToggle === 'preseasonMode' && (
          <div className="text-xs text-admin-text3 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving pre-season toggle…
          </div>
        )}
      </section>

      {/* v1.63.0 — Recruiting toggle. When ON, surfaces a prominent
          "RECRUITING NOW" banner at the top of the public homepage.
          Independent of pre-season mode (both can be on simultaneously). */}
      <section
        data-testid="settings-tab-recruiting-section"
        className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5"
      >
        <div>
          <h2 className="font-condensed font-bold text-admin-text text-lg">Recruiting</h2>
          <p className="text-xs text-admin-text3 mt-1 leading-relaxed">
            Shows a &ldquo;RECRUITING NOW&rdquo; banner at the top of the homepage. Use during sign-up windows to invite new players.
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide block">
            Recruiting banner
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="settings-tab-recruiting-on"
              disabled={savingToggle !== null}
              onClick={() => handleRecruitingChange(true)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                recruiting
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">On</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                Banner visible at top of homepage.
              </div>
            </button>
            <button
              type="button"
              data-testid="settings-tab-recruiting-off"
              disabled={savingToggle !== null}
              onClick={() => handleRecruitingChange(false)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                !recruiting
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              <div className="text-sm font-medium">Off</div>
              <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                No recruiting banner.
              </div>
            </button>
          </div>
        </div>

        {savingToggle === 'recruiting' && (
          <div className="text-xs text-admin-text3 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving recruiting toggle…
          </div>
        )}
      </section>

      {/* v1.84.0 — League visibility radio. Three-tier control feeding the
          upcoming public directory + the existing recruitment banner gate.
          Replaces the legacy `recruiting` boolean as the canonical signal
          for the banner; the `recruiting` toggle above stays during the
          transition cycle and will be removed once every read site has
          switched over. */}
      <section
        data-testid="settings-tab-visibility-section"
        className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5"
      >
        <div>
          <h2 className="font-condensed font-bold text-admin-text text-lg">Visibility</h2>
          <p className="text-xs text-admin-text3 mt-1 leading-relaxed">
            Controls whether the league appears in the public directory and whether the
            recruiting banner auto-mounts on the league page.
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide block">
            Visibility
          </label>
          <div className="grid grid-cols-1 gap-2">
            {VISIBILITY_OPTIONS.map((opt) => {
              const selected = visibility === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={opt.testId}
                  disabled={savingToggle !== null}
                  onClick={() => handleVisibilityChange(opt.value)}
                  className={cn(
                    'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                    selected
                      ? 'border-admin-green bg-admin-green/10 text-admin-text'
                      : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
                  )}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-admin-text3 mt-0.5 leading-tight">
                    {opt.helper}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {savingToggle === 'visibility' && (
          <div className="text-xs text-admin-text3 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving visibility…
          </div>
        )}
      </section>

      {/* v1.75.5 — Combined "League details" section: absorbs player fees +
          planned roster + league rules into a single form per the v1.75.5
          consolidation. The standalone LeagueFeesEditor /
          LeaguePlannedRosterEditor components remain in the codebase
          (referenced by their own dedicated tests + dark-mode pin) but
          are no longer mounted on the admin settings page. */}
      <LeagueDetailsEditor
        leagueId={league.id}
        initialBallType={league.ballType}
        initialGoalSize={league.goalSize}
        initialThrowInType={league.throwInType}
        initialGoalKickType={league.goalKickType}
        initialOffsideRule={league.offsideRule}
        initialBackpassRule={league.backpassRule}
        initialMatchDurationMinutes={league.matchDurationMinutes}
        initialPlayerFormat={league.playerFormat}
        initialUnlimitedSubstitutions={league.unlimitedSubstitutions}
        initialOrganizerMessage={league.organizerMessage}
        initialShowLeagueDetails={league.showLeagueDetails}
        initialIdRequired={league.idRequired}
        initialPrivateJoinLinkEnabled={league.privateJoinLinkEnabled}
        leagueSubdomain={league.subdomain ?? null}
        initialPaymentBannerEnabled={league.paymentBannerEnabled}
        initialDefaultFee={league.defaultFee}
        initialPositionFees={league.positionFees}
        initialPlannedPlayersPerTeam={league.plannedPlayersPerTeam}
        initialPlannedNumberOfTeams={league.plannedNumberOfTeams}
        initialRegistrationDeadline={league.registrationDeadline}
      />

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
