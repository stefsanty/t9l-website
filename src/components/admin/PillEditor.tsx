'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * v1.21.0 — Visual taxonomy alignment with the schedule-tab v3 mockup.
 *
 * Three visual shapes now coexist under PillEditor:
 *
 * 1. **Picker** (variants: date / time / datetime-local / venue) — solid bg
 *    `admin-surface2` + border `admin-border2`, optional leading lucide
 *    icon, trailing `▾` chevron. Empty state (no value) flips to a dashed
 *    border + transparent bg + green text/icon + `+` prefix. Used for
 *    date / venue / kickoff / FT cells in the admin schedule tab.
 *
 * 2. **Inline text edit** (variant: text) — pill-shaped, click-to-swap-input,
 *    Enter/blur saves, Escape cancels. v1.20.0 shape preserved exactly so
 *    PlayersTab name editing keeps its existing affordance + tap target.
 *
 * 3. **Team picker** (variant: team) — dotted-underline inline appearance,
 *    no border / no bg / no chevron. Click swaps the label for a `<select>`
 *    that fires onSave on change. The "looks like inline-text-edit but is
 *    actually a picker" pattern from the mockup's match rows.
 *
 * Save-on-change semantics for picker + team variants: every onChange fires
 * onSave if the new value differs from the committed value (the
 * `if (newValue === props.value) return` change-guard prevents spurious
 * writes). `useTransition` provides the in-flight pending dim. On save
 * failure the draft rolls back to the committed value.
 *
 * The native input pattern (label wraps a 100%-overlaid invisible
 * input/select) is what gives the platform picker on iOS Safari, Android
 * Chrome, and desktop browsers without `showPicker()` API plumbing.
 */

interface BasePillProps {
  display: React.ReactNode
  ariaLabel: string
  className?: string
  /** Renders display text in muted style — used for empty venue state. */
  muted?: boolean
  /**
   * Optional leading lucide icon. Picker variants get a sensible default
   * by variant if not supplied (calendar / clock / pin); pass `null` to
   * suppress.
   */
  icon?: ReactNode
  /**
   * Placeholder shown when `value` is empty on picker variants. Empty state
   * styling kicks in (dashed border, transparent bg, green text/icon, `+`
   * prefix). Ignored on filled state.
   */
  placeholder?: string
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
}

/**
 * v1.21.0 — team variant. Dropdown semantics, inline-text-edit appearance.
 * The match-row team labels in the schedule tab are clickable to swap
 * teams via a native `<select>`, but visually they read as dotted-underline
 * inline-text labels (no pill border, no bg, no chevron) per the mockup.
 */
interface TeamPillProps extends BasePillProps {
  variant: 'team'
  value: string
  options: ReadonlyArray<{ id: string; name: string }>
  onSave: (value: string) => Promise<void>
}

export type PillEditorProps =
  | DatePillProps
  | TimePillProps
  | DateTimePillProps
  | VenuePillProps
  | TextPillProps
  | TeamPillProps

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
        } else if (props.variant === 'team') {
          await props.onSave(newValue)
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

  const isPickerVariant =
    props.variant === 'date' ||
    props.variant === 'time' ||
    props.variant === 'datetime-local' ||
    props.variant === 'venue'

  const isEmpty = isPickerVariant && !props.value

  // Picker wrapper — used by date / time / datetime-local / venue.
  // 28px tap target (per v1.21.0 brief), with empty-state dashed border
  // when no value is set.
  const pickerWrapperClasses = cn(
    'relative inline-flex items-center justify-center gap-1.5',
    'rounded-full px-2.5 py-1 min-h-[28px]',
    'text-[11px] font-mono whitespace-nowrap',
    'border transition-colors cursor-pointer',
    isEmpty
      ? 'border-dashed border-admin-text3 bg-transparent text-admin-green hover:border-admin-green'
      : 'border-admin-border2 bg-admin-surface2 hover:border-admin-green/50',
    !isEmpty && (props.muted ? 'text-admin-text3' : 'text-admin-text'),
    pending && 'opacity-50 pointer-events-none animate-pulse',
    props.className,
  )

  // Text wrapper — v1.20.0 shape preserved (PlayersTab name pill).
  // ≥40px mobile tap target on the player name (the heaviest target in a
  // 53-row list view).
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

  // Team wrapper — inline-text-edit appearance: dotted underline, no bg,
  // no chevron. Used for match-row team picks.
  const teamWrapperClasses = cn(
    'relative inline-flex items-center justify-center',
    'border-b border-dotted border-admin-text3',
    'text-sm text-admin-text hover:text-admin-text2',
    'cursor-pointer transition-colors px-0.5',
    pending && 'opacity-50 pointer-events-none animate-pulse',
    props.className,
  )

  // Default leading icon by picker variant when none is supplied.
  const variantIcon: ReactNode = (() => {
    if (props.icon !== undefined) return props.icon
    return null
  })()

  if (props.variant === 'venue') {
    return (
      <label
        className={pickerWrapperClasses}
        data-pill-editor="venue"
      >
        {isEmpty ? (
          <span className="pointer-events-none flex items-center gap-1">
            <span aria-hidden>+</span>
            <span className="truncate max-w-[160px]">{props.placeholder ?? 'Set venue'}</span>
          </span>
        ) : (
          <>
            {variantIcon !== null && <span className="pointer-events-none shrink-0">{variantIcon}</span>}
            <span className="pointer-events-none truncate max-w-[180px]">{props.display}</span>
            <ChevronDown className="pointer-events-none w-3 h-3 shrink-0 text-admin-text3" aria-hidden />
          </>
        )}
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

  if (props.variant === 'team') {
    return (
      <label
        className={teamWrapperClasses}
        data-pill-editor="team"
      >
        <span className="pointer-events-none truncate max-w-[140px]">{props.display}</span>
        <select
          data-team-select
          value={draft}
          disabled={pending}
          onChange={(e) => handleChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={props.ariaLabel}
        >
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

  // date / time / datetime-local picker
  return (
    <label
      className={pickerWrapperClasses}
      data-pill-editor={props.variant}
    >
      {isEmpty ? (
        <span className="pointer-events-none flex items-center gap-1">
          <span aria-hidden>+</span>
          <span className="truncate">{props.placeholder ?? 'Set'}</span>
        </span>
      ) : (
        <>
          {variantIcon !== null && <span className="pointer-events-none shrink-0">{variantIcon}</span>}
          <span className="pointer-events-none whitespace-nowrap">{props.display}</span>
          <ChevronDown className="pointer-events-none w-3 h-3 shrink-0 text-admin-text3" aria-hidden />
        </>
      )}
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
