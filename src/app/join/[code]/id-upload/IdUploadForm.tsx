'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitIdUpload, skipIdUpload } from '../actions'

/**
 * v1.35.0 (PR η) — client-side ID upload form.
 *
 * Two file inputs (front + back). Both required to submit the upload
 * path. A separate Skip button calls `skipIdUpload` directly so the
 * user can defer.
 *
 * Files travel via FormData (`submitIdUpload` is a FormData action,
 * not a typed-args action — file inputs need binary streaming, base64
 * round-trip would inflate ~33% and hit Vercel's 4.5MB body cap on
 * larger photos). Image previews via `URL.createObjectURL` for
 * verification before submit; revoked on unmount.
 */

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/heic,image/webp,image/heif,application/pdf'
const MAX_BYTES = 8 * 1024 * 1024 // 8MB per side — within Vercel Blob's per-call limit

interface Props {
  code: string
  playerId: string
}

export default function IdUploadForm({ code, playerId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [frontPreview, setFrontPreview] = useState<string | null>(null)
  const [backPreview, setBackPreview] = useState<string | null>(null)
  const [frontReady, setFrontReady] = useState(false)
  const [backReady, setBackReady] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  function handleFile(side: 'front' | 'back', file: File | null) {
    setError(null)
    if (!file) {
      side === 'front' ? setFrontReady(false) : setBackReady(false)
      side === 'front' ? setFrontPreview(null) : setBackPreview(null)
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 8MB per side.`)
      side === 'front' ? setFrontReady(false) : setBackReady(false)
      return
    }
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      side === 'front' ? setFrontPreview(url) : setBackPreview(url)
    } else {
      side === 'front' ? setFrontPreview(null) : setBackPreview(null)
    }
    side === 'front' ? setFrontReady(true) : setBackReady(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formRef.current) return
    setError(null)
    const formData = new FormData(formRef.current)
    formData.append('code', code)
    formData.append('playerId', playerId)
    startTransition(async () => {
      try {
        await submitIdUpload(formData)
        // submitIdUpload redirects on success — anything past here only
        // runs if the action returns instead of throwing/redirecting.
      } catch (err) {
        if (err && typeof err === 'object' && 'digest' in err) throw err
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    })
  }

  function handleSkip() {
    setError(null)
    startTransition(async () => {
      try {
        await skipIdUpload({ code, playerId })
      } catch (err) {
        if (err && typeof err === 'object' && 'digest' in err) throw err
        setError(err instanceof Error ? err.message : 'Skip failed')
        // Soft fallback for the rare error path: route to welcome anyway
        // so the user isn't permanently stuck.
        router.push(`/join/${code}/welcome`)
      }
    })
  }

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" data-testid="id-upload-form">
        <FileField
          name="idFront"
          label="Front of ID"
          accept={ACCEPTED_TYPES}
          preview={frontPreview}
          onChange={(f) => handleFile('front', f)}
          testid="id-upload-front"
        />
        <FileField
          name="idBack"
          label="Back of ID"
          accept={ACCEPTED_TYPES}
          preview={backPreview}
          onChange={(f) => handleFile('back', f)}
          testid="id-upload-back"
        />

        <button
          type="submit"
          disabled={pending || !frontReady || !backReady}
          className="w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          data-testid="id-upload-submit"
        >
          {pending ? 'Uploading…' : 'Upload and finish'}
        </button>

        {error && (
          <p className="text-sm text-vibrant-pink" role="alert" data-testid="id-upload-error">
            {error}
          </p>
        )}
      </form>

      <div className="mt-3 pt-3 border-t border-border-default text-center">
        <button
          type="button"
          onClick={handleSkip}
          disabled={pending}
          className="text-fg-mid text-xs underline hover:text-fg-high"
          data-testid="id-upload-skip-soft"
        >
          Skip for now — admin will collect ID later
        </button>
      </div>
    </>
  )
}

function FileField({
  name,
  label,
  accept,
  preview,
  onChange,
  testid,
}: {
  name: string
  label: string
  accept: string
  preview: string | null
  onChange: (file: File | null) => void
  testid: string
}) {
  return (
    <label className="block">
      <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
        {label} <span className="text-vibrant-pink">*</span>
      </span>
      <input
        type="file"
        name={name}
        accept={accept}
        required
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
