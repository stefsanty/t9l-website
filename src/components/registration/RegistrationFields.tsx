'use client'

import { useRef, useState, useTransition } from 'react'
import { upload } from '@vercel/blob/client'
import PositionMultiSelect from '@/components/PositionMultiSelect'
import { MAX_PREFERRED_POSITIONS, type BallType } from '@/lib/positions'

/**
 * v1.68.0 — shared registration fields component.
 *
 * Single-page form rendering name + position + ID front + ID back +
 * (optional) profile picture. Used by both `/recruit/[slug]` (user-
 * initiated registration) and `/join/[code]/onboarding` (admin-invite
 * onboarding).
 *
 * v1.71.1 — files now upload CLIENT-SIDE direct to Vercel Blob via
 * `@vercel/blob/client#upload`. Pre-v1.71.1 the form built FormData
 * and the server action ran `put` server-side. Vercel's edge layer
 * enforces a ~4.5MB request-body cap on serverless functions and
 * rejected any large submission with HTTP 413 BEFORE the function
 * could run, regardless of `experimental.serverActions.bodySizeLimit`.
 * v1.71.1 routes the bytes around the function entirely: the browser
 * PUTs each file straight to Blob storage; only the resulting URLs
 * (a few KB) reach the parent's `onSubmit`. Field validity gates,
 * file-size guards, and the previews are unchanged.
 *
 * v1.82.0 — single-select position dropdown replaced with the
 * multi-select chip picker. Vocabulary keys off `ballType` so futsal
 * leagues see GK/FIXO/ALA/PIVOT and soccer leagues see the 12-code
 * set (GK + LB/CB/RB + LM/DM/CM/CAM/RM + LW/ST/RW). Optional —
 * empty selection is allowed (matches the legacy "Prefer not to say"
 * default).
 */

const ID_ACCEPT = 'image/jpeg,image/png,image/heic,image/webp,image/heif,application/pdf'
const ID_MAX_BYTES = 8 * 1024 * 1024
const PIC_ACCEPT = 'image/jpeg,image/png,image/webp'
const PIC_MAX_BYTES = 5 * 1024 * 1024

const UPLOAD_TOKEN_URL = '/api/blob/upload-token'

