'use client'

import { useRef, useState, useTransition } from 'react'
import { upload } from '@vercel/blob/client'

/**
 * v1.68.0 — shared registration fields component.
 *
 * Single-page form rendering name + position + (optional) ID front +
 * ID back + (optional) profile picture + (optional) comments. Used by
 * `/recruit/[slug]` (user-initiated registration) and
 * `/join/[code]/onboarding` (admin-invite onboarding).
 *
 * v1.71.1 — files now upload CLIENT-SIDE direct to Vercel Blob via
 * `@vercel/blob/client#upload`. The Vercel platform 4.5MB request-body
 * cap rejected oversize multipart submissions at the edge before the
 * server action could run; client-direct uploads route the bytes around
 * the function entirely.
 *
 * v1.81.0 — `requireId` gates the ID segment. Recruit / onboarding
 * pages compute `requireId = league.idRequired && !user.idUploadedAt`
 * and thread it through. When false, the ID inputs are not rendered,
 * the "Identity verification" section is omitted, and onSubmit's
 * `idFrontUrl` / `idBackUrl` are empty strings — server actions skip
 * the ID write entirely. Defaults to `true` to preserve the v1.68.0
 * behavior for any caller that hasn't been updated.
 *
 * v1.81.0 — visual layout split into labeled sections separated by
 * top-border dividers (Personal info → Identity verification → Profile
 * picture → Comments). Helpful information (why we need ID, privacy
 * note, email use) lives in surface-toned callout boxes using existing
 * design tokens — no new colors introduced.
 */

const POSITIONS: ReadonlyArray<{ value: '' | 'GK' | 'DF' | 'MF' | 'FW'; label: string }> = [
  { value: '', label: 'Prefer not to say' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

const ID_ACCEPT = 'image/jpeg,image/png,image/heic,image/webp,image/heif,application/pdf'
const ID_MAX_BYTES = 8 * 1024 * 1024
const PIC_ACCEPT = 'image/jpeg,image/png,image/webp'
const PIC_MAX_BYTES = 5 * 1024 * 1024

const UPLOAD_TOKEN_URL = '/api/blob/upload-token'

export interface RegistrationFieldsSubmit {
  name: string
  email: string
  position: '' | 'GK' | 'DF' | 'MF' | 'FW'
  /**
   * v1.81.0 — empty string when `requireId` is false (the segment is
   * not rendered and no upload happens). Server actions ignore empty
   * strings on the no-id path.
   */
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
  initialPosition?: 'GK' | 'DF' | 'MF' | 'FW' | null
  /**
   * v1.81.0 — when false, the ID segment is omitted entirely. Defaults
   * to true to preserve pre-v1.81.0 behavior for any unmigrated caller.
   * Pages should compute this as `league.idRequired && !user.idUploadedAt`
   * (idRequired off OR user already passed ID once → segment hidden).
   */
  requireId?: boolean
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
  initialPosition = null,
  requireId = true,
  submitLabel,
  uploadPathPrefix,
  picturePathPrefix,
  onSubmit,
}: RegistrationFieldsProps) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [comments, setComments] = useState(initialComments)
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>(initialPosition ?? '')
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
    if (requireId) {
      if (!idFrontFile) {
        setError('Front of ID is required')
        return
      }
      if (!idBackFile) {
        setError('Back of ID is required')
        return
      }
    }

    startTransition(async () => {
      try {
        const ts = Date.now()
        const idFrontPath = requireId && idFrontFile
          ? `${uploadPathPrefix}/id-front-${ts}.${extOf(idFrontFile.name)}`
          : null
        const idBackPath = requireId && idBackFile
          ? `${uploadPathPrefix}/id-back-${ts}.${extOf(idBackFile.name)}`
          : null
        const picPath = picFile
          ? `${picturePathPrefix ?? uploadPathPrefix}/profile-${ts}.${extOf(picFile.name)}`
          : null

        const [front, back, pic] = await Promise.all([
          idFrontPath && idFrontFile
            ? upload(idFrontPath, idFrontFile, {
                access: 'public',
                handleUploadUrl: UPLOAD_TOKEN_URL,
                contentType: idFrontFile.type || undefined,
              })
            : Promise.resolve(null),
          idBackPath && idBackFile
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

        await onSubmit({
          name: trimmed,
          email: trimmedEmail,
          position,
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
    (requireId && (!idFrontFile || !idBackFile))

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      data-testid="registration-fields"
    >
      {/* Personal info section */}
      <FormSection
        title="About you"
        testid="registration-section-about"
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

        <label className="block">
          <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
            Position
          </span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as typeof position)}
            className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
            data-testid="registration-position"
          >
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </FormSection>

      {/* v1.81.0 — Identity verification section, only when requireId is true. */}
      {requireId && (
        <FormSection
          title="Identity verification"
          testid="registration-section-id"
        >
          {/* v1.76.1 — operator-mandated copy + literal data-testid pinned by
              tests/unit/v1761_id_callout.test.ts. The Callout helper is used
              only for the secondary privacy note below; the primary "why" copy
              stays inline so the v1.76.1 wording assertions keep passing. */}
          <div
            className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg-high leading-relaxed"
            data-testid="registration-id-callout"
          >
            <p className="font-display font-bold mb-1.5 text-fg-high">Why we need your ID</p>
            <p className="text-fg-mid">
              We need these IDs to be able to book more courts. We will only ever use your ID
              to book courts in order to host more games. We require all league members to
              acknowledge this and submit their ID to join the league.
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

          <Callout variant="muted" testid="registration-id-privacy">
            <p className="font-display font-bold mb-1.5 text-fg-high">Privacy</p>
            <p className="text-fg-mid">
              Only league admins can view your ID. We never share it externally
              and you can request deletion at any time.
            </p>
          </Callout>
        </FormSection>
      )}

      {/* Profile picture section */}
      <FormSection
        title="Profile picture"
        testid="registration-section-picture"
      >
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
      </FormSection>

      {/* Comments section */}
      <FormSection
        title="Anything else"
        testid="registration-section-comments"
      >
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
      </FormSection>

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

/**
 * v1.81.0 — Section wrapper. Top-border divider + uppercase tracked
 * heading matches the public site's `font-display` aesthetic. The first
 * section in the form has `first:border-t-0 first:pt-0` so it doesn't
 * draw a stray rule above itself.
 */
function FormSection({
  title,
  testid,
  children,
}: {
  title: string
  testid: string
  children: React.ReactNode
}) {
  return (
    <section
      className="space-y-4 pt-5 border-t border-border-default first:border-t-0 first:pt-0"
      data-testid={testid}
    >
      <h2 className="text-fg-high text-xs font-display uppercase tracking-widest font-bold">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * v1.81.0 — Callout box. `info` uses the existing warning palette
 * (matches the v1.68.0 "Why we need your ID" affordance); `muted` uses
 * the surface palette for softer secondary info.
 */
function Callout({
  variant,
  testid,
  children,
}: {
  variant: 'info' | 'muted'
  testid?: string
  children: React.ReactNode
}) {
  const className =
    variant === 'info'
      ? 'rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg-high leading-relaxed'
      : 'rounded-lg border border-border-default bg-surface px-4 py-3 text-sm text-fg-high leading-relaxed'
  return (
    <div className={className} data-testid={testid}>
      {children}
    </div>
  )
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
