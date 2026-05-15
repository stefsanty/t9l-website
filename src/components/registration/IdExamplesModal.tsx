'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * v2.2.12 — Accepted-ID examples popup for the onboarding ID callout.
 *
 * Visual sibling of SuccessConfirmationModal: portaled dialog with a
 * dark backdrop, ESC + backdrop dismiss, body-scroll lock, basic focus
 * trap. Text-only (no ID imagery) — purpose is to enumerate which
 * Japan-resident IDs T9L accepts and to spell out which fields must be
 * legible.
 */

interface Props {
  open: boolean
  onClose: () => void
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function IdExamplesModal({ open, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
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
    const list = card.querySelectorAll<HTMLElement>(FOCUSABLE)
    list[0]?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !card) return
      const items = card.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
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
      aria-labelledby="id-examples-modal-title"
      data-testid="id-examples-modal"
      className="fixed inset-0 z-[300] flex items-center justify-center px-4 sm:px-5"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        data-testid="id-examples-modal-backdrop"
      />

      <div
        ref={cardRef}
        className="relative w-full max-w-md bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="px-6 pt-6 pb-5">
          <h2
            id="id-examples-modal-title"
            className="font-display text-xl font-black uppercase tracking-tight text-fg-high leading-tight mb-3"
          >
            Accepted IDs
          </h2>

          <ul className="space-y-2 text-sm text-fg-mid mb-4">
            <li className="flex gap-2">
              <span className="text-fg-low">•</span>
              <span>Driving license</span>
            </li>
            <li className="flex gap-2">
              <span className="text-fg-low">•</span>
              <span>Zairyu card (在留カード) — residence card for foreign residents</span>
            </li>
            <li className="flex gap-2">
              <span className="text-fg-low">•</span>
              <span>Residence card / juminhyo (住民票) equivalent</span>
            </li>
          </ul>

          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-fg-mid leading-relaxed">
            Only your <strong className="text-fg-high">name</strong>,{' '}
            <strong className="text-fg-high">current address</strong>, and{' '}
            <strong className="text-fg-high">expiry date</strong> need to be
            clearly visible. You may censor or cover any other sensitive data
            on the ID.
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-2xl bg-electric-green hover:opacity-90 active:scale-[0.98] px-5 py-3 text-black font-bold text-sm transition-all"
            data-testid="id-examples-modal-close"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