export interface RegistrationFieldsSubmit {
  name: string
  email: string
  /**
   * v1.93.0 — preferred + secondary positions. Replaces the single
   * `positions[]` array in earlier RegistrationFieldsSubmit. Preferred
   * are capped at `MAX_PREFERRED_POSITIONS` (3) at both the UI and
   * server layers; secondary is uncapped and excludes any code already
   * in preferred (UI clamp + server `validatePreferredSecondary`).
   *
   * Empty preferred is permitted at the server level but blocked at
   * the form level — every onboarding submission must record at least
   * one preferred position.
   */
  preferredPositions: string[]
  secondaryPositions: string[]
  idFrontUrl: string
  idBackUrl: string
  profilePictureUrl: string | null
  /** v1.80.0 — optional free-text comments for the admin. */
  comments: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_MAX_LENGTH = 254

export interface RegistrationFieldsProps {
  /** Initial name — for invite mode the bound Player's name; for recruit mode empty. */
  initialName?: string
  /**
   * Initial email — when the calling user has a verified email (Google
   * OAuth or magic-link), the page passes it here so the field is
   * pre-filled. LINE-only users see an empty field. v1.78.0.
   */
  initialEmail?: string
  /** v1.80.0 — initial comments (empty for new applications). */
  initialComments?: string
  /**
   * v1.82.0 — initial selected position codes. Empty by default. Codes
   * are validated against `ballType`'s vocabulary on submit (server-
   * side validation owns the final word).
   *
   * v1.93.0 — when supplied to the onboarding form, this seeds the
   * **preferred** picker (the legacy single-array memberships read
   * `positions[]`, and pre-v1.86.0 wrote everything as preferred).
   * Use the explicit `initialPreferredPositions` /
   * `initialSecondaryPositions` props when you want the v1.86.0 split.
   */
  initialPositions?: ReadonlyArray<string>
  /** v1.93.0 — explicit preferred seed (overrides `initialPositions`). */
  initialPreferredPositions?: ReadonlyArray<string>
  /** v1.93.0 — explicit secondary seed. */
  initialSecondaryPositions?: ReadonlyArray<string>
  /**
   * v1.82.0 — league format. Drives the position chip vocabulary.
   * Defaults to SOCCER for legacy callers; the recruit/onboarding/
   * apply paths thread the league's actual ballType through.
   */
  ballType?: BallType | null
  /**
   * v1.93.0 — when false, hides the ID front/back upload fields and
   * the "Share Your ID" callout, and skips the front/back required-
   * gate at submit time. The server-side gate still owns the final word
   * (re-checks `league.idRequired` to defend against a forged false).
   * Defaults to `true` so existing callers continue to require ID.
   */
  idRequired?: boolean
  /** Submit button label, e.g. "Apply to T9L" or "Save and finish". */
  submitLabel: string
  /**
   * Pathname prefix for ID uploads (and for the picture if no
   * `picturePathPrefix` override). Examples:
   *   register-pending/<userId>   (for /recruit/[slug])
   *   player-id/<playerId>        (for /join/[code]/onboarding ID files)
   */
  uploadPathPrefix: string
  /**
   * Optional override for the profile-picture upload prefix. Used by
   * the join flow to land the picture at `player-profile/<playerId>`
   * (the route handler accepts that as a valid PIC pathname).
   */
  picturePathPrefix?: string
  /**
   * Async submit handler. Receives the URLs produced by the client-
   * direct Blob uploads + the form fields. Should throw on failure
   * (component surfaces err.message); on success the parent typically
   * navigates away.
   */
  onSubmit: (input: RegistrationFieldsSubmit) => Promise<void>
}

export default function RegistrationFields({
  initialName = '',
  initialEmail = '',
  initialComments = '',
  initialPositions = [],
  initialPreferredPositions,
  initialSecondaryPositions,
  ballType = null,
  idRequired = true,
  submitLabel,
  uploadPathPrefix,
  picturePathPrefix,
  onSubmit,
}: RegistrationFieldsProps) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [comments, setComments] = useState(initialComments)
  // v1.93.0 — preferred + secondary split. When the explicit-prefer
  // props are supplied, they win (v1.86.0 multi-league split path);
  // otherwise `initialPositions[]` seeds preferred (legacy single-array
  // PLMs from before v1.86.0's dual-write).
  const [preferredPositions, setPreferredPositions] = useState<string[]>(
    initialPreferredPositions ? [...initialPreferredPositions] : [...initialPositions],
  )
  const [secondaryPositions, setSecondaryPositions] = useState<string[]>(
    initialSecondaryPositions ? [...initialSecondaryPositions] : [],
  )
  const [error, setError] = useState<string | null>(null)

  const idFrontRef = useRef<HTMLInputElement>(null)
  const idBackRef = useRef<HTMLInputElement>(null)
  const picRef = useRef<HTMLInputElement>(null)

  const [idFrontFile, setIdFrontFile] = useState<File | null>(null)
  const [idBackFile, setIdBackFile] = useState<File | null>(null)
  const [picFile, setPicFile] = useState<File | null>(null)

  const [idFrontPreview, setIdFrontPreview] = useState<string | null>(null)
  const [idBackPreview, setIdBackPreview] = useState<string | null>(null)
  const [picPreview, setPicPreview] = useState<string | null>(null)

