'use client'

/**
 * v2.2.9 — onboarding team-picker section.
 *
 * Renders a stack of selectable cards: one per team in the league, plus a
 * trailing "Put me in a balanced team" card that opts out of picking a
 * team. Mounted by `OnboardingForm` when the league has
 * `allowPlayerTeamPick === true`. The parent owns the selection state
 * (`value` / `onChange`) — `null` represents "balanced".
 *
 * Display:
 *   - Team name + colour swatch / logo header
 *   - Member list under each team: `{position-pill} {name}`, capped at
 *     12 rows with a "+N more" tail so a 30-player team stays readable
 *     on mobile.
 *
 * Selection visual reuses the same vocabulary as the admin SettingsTab
 * toggles (border + tint on selection). The selected state is the
 * single source of truth for submit validity — the form blocks submit
 * when nothing is chosen.
 */

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { positionPillColor } from '@/lib/positions'
import type { TeamPickerOption } from '@/lib/onboarding-team-options'

const MAX_VISIBLE_MEMBERS = 12

interface Props {
  options: ReadonlyArray<TeamPickerOption>
  /**
   * `string` = a leagueTeamId is selected; `null` = the balanced opt-out
   * card is selected; `undefined` = nothing picked yet.
   */
  value: string | null | undefined
  /** Called with the leagueTeamId, or `null` for the balanced option. */
  onChange: (next: string | null) => void
  /** When true (form mid-submit), buttons go disabled. */
  disabled?: boolean
}

export default function TeamPickerSection({
  options,
  value,
  onChange,
  disabled = false,
}: Props) {
  const groupId = useId()

  return (
    <section
      className="space-y-3"
      data-testid="onboarding-team-picker"
      aria-labelledby={`${groupId}-label`}
    >
      {/* v2.2.12 — promoted to <h2> with canonical display typography
          so the team picker matches the About you / Positions / Share
          Your ID hierarchy. */}
      <h2
        id={`${groupId}-label`}
        className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight"
      >
        Choose your team <span className="text-vibrant-pink">*</span>
      </h2>
      <p className="text-fg-low text-xs mt-0.5 mb-3">
        Please choose the team you want to join. If you&apos;d rather let the organizer place you on a balanced team, choose the last option.
      </p>

      {/* v2.2.13 — 2-col at all breakpoints; v2.2.12 had grid-cols-1 on
          mobile which wasted vertical space on small viewports. */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const selected = value === opt.leagueTeamId
          const visibleMembers = opt.members.slice(0, MAX_VISIBLE_MEMBERS)
          const overflowCount = opt.members.length - visibleMembers.length
          return (
            <button
              type="button"
              key={opt.leagueTeamId}
              data-testid={`onboarding-team-card-${opt.leagueTeamId}`}
              disabled={disabled}
              onClick={() => onChange(opt.leagueTeamId)}
              aria-pressed={selected}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
                selected
                  ? 'border-vibrant-pink bg-vibrant-pink/10 text-fg-high'
                  : 'border-border-default bg-surface text-fg-mid hover:border-border-strong hover:text-fg-high',
              )}
            >
              <div className="flex items-center gap-2.5 mb-2">
                {opt.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={opt.logoUrl}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover bg-background"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="w-7 h-7 rounded-full border border-border-default"
                    style={opt.color ? { backgroundColor: opt.color } : undefined}
                  />
                )}
                <span className="font-bold text-sm">{opt.teamName}</span>
              </div>

              {opt.members.length === 0 ? (
                <div className="text-xs text-fg-low italic">
                  No members yet — be the first.
                </div>
              ) : (
                <>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-fg-low mb-1">
                    Current players:
                  </div>
                  <ul className="space-y-1">
                  {visibleMembers.map((m) => (
                    <li
                      key={m.playerId}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className={cn(
                          'inline-block min-w-[2rem] text-center px-1.5 py-0.5 rounded font-mono font-bold text-[10px]',
                          positionPillColor(m.primaryPosition ?? ''),
                        )}
                      >
                        {m.primaryPosition || '—'}
                      </span>
                      <span className="text-fg-mid">{m.name}</span>
                    </li>
                  ))}
                  {overflowCount > 0 && (
                    <li className="text-xs text-fg-low">
                      +{overflowCount} more
                    </li>
                  )}
                  </ul>
                </>
              )}
            </button>
          )
        })}

        {/* Balanced-team opt-out card. v2.2.9 — null value sentinel. */}
        <button
          type="button"
          data-testid="onboarding-team-card-balanced"
          disabled={disabled}
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={cn(
            'rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors disabled:opacity-50',
            value === null
              ? 'border-vibrant-pink bg-vibrant-pink/10 text-fg-high'
              : 'border-border-default bg-surface text-fg-mid hover:border-border-strong hover:text-fg-high',
          )}
        >
          <div className="font-bold text-sm mb-1">
            Put me in a balanced team
          </div>
          <div className="text-xs text-fg-low leading-tight">
            Let the organizer assign me — I&apos;ll play wherever I&apos;m needed.
          </div>
        </button>
      </div>
    </section>
  )
}
