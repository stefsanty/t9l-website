'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  removePlayerProfilePicture,
  updatePlayerLeague,
  updatePlayerProfile,
  uploadPlayerProfilePicture,
} from './actions'
import {
  PROFILE_PIC_ALLOWED_TYPES,
  PROFILE_PIC_MAX_BYTES,
} from './validation'
import PositionMultiSelect from '@/components/PositionMultiSelect'
import { formatJpyFee } from '@/lib/playerFee'
import { MAX_PREFERRED_POSITIONS, type BallType } from '@/lib/positions'

/**
 * v1.83.0 — multi-league redesign.
 *
 * Pre-v1.83.0 the form was a single name + single positions[] +
 * single ballType wired to one default-league membership. Saving
 * overwrote every active league's positions[] (`actions.ts`
 * pre-rebase had a per-membership loop that wrote the same array
 * everywhere). A player who plays GK in League A and FW in League B
 * couldn't represent that.
 *
 * v1.83.0 splits the surface:
 *
 *   - `ProfileSection` — player-level: profile picture, name, ID-
 *     upload state. Saves via `updatePlayerProfile({ name })`.
 *
 *   - One `LeagueCard` per active membership — per-league:
 *     position chips (driven by the card's own ballType),
 *     idShared toggle, plus read-only badges/displays for team /
 *     application status / membership status / fee + paid /
 *     jersey number / comments. Saves via
 *     `updatePlayerLeague({ leagueId, positions, idShared })` —
 *     scoped to one PLM, no cross-league bleed.
 *
 * Each card has its own local state + Save button so the user can
 * edit one league at a time. PositionMultiSelect chip vocabulary is
 * driven by the card's own `ballType` so a soccer card shows the 12
 * soccer codes and a futsal card shows the 4 futsal codes.
 */

export interface LeagueCardData {
  leagueId: string
  leagueName: string
  leagueAbbreviation: string | null
  ballType: BallType
  applicationStatus: 'APPROVED' | 'PENDING'
  membershipStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
  teamName: string | null
  /** @deprecated Kept for backward compat. Use preferredPositions + secondaryPositions. */
  positions: string[]
  preferredPositions: string[]
  secondaryPositions: string[]
  jerseyNumber: number | null
  resolvedFeeJpy: number
  hasFeeOverride: boolean
  paidStatus: 'PAID' | 'UNPAID'
  idShared: boolean
  comments: string | null
  isDefaultLeague: boolean
}

export interface AccountPlayerFormProps {
  initialName: string
  profilePictureUrl: string | null
  pictureUrl: string | null
  /**
   * v1.62.0 — fallback picture when the user has neither a custom
   * `profilePictureUrl` nor an `assign-player`-mirrored `pictureUrl`.
   * For LINE users, this is the LINE-CDN URL from
   * `session.linePictureUrl`; for Google users, it's
   * `session.user.image`.
   */
  sessionPictureUrl: string | null
  blobConfigured: boolean
  hasUploadedId: boolean
  adminContactEmail: string
  /**
   * v1.83.0 — one entry per active PlayerLeagueMembership owned by the
   * caller. Server-sorted (default league first, APPROVED before
   * PENDING, alphabetical inside each bucket).
   */
  leagues: ReadonlyArray<LeagueCardData>
}

export default function AccountPlayerForm(props: AccountPlayerFormProps) {
  return (
    <div className="space-y-6">
      <ProfileSection {...props} />
      {props.leagues.length === 0 ? (
        <NoLeaguesNotice adminContactEmail={props.adminContactEmail} />
      ) : (
        props.leagues.map((league) => (
          <LeagueCard
            key={league.leagueId}
            league={league}
            adminContactEmail={props.adminContactEmail}
          />
        ))
      )}
    </div>
  )
}

