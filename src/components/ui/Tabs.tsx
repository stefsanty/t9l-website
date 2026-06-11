'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * v2.3.0 — shared underline-tab primitive, ported from the dev.futcal.com
 * Discover page tab style. Established as the global template for tab
 * systems on the user-facing UI. Single visual + a11y contract; every
 * future user-facing tab strip should mount this rather than rolling its
 * own.
 *
 * Visual contract (verbatim from the source HTML, t9l-tokenised):
 *   - <nav role="tablist" class="flex border-b border-border-default
 *     [sticky top-0 bg-surface z-10 when sticky]">
 *   - <button role="tab" aria-selected={active}
 *     class="px-4 py-3 text-[13px] font-semibold shrink-0 border-b-2
 *     -mb-px transition-colors {active ? 'border-accent text-accent'
 *     : 'border-transparent text-fg-mid hover:text-fg-high'}">
 *   - Optional right-aligned "More" overflow dropdown
 *     (aria-haspopup, click-outside + Esc dismissal) that hosts every tab
 *     past `moreOverflowAfter`.
 *
 * Keyboard a11y: roving focus via Left/Right (wrap-around) and Home/End.
 * Tab body swap is instant — no fade/slide — matching the source.
 *
 * Body children receive the active `activeId` and render the active
 * `<TabPanel>`; the primitive emits one `role="tabpanel"` slot wired via
 * `aria-controls` / `aria-labelledby` so screen-readers announce the
 * relationship.
 */

export interface TabDef {
  /** Stable identity used as the active key and the DOM id suffix. */
  id: string
  label: string
  /** Optional testid suffix; defaults to `${tabsTestid}-${id}`. */
  testid?: string
}

export interface TabsProps {
  tabs: ReadonlyArray<TabDef>
  activeId: string
  onChange: (id: string) => void
  ariaLabel: string
  /** Stickies the tab strip to the viewport top with bg-surface. */
  sticky?: boolean
  /**
   * When set, tabs at indices ≥ this number collapse into a "More"
   * dropdown menu at the right end of the strip. Unset = no overflow.
   */
  moreOverflowAfter?: number
  /** Extra classes applied to the `<nav>` wrapper. */
  navClassName?: string
  /** Testid stem; defaults to `tabs`. Used to derive per-tab testids. */
  testid?: string
  /**
   * Render function for the active tab's body. Wrapped by the primitive
   * in a `role="tabpanel"` div so callers don't need to manage panel ids.
   */
  children: (activeId: string) => ReactNode
}

export function Tabs({
  tabs,
  activeId,
  onChange,
  ariaLabel,
  sticky = false,
  moreOverflowAfter,
  navClassName,
  testid = 'tabs',
  children,
}: TabsProps) {
  const reactId = useId()
  const idFor = useCallback(
    (kind: 'tab' | 'panel', tabId: string) => `${testid}-${reactId}-${kind}-${tabId}`,
    [reactId, testid],
  )

  // Partition tabs: visible vs overflow. The overflow set is only present
  // when `moreOverflowAfter` is set AND the cutoff actually hides ≥ 1 tab.
  const { primaryTabs, overflowTabs } = useMemo(() => {
    if (
      moreOverflowAfter == null ||
      moreOverflowAfter < 0 ||
      tabs.length <= moreOverflowAfter
    ) {
      return { primaryTabs: tabs, overflowTabs: [] as TabDef[] }
    }
    return {
      primaryTabs: tabs.slice(0, moreOverflowAfter),
      overflowTabs: tabs.slice(moreOverflowAfter),
    }
  }, [tabs, moreOverflowAfter])

  const activeIsInOverflow = useMemo(
    () => overflowTabs.some((t) => t.id === activeId),
    [overflowTabs, activeId],
  )

  // Roving focus via arrow keys. Operates on the flat `tabs` array so
  // Right past the last primary tab opens the dropdown's first item, and
  // Left from the first primary tab wraps to the last overflow tab.
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const setTabRef = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      tabRefs.current[id] = el
    },
    [],
  )

  const focusTab = useCallback((id: string) => {
    tabRefs.current[id]?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, currentId: string) => {
      const flat = [...primaryTabs, ...overflowTabs]
      const idx = flat.findIndex((t) => t.id === currentId)
      if (idx < 0) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = flat[(idx + 1) % flat.length]
        if (next) {
          onChange(next.id)
          focusTab(next.id)
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const prev = flat[(idx - 1 + flat.length) % flat.length]
        if (prev) {
          onChange(prev.id)
          focusTab(prev.id)
        }
      } else if (e.key === 'Home') {
        e.preventDefault()
        const first = flat[0]
        if (first) {
          onChange(first.id)
          focusTab(first.id)
        }
      } else if (e.key === 'End') {
        e.preventDefault()
        const last = flat[flat.length - 1]
        if (last) {
          onChange(last.id)
          focusTab(last.id)
        }
      }
    },
    [primaryTabs, overflowTabs, onChange, focusTab],
  )

  return (
    <div data-testid={testid}>
      <nav
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          'flex border-b border-border-default',
          sticky && 'sticky top-0 bg-surface z-10',
          navClassName,
        )}
      >
        {primaryTabs.map((t) => (
          <TabButton
            key={t.id}
            tab={t}
            active={t.id === activeId}
            tabId={idFor('tab', t.id)}
            panelId={idFor('panel', t.id)}
            testid={t.testid ?? `${testid}-tab-${t.id}`}
            onSelect={() => onChange(t.id)}
            onKeyDown={(e) => handleKeyDown(e, t.id)}
            buttonRef={setTabRef(t.id)}
          />
        ))}
        {overflowTabs.length > 0 && (
          <MoreDropdown
            tabs={overflowTabs}
            activeId={activeId}
            activeIsInOverflow={activeIsInOverflow}
            idFor={idFor}
            testid={testid}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            registerRef={setTabRef}
          />
        )}
      </nav>
      {tabs.map((t) =>
        t.id === activeId ? (
          <div
            key={t.id}
            role="tabpanel"
            id={idFor('panel', t.id)}
            aria-labelledby={idFor('tab', t.id)}
            data-testid={`${testid}-panel-${t.id}`}
          >
            {children(activeId)}
          </div>
        ) : null,
      )}
    </div>
  )
}

