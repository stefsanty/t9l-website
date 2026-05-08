'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

/**
 * v1.81.0 — Reusable post-submit confirmation popup.
 *
 * Mounted on the originating page after a recruiting / onboarding
 * server-action submit succeeds. The animated SVG check is drawn via
 * stroke-dashoffset keyframes (defined in globals.css) — no animation
 * deps. Backdrop click and ESC behave as OK (close → navigate to
 * `okHref`); the tap-anywhere-to-dismiss pattern matches user expectation
 * for a one-button confirmation popup.
 *
 * Surface tokens (bg-card / border-default / electric-green / font-display
 * tracking-wider uppercase) mirror SignInLightbox + ApplyToLeagueModal so
 * the popup is visually a sibling of the existing modal family.
 */

interface Props {
  open: boolean
  title: string
  description?: string
  /** Absolute path the OK button (and ESC + backdrop) navigate to. */
  okHref: string
  /** Optional close hook. Fires on OK click, ESC, and backdrop click. */
  onClose?: () => void
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function SuccessConfirmationModal({
  open,
  title,
  description,
  okHref,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const card = cardRef.current
    if (!card) return
    const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE)
    focusables[0]?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !card) return
      const list = card.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !mounted) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-modal-title"
      data-testid="success-modal"
      className="fixed inset-0 z-[300] flex items-center justify-center px-4 sm:px-5"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        data-testid="success-modal-backdrop"
      />

      <div
        ref={cardRef}
        className="relative w-full max-w-sm bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl animate-in"
      >
        <div className="px-6 pt-7 pb-6 flex flex-col items-center text-center">
          <div
            className="success-check-ring w-16 h-16 mb-4 rounded-full bg-success/15 border-2 border-success flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              className="w-8 h-8 text-success"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                className="success-check-stroke"
                pathLength={1}
                d="M5 12.5l4.5 4.5L19 7.5"
              />
            </svg>
          </div>

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-success mb-1">
            Done
          </p>
          <h2
            id="success-modal-title"
            className="font-display text-xl font-black uppercase tracking-tight text-fg-high leading-tight"
          >
            {title}
          </h2>
          {description && (
            <p className="text-sm text-fg-mid mt-2 leading-relaxed">
              {description}
            </p>
          )}

          <Link
            href={okHref}
            replace
            scroll={false}
            onClick={() => onClose?.()}
            className="mt-5 w-full rounded-2xl bg-electric-green hover:opacity-90 active:scale-[0.98] px-5 py-3 text-black font-bold text-sm transition-all"
            data-testid="success-modal-ok"
          >
            OK
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  )
}
