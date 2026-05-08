'use client'

import { useRef, useState, useTransition } from 'react'
import { upload } from '@vercel/blob/client'

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
    if (!idFrontFile) {
      setError('Front of ID is required')
      return
    }
    if (!idBackFile) {
      setError('Back of ID is required')
      return
    }

    startTransition(async () => {
      try {
        const ts = Date.now()
        const idFrontPath = `${uploadPathPrefix}/id-front-${ts}.${extOf(idFrontFile.name)}`
        const idBackPath = `${uploadPathPrefix}/id-back-${ts}.${extOf(idBackFile.name)}`
        const picPath = picFile
          ? `${picturePathPrefix ?? uploadPathPrefix}/profile-${ts}.${extOf(picFile.name)}`
          : null

        const [front, back, pic] = await Promise.all([
          upload(idFrontPath, idFrontFile, {
            access: 'public',
            handleUploadUrl: UPLOAD_TOKEN_URL,
            contentType: idFrontFile.type || undefined,
          }),
          upload(idBackPath, idBackFile, {
            access: 'public',
            handleUploadUrl: UPLOAD_TOKEN_URL,
            contentType: idBackFile.type || undefined,
          }),
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
          idFrontUrl: front.url,
          idBackUrl: back.url,
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

  const submitDisabled = pending || !name.trim() || !email.trim() || !idFrontFile || !idBackFile

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

      <div
        className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg-high leading-relaxed"
        data-testid="registration-id-callout"
      >
        <p className="font-bold mb-1.5 text-fg-high">Why we need your ID</p>
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