  function handleFileChange(
    file: File | null,
    setFile: (f: File | null) => void,
    setPreview: (p: string | null) => void,
    maxBytes: number,
    label: string,
  ) {
    setError(null)
    if (!file) {
      setFile(null)
      setPreview(null)
      return
    }
    if (file.size > maxBytes) {
      setError(`${label} too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${maxBytes / 1024 / 1024}MB.`)
      setFile(null)
      setPreview(null)
      return
    }
    setFile(file)
    if (file.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(file))
    } else {
      setPreview(null)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Your name is required')
      return
    }
    if (trimmed.length > 100) {
      setError('Name must be 100 characters or fewer')
      return
    }
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) {
      setError('Email is required')
      return
    }
    if (trimmedEmail.length > EMAIL_MAX_LENGTH) {
      setError('Email is too long')
      return
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Please enter a valid email address')
      return
    }
    // v1.93.0 — onboarding form requires at least one preferred position.
    // The server-side gate only enforces the upper-bound (≤ 3) via
    // `validatePreferredSecondary`; the lower-bound is form-level.
    if (preferredPositions.length === 0) {
      setError('Pick at least one preferred position.')
      return
    }
    if (preferredPositions.length > MAX_PREFERRED_POSITIONS) {
      setError(`Preferred positions: pick at most ${MAX_PREFERRED_POSITIONS}.`)
      return
    }
    if (idRequired && !idFrontFile) {
      setError('Front of ID is required')
      return
    }
    if (idRequired && !idBackFile) {
      setError('Back of ID is required')
      return
    }

    startTransition(async () => {
      try {
        const ts = Date.now()
        const idFrontPath = idFrontFile
          ? `${uploadPathPrefix}/id-front-${ts}.${extOf(idFrontFile.name)}`
          : null
        const idBackPath = idBackFile
          ? `${uploadPathPrefix}/id-back-${ts}.${extOf(idBackFile.name)}`
          : null
        const picPath = picFile
          ? `${picturePathPrefix ?? uploadPathPrefix}/profile-${ts}.${extOf(picFile.name)}`
          : null

        const [front, back, pic] = await Promise.all([
          idFrontFile && idFrontPath
            ? upload(idFrontPath, idFrontFile, {
                access: 'public',
                handleUploadUrl: UPLOAD_TOKEN_URL,
                contentType: idFrontFile.type || undefined,
              })
            : Promise.resolve(null),
          idBackFile && idBackPath
            ? upload(idBackPath, idBackFile, {
                access: 'public',
                handleUploadUrl: UPLOAD_TOKEN_URL,
                contentType: idBackFile.type || undefined,
              })
            : Promise.resolve(null),
          picFile && picPath
            ? upload(picPath, picFile, {
                access: 'public',
                handleUploadUrl: UPLOAD_TOKEN_URL,
                contentType: picFile.type || undefined,
              })
            : Promise.resolve(null),
        ])

        // v1.93.0 — drop any secondary code that overlaps preferred
        // before submission. The server's `validatePreferredSecondary`
        // also drops on overlap; this is the matching client-side
        // safety net (in case the picker missed a transient state).
        const preferredSet = new Set(preferredPositions)
        const filteredSecondary = secondaryPositions.filter(
          (c) => !preferredSet.has(c),
        )
        await onSubmit({
          name: trimmed,
          email: trimmedEmail,
          preferredPositions,
          secondaryPositions: filteredSecondary,
          idFrontUrl: front?.url ?? '',
          idBackUrl: back?.url ?? '',
          profilePictureUrl: pic?.url ?? null,
          comments: comments.trim(),
        })
      } catch (err) {
        if (err && typeof err === 'object' && 'digest' in err) {
          // Next.js redirect — let the framework handle it.
          throw err
        }
        setError(err instanceof Error ? err.message : 'Submit failed')
      }
    })
  }

  const submitDisabled =
    pending ||
    !name.trim() ||
    !email.trim() ||
    preferredPositions.length === 0 ||
    preferredPositions.length > MAX_PREFERRED_POSITIONS ||
    (idRequired && (!idFrontFile || !idBackFile))

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5"
      data-testid="registration-fields"
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
          data-testid="registration-name"
        />
      </label>

      <label className="block">
        <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Email <span className="text-vibrant-pink">*</span>
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={EMAIL_MAX_LENGTH}
          placeholder="you@example.com"
          className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
          data-testid="registration-email"
        />
        <span className="block text-fg-low text-xs mt-1">
          We'll use this for league notifications and to follow up on your application.
        </span>
      </label>

      <div className="block">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold">
            Preferred positions (up to {MAX_PREFERRED_POSITIONS}) <span className="text-vibrant-pink">*</span>
          </span>
          <span
            className="text-fg-low text-[10px] font-bold uppercase tracking-widest"
            data-testid="registration-preferred-counter"
          >
            {preferredPositions.length} / {MAX_PREFERRED_POSITIONS}
          </span>
        </div>
        <PositionMultiSelect
          selected={preferredPositions}
          onChange={(next) => {
            setPreferredPositions(next)
            // Drop any secondary code that the user just promoted to
            // preferred — keeps the two sets disjoint without
            // surprising the user with a stale ghost chip.
            const nextSet = new Set(next)
            setSecondaryPositions((prev) => prev.filter((c) => !nextSet.has(c)))
          }}
          ballType={ballType}
          disabled={pending}
          maxSelected={MAX_PREFERRED_POSITIONS}
          testIdPrefix="registration-preferred"
        />
        <span className="block text-fg-low text-xs mt-1.5">
          Pick at least one. Formation assignment fills these first.
        </span>
      </div>

      <div className="block">
        <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Also plays
        </span>
        <PositionMultiSelect
          selected={secondaryPositions.filter((c) => !preferredPositions.includes(c))}
          onChange={setSecondaryPositions}
          ballType={ballType}
          disabled={pending}
          testIdPrefix="registration-secondary"
        />
        <span className="block text-fg-low text-xs mt-1.5">
          Optional. Roles you can cover if needed.
        </span>
      </div>

      {idRequired && (
        <>
          {/* v2.2.9 — reworded callout. Subheader flipped to "Share Your ID"
              and body expanded to three explicit paragraphs covering
              motivation, scope, and access control (verbatim per the
              v2.2.9 brief). */}
          <div
            className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg-high leading-relaxed"
            data-testid="registration-id-callout"
          >
            <p className="font-bold mb-1.5 text-fg-high">Share Your ID</p>
            <p className="text-fg-mid mb-2">
              We require your ID strictly to enable more regular league games!
            </p>
            <p className="text-fg-mid mb-2">
              To serve you the best league experience possible, we require league members to share your ID with us in order to book more courts.
            </p>
            <p className="text-fg-mid">
              Your ID will only ever be shared to the organizers, and is secured so that no one but the organizers may access your ID.
            </p>
          </div>

          <FileField
            label="Front of ID"
            required
            accept={ID_ACCEPT}
            preview={idFrontPreview}
            inputRef={idFrontRef}
            onChange={(f) =>
              handleFileChange(f, setIdFrontFile, setIdFrontPreview, ID_MAX_BYTES, 'Front of ID')
            }
            testid="registration-id-front"
          />

          <FileField
            label="Back of ID"
            required
            accept={ID_ACCEPT}
            preview={idBackPreview}
            inputRef={idBackRef}
            onChange={(f) =>
              handleFileChange(f, setIdBackFile, setIdBackPreview, ID_MAX_BYTES, 'Back of ID')
            }
            testid="registration-id-back"
          />
        </>
      )}

      <FileField
        label="Profile picture (optional)"
        required={false}
        accept={PIC_ACCEPT}
        preview={picPreview}
        inputRef={picRef}
        onChange={(f) =>
          handleFileChange(f, setPicFile, setPicPreview, PIC_MAX_BYTES, 'Profile picture')
        }
        testid="registration-profile-picture"
      />

      <label className="block">
        <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
          Comments (optional)
        </span>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={4}
          placeholder="Anything you'd like the admin to know."
          className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high resize-y"
          data-testid="registration-comments"
        />
        <span className="block text-fg-low text-xs mt-1">
          Optional. Anything you'd like the admin to know.
        </span>
      </label>

      <button
        type="submit"
        disabled={submitDisabled}
        className="w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        data-testid="registration-submit"
      >
        {pending ? 'Submitting…' : submitLabel}
      </button>

      {error && (
        <p className="text-sm text-vibrant-pink" role="alert" data-testid="registration-error">
          {error}
        </p>
      )}
    </form>
  )
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i < 0) return 'bin'
  return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

function FileField({
  label,
  required,
  accept,
  preview,
  inputRef,
  onChange,
  testid,
}: {
  label: string
  required: boolean
  accept: string
  preview: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (file: File | null) => void
  testid: string
}) {
  return (
    <label className="block">
      <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
        {label}
        {required && <span className="text-vibrant-pink"> *</span>}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        required={required}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="w-full text-sm text-fg-high file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-surface file:text-fg-high file:cursor-pointer cursor-pointer"
        data-testid={testid}
      />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={`${label} preview`}
          className="mt-2 max-h-32 rounded-lg border border-border-default object-contain bg-background"
          data-testid={`${testid}-preview`}
        />
      )}
    </label>
  )
}
