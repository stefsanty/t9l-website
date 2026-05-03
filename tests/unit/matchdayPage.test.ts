/**
 * v1.45.0 (PR ε) — per-matchday public page structural pins.
 *
 * v1.47.0 — page is now a thin server component that delegates to
 * `MatchdayPageView` (client component). The bespoke per-match scoreline
 * + timeline layout is gone; the page mirrors the homepage Dashboard shape
 * (NextMatchdayBanner + UserTeamBadge + Submit-goal CTA + modal +
 * MatchdayAvailability + RsvpBar). This file pins both the route's data-
 * fetching shape AND the new view's structural composition.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { goalTypeLabel } from '@/app/matchday/[id]/page'

const ROOT = join(__dirname, '..', '..')
const PAGE_PATH = join(ROOT, 'src/app/matchday/[id]/page.tsx')
const VIEW_PATH = join(ROOT, 'src/app/matchday/[id]/MatchdayPageView.tsx')
const CARD_PATH = join(ROOT, 'src/components/MatchdayCard.tsx')
const FORM_PATH = join(ROOT, 'src/components/matchday/SubmitGoalForm.tsx')
const BANNER_PATH = join(ROOT, 'src/components/NextMatchdayBanner.tsx')

describe('PR ε / v1.47.0 page — file shape', () => {
  it('the route file exists', () => {
    expect(existsSync(PAGE_PATH)).toBe(true)
  })

  it('the new MatchdayPageView client component exists', () => {
    expect(existsSync(VIEW_PATH)).toBe(true)
  })

  const PAGE = readFileSync(PAGE_PATH, 'utf-8')

  it('uses getLeagueIdFromRequest for subdomain awareness', () => {
    expect(PAGE).toMatch(/getLeagueIdFromRequest/)
    expect(PAGE).toMatch(/getPublicLeagueData/)
  })

  it('404s when the matchday is not in the resolved league', () => {
    expect(PAGE).toMatch(/notFound/)
  })

  it('evaluates the PR ζ self-report gate server-side', () => {
    expect(PAGE).toMatch(/selfReportGateOpen/)
    expect(PAGE).toMatch(/getServerSession/)
    expect(PAGE).toMatch(/prisma\.gameWeek\.findFirst/)
  })

  it('hands the resolved data to MatchdayPageView', () => {
    expect(PAGE).toMatch(/import MatchdayPageView from/)
    expect(PAGE).toMatch(/<MatchdayPageView[\s\S]*matchdayId=/)
  })

  it('uses getPublicLeagueData NOT getLeagueStats (events-derived per PR δ)', () => {
    expect(PAGE).not.toMatch(/getLeagueStats/)
  })
})

describe('v1.47.0 MatchdayPageView — homepage-mirrored structure', () => {
  const VIEW = readFileSync(VIEW_PATH, 'utf-8')

  it("declares 'use client'", () => {
    expect(VIEW.split('\n')[0].trim().replace(/['"]/g, '')).toBe('use client')
  })

  it('renders the same homepage components — NextMatchdayBanner, MatchdayAvailability, RsvpBar, UserTeamBadge, GuestLoginBanner, Header', () => {
    expect(VIEW).toMatch(/from '@\/components\/NextMatchdayBanner'/)
    expect(VIEW).toMatch(/from '@\/components\/MatchdayAvailability'/)
    expect(VIEW).toMatch(/from '@\/components\/RsvpBar'/)
    expect(VIEW).toMatch(/from '@\/components\/UserTeamBadge'/)
    expect(VIEW).toMatch(/from '@\/components\/GuestLoginBanner'/)
    expect(VIEW).toMatch(/from '@\/components\/Header'/)
  })

  it('mounts NextMatchdayBanner with lockToSelected so URL drives the selection', () => {
    expect(VIEW).toMatch(/<NextMatchdayBanner[\s\S]*lockToSelected/)
  })

  it('routes banner navigation via router.push (URL is canonical)', () => {
    expect(VIEW).toMatch(/router\.push\(`\/matchday\/\$\{/)
  })

  it('mounts SubmitGoalForm only when selfReportGateOpen && myPlayer', () => {
    expect(VIEW).toMatch(/from '@\/components\/matchday\/SubmitGoalForm'/)
    expect(VIEW).toMatch(/selfReportGateOpen && myPlayer[\s\S]*<SubmitGoalForm/)
  })

  it('keeps the back-to-schedule affordance', () => {
    expect(VIEW).toMatch(/data-testid="matchday-back"/)
    expect(VIEW).toMatch(/href="\/schedule"/)
  })

  it('preserves the homepage RSVP-bar gating logic (showRsvpBar derived the same way)', () => {
    expect(VIEW).toMatch(/showRsvpBar/)
    expect(VIEW).toMatch(/userTeamIsPlaying/)
  })
})

describe('v1.47.0 NextMatchdayBanner.lockToSelected', () => {
  const BANNER = readFileSync(BANNER_PATH, 'utf-8')

  it('exposes lockToSelected prop with default false', () => {
    expect(BANNER).toMatch(/lockToSelected\?:\s*boolean/)
    expect(BANNER).toMatch(/lockToSelected\s*=\s*false/)
  })

  it('skips the auto-default useEffect when lockToSelected is true', () => {
    // Regression target: removing the early-return would let the homepage's
    // "auto-default to user's next playing matchday" useEffect clobber the
    // matchday page's URL-driven selection.
    expect(BANNER).toMatch(/if\s*\(\s*lockToSelected\s*\)\s*return/)
  })

  it('threads lockToSelected through useEffect deps (so it re-runs when the prop changes)', () => {
    expect(BANNER).toMatch(/\[lockToSelected,/)
  })
})

describe('v1.47.0 SubmitGoalForm — modal-based CTA', () => {
  const FORM = readFileSync(FORM_PATH, 'utf-8')

  it('big CTA button rendered in place (not inline expand)', () => {
    expect(FORM).toMatch(/data-testid="submit-goal-cta"/)
    expect(FORM).toMatch(/⚽️ Submit a goal/)
  })

  it('uses createPortal so the modal escapes parent stacking context', () => {
    expect(FORM).toMatch(/createPortal/)
    expect(FORM).toMatch(/from 'react-dom'/)
  })

  it('modal has role="dialog" + aria-modal="true" for screen readers', () => {
    expect(FORM).toMatch(/role="dialog"/)
    expect(FORM).toMatch(/aria-modal="true"/)
  })

  it('ESC closes the modal', () => {
    expect(FORM).toMatch(/e\.key === 'Escape'/)
  })

  it('backdrop click closes the modal', () => {
    expect(FORM).toMatch(/data-testid="submit-goal-modal-backdrop"/)
  })

  it('locks body scroll while the modal is open', () => {
    expect(FORM).toMatch(/document\.body\.style\.overflow = 'hidden'/)
  })

  it('exposes the form testids the e2e specs key off', () => {
    expect(FORM).toContain('data-testid="submit-goal-form"')
    expect(FORM).toContain('data-testid="submit-goal-match"')
    expect(FORM).toContain('data-testid="submit-goal-type"')
    expect(FORM).toContain('data-testid="submit-goal-assister"')
    expect(FORM).toContain('data-testid="submit-goal-minute"')
    expect(FORM).toContain('data-testid="submit-goal-submit"')
    expect(FORM).toContain('data-testid="submit-goal-cancel"')
    expect(FORM).toContain('data-testid="submit-goal-close"')
  })

  it('still calls submitOwnMatchEvent (the PR ζ server action contract)', () => {
    expect(FORM).toMatch(/submitOwnMatchEvent\(/)
  })
})

describe('PR ε MatchdayCard wiring (unchanged in v1.47.0)', () => {
  const CARD = readFileSync(CARD_PATH, 'utf-8')

  it('wires the "View matchday" link to /matchday/<id>', () => {
    expect(CARD).toMatch(/href=\{`\/matchday\/\$\{matchday\.id\}`\}/)
    expect(CARD).toMatch(/data-testid=\{`matchday-card-view-\$\{matchday\.id\}`\}/)
  })

  it('still renders the legacy "See full schedule" link when showScheduleLink is true', () => {
    expect(CARD).toMatch(/showScheduleLink/)
    expect(CARD).toMatch(/href="\/schedule"/)
  })
})

describe('goalTypeLabel (export preserved for backward compat)', () => {
  it('returns null for OPEN_PLAY (no decoration)', () => {
    expect(goalTypeLabel('OPEN_PLAY')).toBeNull()
  })

  it('returns "set piece" for SET_PIECE', () => {
    expect(goalTypeLabel('SET_PIECE')).toBe('set piece')
  })

  it('returns "pen" for PENALTY', () => {
    expect(goalTypeLabel('PENALTY')).toBe('pen')
  })

  it('returns "OG" for OWN_GOAL', () => {
    expect(goalTypeLabel('OWN_GOAL')).toBe('OG')
  })

  it('returns null for null/undefined goalType (Sheets path / pre-δ data)', () => {
    expect(goalTypeLabel(null)).toBeNull()
    expect(goalTypeLabel(undefined)).toBeNull()
  })
})