interface TabButtonProps {
  tab: TabDef
  active: boolean
  tabId: string
  panelId: string
  testid: string
  onSelect: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  buttonRef: (el: HTMLButtonElement | null) => void
}

function TabButton({
  tab,
  active,
  tabId,
  panelId,
  testid,
  onSelect,
  onKeyDown,
  buttonRef,
}: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      ref={buttonRef}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'px-4 py-3 text-[13px] font-semibold shrink-0 border-b-2 -mb-px transition-colors',
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-fg-mid hover:text-fg-high',
      )}
    >
      {tab.label}
    </button>
  )
}

interface MoreDropdownProps {
  tabs: ReadonlyArray<TabDef>
  activeId: string
  activeIsInOverflow: boolean
  idFor: (kind: 'tab' | 'panel', tabId: string) => string
  testid: string
  onChange: (id: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, currentId: string) => void
  registerRef: (id: string) => (el: HTMLButtonElement | null) => void
}

function MoreDropdown({
  tabs,
  activeId,
  activeIsInOverflow,
  idFor,
  testid,
  onChange,
  onKeyDown,
  registerRef,
}: MoreDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Click-outside + Esc dismissal.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false)
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative ml-auto">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={`${testid}-more-trigger`}
        data-active={activeIsInOverflow ? 'true' : 'false'}
        className={cn(
          'flex items-center gap-1 px-4 py-3 text-[13px] font-semibold border-b-2 -mb-px transition-colors',
          activeIsInOverflow
            ? 'border-accent text-accent'
            : 'border-transparent text-fg-mid hover:text-fg-high',
        )}
      >
        More
        <ChevronDown
          aria-hidden
          className={cn(
            'w-3.5 h-3.5 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          role="menu"
          data-testid={`${testid}-more-menu`}
          className="absolute right-0 top-full mt-1 min-w-[160px] rounded-lg border border-border-default bg-card shadow-lg overflow-hidden z-20"
        >
          {tabs.map((t) => {
            const active = t.id === activeId
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={idFor('tab', t.id)}
                ref={registerRef(t.id)}
                aria-selected={active}
                aria-controls={idFor('panel', t.id)}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  onChange(t.id)
                  setOpen(false)
                }}
                onKeyDown={(e) => onKeyDown(e, t.id)}
                data-testid={t.testid ?? `${testid}-tab-${t.id}`}
                className={cn(
                  'w-full text-left px-4 py-2 text-[13px] font-semibold transition-colors',
                  active
                    ? 'text-accent bg-surface'
                    : 'text-fg-mid hover:text-fg-high hover:bg-surface',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
