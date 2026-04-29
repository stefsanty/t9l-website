'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

/**
 * v1.19.0 — Pill editor for the admin schedule tab.
 *
 * The matchday date / venue / kickoff cells used to be either an
 * InlineEditCell with a free-text input swap or a desktop-only `<select>`.
 * On mobile that meant the cells were either non-editable display strings
 * (date / venue) or a tiny inline input that was hard to tap. This
 * component wraps the value as a clickable pill (≥40px tap target on
 * mobile, ≥32px on desktop) with the platform-native picker overlaid as
 * an `opacity-0` input/select. The user taps the pill, the native picker
 * opens, and `onChange` fires the save.
 *
 * Save-on-change semantics: every onChange fires onSave if the new value
 * differs from the committed value. `useTransition` provides the in-flight
 * state for the pending dim. On save failure the draft rolls back to the
 * committed value.
 *
 * The native input pattern (label wraps a 100%-overlaid invisible input)
 * is what gives the picker on iOS Safari, Android Chrome, and desktop
 * browsers without `showPicker()` API plumbing.
 */

interface BasePillProps {
  display: React.ReactNode
  ariaLabel: string
  className?: string
  /** Renders display text in muted style — used for empty venue state. */
  muted?: boolean
}

interface DatePillProps extends BasePillProps {
  variant: 'date'
  value: string
  onSave: (value: string) => Promise<void>
}

interface TimePillProps extends BasePillProps {
  variant: 'time'
  value: string
  onSave: (value: string) => Promise<void>
}

interface DateTimePillProps extends BasePillProps {
  variant: 'datetime-local'
  value: string
  onSave: (value: string) => Promise<void>
}

interface VenuePillProps extends BasePillProps {
  variant: 'venue'
  value: string
  options: ReadonlyArray<{ id: string; name: string }>
  onSave: (venueId: string | null) => Promise<void>
}

/**
 * v1.20.0 — text variant for inline editing free-text fields (e.g.
 * Player.name on the admin Players tab). Unlike the date/time/venue
 * variants there is no platform-native picker, so this variant uses a
 * click-to-swap-input pattern: pill displays the value; click → input
 * appears in-place; Enter or blur saves; Escape cancels.
 *
 * Validation lives at the consumer onSave (server action throws on
 * empty / too-long; the pill catches and rolls back).
 */
interface TextPillProps extends BasePillProps {
  variant: 'text'
  value: string
  onSave: (value: string) => Promise<void>
  /** Soft client-side cap matched to the server-side validation. */
  maxLength?: number
  placeholder?: string
}

export type PillEditorProps =
  | DatePillProps
  | TimePillProps
  | DateTimePillProps
  | VenuePillProps
  | TextPillProps

export default function PillEditor(props: PillEditorProps) {
  const [draft, setDraft] = useState(props.value)
  const [pending, startTransition] = useTransition()
  // Text-variant click-to-swap-input editor state. Only used by the text
  // branch; date/time/venue use the overlaid native picker pattern and
  // never need a separate "editing" flag.
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Keep the draft in sync if the source value changes (e.g. parent
  // re-renders with a fresh server-side value after revalidatePath).
  useEffect(() => {
    if (!editing) setDraft(props.value)
  }, [props.value, editing])

  function handleChange(newValue: string) {
    setDraft(newValue)
    if (newValue === props.value) return
    startTransition(async () => {
      try {
        if (props.variant === 'venue') {
          await props.onSave(newValue || null)
        } else {
          await props.onSave(newValue)
        }
      } catch {
        setDraft(props.value)
      }
    })
  }

  function commitText() {
    setEditing(false)
    const next = draft.trim()
    if (next === props.value) {
      setDraft(props.value)
      return
    }
    startTransition(async () => {
      try {
        if (props.variant !== 'text') return
        await props.onSave(next)
      } catch {
        setDraft(props.value)
      }
    })
  }

  function cancelText() {
    setEditing(false)
    setDraft(props.value)
  }

  const wrapperClasses = cn(
    'relative inline-flex items-center justify-center gap-1.5',
    'rounded-full px-3 py-1.5 min-h-[40px] md:min-h-[28px] md:py-0.5',
    'text-xs',
    'border border-admin-border2 bg-admin-surface2',
    'hover:border-admin-green/50 transition-colors',
    'cursor-pointer',
    pending && 'opacity-50 pointer-events-none animate-pulse',
    props.muted ? 'text-admin-text3' : 'text-admin-text2',
    props.className,
  )

  if (props.variant === 'venue') {
    return (
      <label
        className={wrapperClasses}
        data-pill-editor="venue"
      >
        <span className="pointer-events-none truncate max-w-[180px]">
          {props.display}
        </span>
        <select
          data-venue-select
          value={draft}
          disabled={pending}
          onChange={(e) => handleChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={props.ariaLabel}
        >
          <option value="">—</option>
          {props.options.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </label>
    )
  }

  if (props.variant === 'text') {
    if (editing) {
      return (
        <span
          className={cn(wrapperClasses, 'p-0')}
          data-pill-editor="text"
          data-editing="true"
        >
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={draft}
            maxLength={props.maxLength ?? 100}
            placeholder={props.placeholder}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitText()
              }
              if (e.key === 'Escape') cancelText()
            }}
            aria-label={props.ariaLabel}
            className="bg-transparent outline-none border-none px-3 py-1.5 md:py-0.5 min-h-[40px] md:min-h-[28px] w-full text-admin-text text-xs"
          />
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(props.value)
          setEditing(true)
          // Focus is handled by autoFocus on the input; the timeout select
          // gives a "tap = full-text-selected" UX so re-typing is one
          // gesture instead of two.
          setTimeout(() => inputRef.current?.select(), 0)
        }}
        className={wrapperClasses}
        data-pill-editor="text"
        aria-label={props.ariaLabel}
      >
        <span className="truncate max-w-[220px]">
          {props.display}
        </span>
      </button>
    )
  }

  return (
    <label
      className={wrapperClasses}
      data-pill-editor={props.variant}
    >
      <span className="pointer-events-none whitespace-nowrap font-mono">
        {props.display}
      </span>
      <input
        type={props.variant}
        value={draft}
        disabled={pending}
        onChange={(e) => handleChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label={props.ariaLabel}
      />
    </label>
  )
}
