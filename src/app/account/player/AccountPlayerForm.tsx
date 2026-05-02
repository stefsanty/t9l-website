'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  PROFILE_PIC_ALLOWED_TYPES,
  PROFILE_PIC_MAX_BYTES,
  removePlayerProfilePicture,
  updatePlayerSelf,
  uploadPlayerProfilePicture,
} from './actions'

/**
 * v1.37.0 (PR ι) — client form for "Change player details".
 *
 * Two save flows:
 *   - The text/select form (name + position + preferences) submits
 *     through `updatePlayerSelf`, returning to the same page on success
 *     with a green status pill.
 *   - The picture upload runs through `uploadPlayerProfilePicture`
 *     independently — uploading is a side flow with its own progress UI.
 *
 * Read-only blocks at the bottom:
 *   - Team assignment ("set by admin — contact …")
 *   - ID front/back ("ask admin to reset onboarding to re-upload")
 *
 * Mirror of OnboardingForm's field shape so users see the same
 * controls when re-editing what they entered during /join/[code].
 */

const POSITIONS: ReadonlyArray<{ value: '' | 'GK' | 'DF' | 'MF' | 'FW'; label: string }> = [
  { value: '',   label: 'Prefer not to say' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

export interface AccountPlayerFormProps {
  initialName: string
  initialPosition: 'GK' | 'DF' | 'MF' | 'FW' | null
  initialPreferredLeagueTeamId: string | null
  initialPreferredTeammateIds: string[]
  initialPreferredTeammatesFreeText: string | null
  profilePictureUrl: string | null
  pictureUrl: string | null
  leagueTeams: Array<{ id: string; name: string }>
  teammateOptions: Array<{ id: string; name: string }>
  blobConfigured: boolean
  currentTeamName: string | null
  currentLeagueName: string | null
  hasUploadedId: boolean
  adminContactEmail: string
}

export default function AccountPlayerForm(props: AccountPlayerFormProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(props.initialName)
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>(
    props.initialPosition ?? '',
  )
  const [preferredLeagueTeamId, setPreferredLeagueTeamId] = useState(
    props.initialPreferredLeagueTeamId ?? '',
  )
  const [preferredTeammateIds, setPreferredTeammateIds] = useState<string[]>(
    props.initialPreferredTeammateIds,
  )
  const [preferredTeammatesFreeText, setPreferredTeammatesFreeText] = useState(
    props.initialPreferredTeammatesFreeText ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [successAt, setSuccessAt] = useState<number | null>(null)

  // Picture upload is independent of the text form save flow.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [picturePending, setPicturePending] = useState(false)
  const [pictureError, setPictureError] = useState<string | null>(null)

  const displayedPicture = props.profilePictureUrl ?? props.pictureUrl

  function toggleTeammate(id: string) {
    setPreferredTeammateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessAt(null)
    startTransition(async () => {
      try {
        await updatePlayerSelf({
          name: name.trim(),
          position: position === '' ? null : position,
          preferredLeagueTeamId: preferredLeagueTeamId === '' ? null : preferredLeagueTeamId,
          preferredTeammateIds,
          preferredTeammatesFreeText:
            preferredTeammatesFreeText.trim() === '' ? null : preferredTeammatesFreeText.trim(),
        })
        setSuccessAt(Date.now())
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

    // Client-side guard mirrors the server-side validation so users
    // get instant feedback. Server is still authoritative.
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
      // Reset the input so re-selecting the same file fires onChange again.
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
    <div className="space-y-6">
      {/* Profile picture */}
      <section
        className="bg-card border border-border-default rounded-2xl p-5"
        data-testid="profile-picture-section"
      >
        <h2 className="font-display text-sm font-black uppercase tracking-widest text-fg-mid mb-4">
          Profile picture
        </h2>
        <div className="flex items-center gap-5">
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
      </section>

      {/* Editable fields */}
      <form
        onSubmit={handleSubmit}
        className="bg-card border border-border-default rounded-2xl p-5 space-y-5"
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

        <label className="block">
          <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
            Position
          </span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as typeof position)}
            className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
            data-testid="account-player-position"
          >
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
            Preferred team
          </span>
          <select
            value={preferredLeagueTeamId}
            onChange={(e) => setPreferredLeagueTeamId(e.target.value)}
            className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
            data-testid="account-player-preferred-team"
          >
            <option value="">No preference</option>
            {props.leagueTeams.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.name}</option>
            ))}
          </select>
          <p className="text-fg-low text-xs mt-1">
            Doesn't change your current team — for admin reference only.
          </p>
        </label>

        <fieldset className="space-y-2">
          <legend className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
            Preferred teammates
          </legend>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1 border border-border-default rounded-lg p-2 bg-background">
            {props.teammateOptions.length === 0 ? (
              <p className="text-fg-low text-xs italic">No other players to choose from yet.</p>
            ) : (
              props.teammateOptions.map((opt) => {
                const checked = preferredTeammateIds.includes(opt.id)
                return (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 text-sm text-fg-mid cursor-pointer"
                    data-testid={`account-player-teammate-${opt.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTeammate(opt.id)}
                    />
                    <span>{opt.name}</span>
                  </label>
                )
              })
            )}
          </div>
          <input
            type="text"
            value={preferredTeammatesFreeText}
            onChange={(e) => setPreferredTeammatesFreeText(e.target.value)}
            maxLength={500}
            placeholder="Other (someone not on the list)"
            className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
            data-testid="account-player-teammates-other"
          />
        </fieldset>

        <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
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
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {/* Read-only — set by admin */}
      <section
        className="bg-card border border-border-default rounded-2xl p-5"
        data-testid="readonly-section"
      >
        <h2 className="font-display text-sm font-black uppercase tracking-widest text-fg-mid mb-4">
          Set by admin
        </h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
              Team assignment
            </dt>
            <dd className="text-fg-high mt-0.5" data-testid="readonly-team">
              {props.currentTeamName ? (
                <>
                  <span>{props.currentTeamName}</span>
                  {props.currentLeagueName && (
                    <span className="text-fg-mid"> — {props.currentLeagueName}</span>
                  )}
                </>
              ) : (
                <span className="text-fg-mid italic">No active assignment</span>
              )}
            </dd>
            <p className="text-fg-low text-xs mt-1">
              To change teams, contact{' '}
              <a
                href={`mailto:${props.adminContactEmail}`}
                className="text-electric-green hover:underline"
              >
                {props.adminContactEmail}
              </a>
              .
            </p>
          </div>

          <div>
            <dt className="text-fg-low text-xs uppercase tracking-wider font-bold">
              ID upload
            </dt>
            <dd className="text-fg-high mt-0.5" data-testid="readonly-id-upload">
              {props.hasUploadedId ? 'Front and back uploaded' : 'Not uploaded'}
            </dd>
            <p className="text-fg-low text-xs mt-1">
              To re-upload, ask admin to reset onboarding for your account.
            </p>
          </div>
        </dl>
      </section>
    </div>
  )
}