function ProfileSection(props: AccountPlayerFormProps) {
  const router = useRouter()
  const { update: updateSession } = useSession()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(props.initialName)
  const [error, setError] = useState<string | null>(null)
  const [successAt, setSuccessAt] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [picturePending, setPicturePending] = useState(false)
  const [pictureError, setPictureError] = useState<string | null>(null)

  const displayedPicture =
    props.profilePictureUrl ?? props.pictureUrl ?? props.sessionPictureUrl

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessAt(null)
    startTransition(async () => {
      try {
        await updatePlayerProfile({ name: name.trim() })
        setSuccessAt(Date.now())
        // v1.62.0 — force a JWT refresh so session.playerName picks up
        // the new value. router.refresh() alone wouldn't help — the
        // session token is set on a server-issued cookie, and
        // useSession caches the session payload until update() is
        // called. Fire-and-forget; failures don't affect saved data.
        updateSession?.().catch(() => undefined)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  async function handlePictureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPictureError(null)

    if (
      !PROFILE_PIC_ALLOWED_TYPES.includes(
        file.type as typeof PROFILE_PIC_ALLOWED_TYPES[number],
      )
    ) {
      setPictureError('Picture must be a JPEG, PNG, or WebP image')
      return
    }
    if (file.size > PROFILE_PIC_MAX_BYTES) {
      setPictureError('Picture must be 5MB or smaller')
      return
    }

    setPicturePending(true)
    try {
      const formData = new FormData()
      formData.append('picture', file)
      await uploadPlayerProfilePicture(formData)
      router.refresh()
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setPicturePending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handlePictureRemove() {
    setPictureError(null)
    setPicturePending(true)
    try {
      await removePlayerProfilePicture()
      router.refresh()
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'Removal failed')
    } finally {
      setPicturePending(false)
    }
  }

  return (
    <section
      className="bg-card border border-border-default rounded-2xl p-5 space-y-5"
      data-testid="profile-section"
    >
      <h2 className="font-display text-sm font-black uppercase tracking-widest text-fg-mid">
        Your profile
      </h2>

      {/* Profile picture */}
      <div
        className="flex items-center gap-5"
        data-testid="profile-picture-section"
      >
        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-border-default bg-surface flex-shrink-0">
          {displayedPicture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayedPicture}
              alt="Profile"
              className="w-full h-full object-cover"
              data-testid="current-profile-picture"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-fg-mid text-2xl font-bold">
              {(name?.trim()?.[0] ?? '?').toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {!props.blobConfigured ? (
            <p className="text-sm text-fg-mid">
              Picture upload is currently unavailable. Contact{' '}
              <a
                href={`mailto:${props.adminContactEmail}`}
                className="text-electric-green hover:underline"
              >
                {props.adminContactEmail}
              </a>
              .
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <label
                  className="inline-flex items-center gap-2 cursor-pointer rounded-lg bg-electric-green text-black px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-electric-green/90 transition-colors disabled:opacity-50"
                  aria-disabled={picturePending}
                >
                  {picturePending ? 'Uploading…' : displayedPicture ? 'Replace' : 'Upload'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={PROFILE_PIC_ALLOWED_TYPES.join(',')}
                    onChange={handlePictureChange}
                    disabled={picturePending}
                    className="hidden"
                    data-testid="profile-picture-input"
                  />
                </label>
                {props.profilePictureUrl && (
                  <button
                    type="button"
                    onClick={handlePictureRemove}
                    disabled={picturePending}
                    className="rounded-lg border border-border-default bg-transparent px-3 py-2 text-xs font-bold uppercase tracking-wider text-fg-mid hover:text-fg-high hover:border-fg-mid transition-colors disabled:opacity-50"
                    data-testid="profile-picture-remove"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-fg-low text-xs mt-2">
                JPEG, PNG, or WebP — up to 5MB.
              </p>
              {pictureError && (
                <p
                  className="text-sm text-vibrant-pink mt-2"
                  role="alert"
                  data-testid="profile-picture-error"
                >
                  {pictureError}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Name (player-level — synced to User.name) */}
      <form
        onSubmit={handleNameSubmit}
        className="space-y-3 pt-3 border-t border-border-subtle"
        data-testid="account-player-form"
      >
        <label className="block">
          <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
            Name <span className="text-vibrant-pink">*</span>
          </span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Stefan S"
            className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
            data-testid="account-player-name"
          />
        </label>
        <div className="flex items-center justify-between">
          <div className="text-xs">
            {error && (
              <span className="text-vibrant-pink" role="alert" data-testid="account-player-error">
                {error}
              </span>
            )}
            {successAt && !error && (
              <span className="text-electric-green" data-testid="account-player-success">
                Saved
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            data-testid="account-player-submit"
          >
            {pending ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      {/* ID upload (player-level — User.idUploadedAt) */}
      <div
        className="pt-3 border-t border-border-subtle"
        data-testid="readonly-id-upload-section"
      >
        <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
          ID upload
        </dt>
        <dd className="text-fg-high mt-0.5 text-sm" data-testid="readonly-id-upload">
          {props.hasUploadedId ? 'Front and back uploaded' : 'Not uploaded'}
        </dd>
        <p className="text-fg-low text-xs mt-1">
          To re-upload, ask admin to reset onboarding for your account.
        </p>
      </div>
    </section>
  )
}

function NoLeaguesNotice({ adminContactEmail }: { adminContactEmail: string }) {
  return (
    <section
      className="bg-card border border-border-default rounded-2xl p-5 text-fg-mid"
      data-testid="no-leagues-notice"
    >
      <h2 className="font-display text-sm font-black uppercase tracking-widest text-fg-mid mb-2">
        Your leagues
      </h2>
      <p className="text-sm leading-relaxed">
        You're not currently rostered in any league. Once an admin
        approves your application or sends you a join link, your
        league(s) will appear here.
      </p>
      <p className="text-fg-low text-xs mt-2">
        Need a hand? Email{' '}
        <a
          href={`mailto:${adminContactEmail}`}
          className="text-electric-green hover:underline"
        >
          {adminContactEmail}
        </a>
        .
      </p>
    </section>
  )
}

interface LeagueCardProps {
  league: LeagueCardData
  adminContactEmail: string
}

function LeagueCard({ league, adminContactEmail }: LeagueCardProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [preferred, setPreferred] = useState<string[]>([...league.preferredPositions])
  const [secondary, setSecondary] = useState<string[]>([...league.secondaryPositions])
  const [idShared, setIdShared] = useState<boolean>(league.idShared)
  const [error, setError] = useState<string | null>(null)
  const [successAt, setSuccessAt] = useState<number | null>(null)

  const preferredChanged =
    preferred.length !== league.preferredPositions.length ||
    preferred.some((p, i) => p !== league.preferredPositions[i])
  const secondaryChanged =
    secondary.length !== league.secondaryPositions.length ||
    secondary.some((p, i) => p !== league.secondaryPositions[i])
  const positionsChanged = preferredChanged || secondaryChanged
  const idSharedChanged = idShared !== league.idShared
  const dirty = positionsChanged || idSharedChanged

  // When preferred changes, remove any codes from secondary that are now preferred.
  function handlePreferredChange(next: string[]) {
    const nextSet = new Set(next)
    setPreferred(next)
    setSecondary((prev) => prev.filter((c) => !nextSet.has(c)))
  }

  // Secondary picker excludes codes already in preferred.
  const preferredSet = new Set(preferred)
  const secondaryFiltered = secondary.filter((c) => !preferredSet.has(c))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    setError(null)
    setSuccessAt(null)
    startTransition(async () => {
      try {
        await updatePlayerLeague({
          leagueId: league.leagueId,
          preferredPositions: positionsChanged ? preferred : undefined,
          secondaryPositions: positionsChanged ? secondaryFiltered : undefined,
          idShared: idSharedChanged ? idShared : undefined,
        })
        setSuccessAt(Date.now())
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  const heading = league.leagueAbbreviation
    ? `${league.leagueAbbreviation} · ${league.leagueName}`
    : league.leagueName

  return (
    <section
      className="bg-card border border-border-default rounded-2xl p-5 space-y-4"
      data-testid={`league-card-${league.leagueId}`}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <h2
          className="font-display text-sm font-black uppercase tracking-widest text-fg-high"
          data-testid={`league-card-heading-${league.leagueId}`}
        >
          {heading}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {league.applicationStatus === 'PENDING' && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400"
              data-testid={`league-card-application-pending-${league.leagueId}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Application pending
            </span>
          )}
          {league.membershipStatus !== 'ACTIVE' && (
            <span
              className="inline-flex items-center rounded-full bg-fg-low/10 border border-border-default px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg-mid"
              data-testid={`league-card-membership-status-${league.leagueId}`}
            >
              {league.membershipStatus.toLowerCase()}
            </span>
          )}
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        data-testid={`league-card-form-${league.leagueId}`}
      >
        {/* Team */}
        <div>
          <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
            Team
          </dt>
          <dd
            className="text-fg-high text-sm mt-0.5"
            data-testid={`league-card-team-${league.leagueId}`}
          >
            {league.teamName ?? (
              <span className="text-fg-mid italic">
                {league.applicationStatus === 'PENDING'
                  ? 'Assigned on approval'
                  : 'Not assigned'}
              </span>
            )}
          </dd>
        </div>

        {/* Preferred positions (editable) */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="block text-fg-low text-xs uppercase tracking-wider font-bold">
              Preferred positions (up to {MAX_PREFERRED_POSITIONS})
            </span>
            <span
              className="text-fg-low text-[10px] font-bold uppercase tracking-widest"
              data-testid={`league-card-preferred-counter-${league.leagueId}`}
            >
              {preferred.length} / {MAX_PREFERRED_POSITIONS}
            </span>
          </div>
          <PositionMultiSelect
            selected={preferred}
            onChange={handlePreferredChange}
            ballType={league.ballType}
            disabled={pending}
            maxSelected={MAX_PREFERRED_POSITIONS}
            testIdPrefix={`league-card-preferred-${league.leagueId}`}
          />
          <span className="block text-fg-low text-xs mt-1.5">
            Roles you want to play. Formation assignment fills these first.
          </span>
        </div>

        {/* Secondary positions (editable) */}
        <div>
          <span className="block text-fg-low text-xs uppercase tracking-wider font-bold mb-1.5">
            Also plays
          </span>
          <PositionMultiSelect
            selected={secondaryFiltered}
            onChange={setSecondary}
            ballType={league.ballType}
            disabled={pending}
            testIdPrefix={`league-card-secondary-${league.leagueId}`}
          />
          <span className="block text-fg-low text-xs mt-1.5">
            Roles you can cover if needed. Optional.
          </span>
        </div>

        {/* Jersey number (read-only) */}
        {league.jerseyNumber !== null && (
          <div>
            <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
              Jersey number
            </dt>
            <dd
              className="text-fg-high text-sm mt-0.5"
              data-testid={`league-card-jersey-${league.leagueId}`}
            >
              #{league.jerseyNumber}
            </dd>
          </div>
        )}

        {/* Fee + paid (read-only). Hidden when fee resolves to 0 — the
            league hasn't set up fees and there's nothing meaningful to show. */}
        {league.resolvedFeeJpy > 0 && (
          <div>
            <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
              Fee
            </dt>
            <dd
              className="text-fg-high text-sm mt-0.5 flex items-center gap-2 flex-wrap"
              data-testid={`league-card-fee-${league.leagueId}`}
            >
              <span>{formatJpyFee(league.resolvedFeeJpy)}</span>
              {league.hasFeeOverride && (
                <span className="text-fg-low text-xs">(adjusted)</span>
              )}
              {league.paidStatus === 'PAID' ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-electric-green/10 border border-electric-green/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-electric-green"
                  data-testid={`league-card-paid-${league.leagueId}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-electric-green" />
                  Paid
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-vibrant-pink/10 border border-vibrant-pink/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-vibrant-pink"
                  data-testid={`league-card-unpaid-${league.leagueId}`}
                >
                  Unpaid
                </span>
              )}
            </dd>
          </div>
        )}

        {/* idShared (editable). Only meaningful when the player has
            uploaded an ID — but we still render it for consent
            transparency. */}
        <label
          className="flex items-start gap-2 cursor-pointer"
          data-testid={`league-card-id-shared-label-${league.leagueId}`}
        >
          <input
            type="checkbox"
            checked={idShared}
            onChange={(e) => setIdShared(e.target.checked)}
            disabled={pending}
            className="mt-0.5 h-4 w-4 rounded border-border-default bg-background"
            data-testid={`league-card-id-shared-${league.leagueId}`}
          />
          <span className="text-sm text-fg-mid leading-snug">
            Share my uploaded ID with this league's admins
            <span className="block text-fg-low text-xs mt-0.5">
              Used by admins for venue-booking documentation. Untoggle if
              you'd prefer this league not access your ID photos.
            </span>
          </span>
        </label>

        {/* Comments (read-only — applicant-submitted at registration time) */}
        {league.comments && (
          <div>
            <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
              Your application notes
            </dt>
            <dd
              className="text-fg-high text-sm mt-0.5 italic whitespace-pre-wrap"
              data-testid={`league-card-comments-${league.leagueId}`}
            >
              "{league.comments}"
            </dd>
            <p className="text-fg-low text-xs mt-1">
              Contact{' '}
              <a
                href={`mailto:${adminContactEmail}`}
                className="text-electric-green hover:underline"
              >
                {adminContactEmail}
              </a>{' '}
              to amend.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
          <div className="text-xs">
            {error && (
              <span
                className="text-vibrant-pink"
                role="alert"
                data-testid={`league-card-error-${league.leagueId}`}
              >
                {error}
              </span>
            )}
            {successAt && !error && (
              <span
                className="text-electric-green"
                data-testid={`league-card-success-${league.leagueId}`}
              >
                Saved
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={pending || !dirty}
            className="rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            data-testid={`league-card-submit-${league.leagueId}`}
          >
            {pending ? 'Saving…' : 'Save league'}
          </button>
        </div>
        <p className="text-fg-low text-xs">
          To change team, jersey number, or fee, contact{' '}
          <a
            href={`mailto:${adminContactEmail}`}
            className="text-electric-green hover:underline"
          >
            {adminContactEmail}
          </a>
          .
        </p>
      </form>
    </section>
  )
}
