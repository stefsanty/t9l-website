'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * v1.21.0 — Kebab overflow menu for admin schedule rows.
 *
 * Replaces the inline trash icon with a `⋯` kebab that opens a contextual
 * action menu. Decouples the match status from the score editor — admins
 * can mark a match Complete (without entering a score), Cancel, Postpone,
 * or Delete from one place.
 *
 * Click-outside dismissal mirrors the existing `ConfirmDialog` pattern
 * (simple useState + ref + outside-click listener); deliberately avoids
 * pulling in a new Radix dependency for one menu surface.
 *
 * v1.80.11 — Portal-based positioning: menu is rendered to `document.body`
 * via `createPortal` so it escapes `overflow-hidden` table/card wrappers.
 */

export interface OverflowMenuItem {
  label: string
  onSelect: () => void | Promise<void>
  /** Tone of the menu item — `danger` renders red, default is neutral. */
  tone?: 'default' | 'danger'
  /** Disabled items render dim and don't fire onSelect. */
  disabled?: boolean
}

interface MatchOverflowMenuProps {
  items: OverflowMenuItem[]
  ariaLabel?: string
}

export default function MatchOverflowMenu({ items, ariaLabel = 'More actions' }: MatchOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (buttonRef.current?.contains(e.target as Node)) return
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function handleToggle() {
    if (open) {
      setOpen(false)
      return
    }
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
    setOpen(true)
  }

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
            className="fixed z-50 min-w-[160px] rounded-lg border border-admin-border bg-admin-surface shadow-xl overflow-hidden"
          >
            {items.map((item, idx) => (
              <button
                key={idx}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={async () => {
                  if (item.disabled) return
                  setOpen(false)
                  await item.onSelect()
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  item.tone === 'danger'
                    ? 'text-admin-red hover:bg-admin-red-dim'
                    : 'text-admin-text2 hover:bg-admin-surface2 hover:text-admin-text',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <div className="relative inline-flex" data-overflow-menu>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center justify-center w-8 h-8 rounded text-admin-text3 hover:text-admin-text2 hover:bg-admin-surface3 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {menu}
    </div>
  )
}
