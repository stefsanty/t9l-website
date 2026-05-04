/**
 * v1.45.0 (PR ε) — per-matchday public page structural pins.
 *
 * v1.47.0 — page delegated to a `MatchdayPageView` client component.
 *
 * v1.48.0 — homepage IS the matchday page. The page is now a thin server
 * wrapper that renders the same `Dashboard` the apex renders, with
 * `initialMatchdayId` pre-selecting the URL matchday. `MatchdayPageView`
 * is gone (deleted, no replacement). The Submit-goal CTA + modal that
 * lived inside it now live inside the Dashboard. Section headers
 * ("MATCHDAY RESULTS" etc.) are now click-to-copy via `<CopyMatchdayLink>`
 * — clicking copies `https://<host>/matchday/<id>` with a Sonner toast.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { goalTypeLabel } from '@/app/matchday/[id]/page'

const ROOT = join(__dirname, '..', '..')
const PAGE_PATH = join(ROOT, 'src/app/matchday/[id]/page.tsx')
const VIEW_PATH = join(ROOT, 'src/app/matchday/[id]/MatchdayPageView.tsx')
const DASHBOARD_PATH = join(ROOT, 'src/components/Dashboard.tsx')
const CARD_PATH = join(ROOT, 'src/components/MatchdayCard.tsx')
const FORM_PATH = join(ROOT, 'src/components/matchday/SubmitGoalForm.tsx')
const COPY_PATH = join(ROOT, 'src/components/CopyMatchdayLink.tsx')

/** Strip JS comments so docstrings that legitimately mention removed
 * symbols (e.g. "this PR deleted MatchdayPageView") don't trip negative
 * regex checks meant for production code shape. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.48.0 — page + Dashboard convergence', () => {
  it('the route file exists', () => {
    expect(existsSync(PAGE_PATH)).toBe(true)
  })

  it('MatchdayPageView is GONE — collapsed into Dashboard (regression target)', () => {
    expect(existsSync(VIEW_PATH)).toBe(false)
  })

  const PAGE = readFileSync(PAGE_PATH, 'utf-8')

  it('page uses getLeagueIdFromRequest for subdomain awareness', () => {
    expect(PAGE).toMatch(/getLeagueIdFromRequest/)
    expect(PAGE).toMatch(/getPublicLeagueData/)
  })

  it('page 404s when the matchday is not in the resolved league', () => {
    expect(PAGE).toMatch(/notFound/)
  })

  it('page renders Dashboard with initialMatchdayId pre-set to the URL matchday', () => {
    expect(PAGE).toMatch(/import Dashboard from '@\/components\/Dashboard'/)
    expect(PAGE).toMatch(/<Dashboard[\s\S]*initialMatchdayId=\{md\.id\}/)
  })

  it('page does NOT import MatchdayPageView (deleted)', () => {
    expect(stripComments(PAGE)).not.toMatch(/MatchdayPageView/)
  })

  it('page does NOT import SubmitGoalForm directly (Dashboard owns it now)', () => {
    expect(stripComments(PAGE)).not.toMatch(/SubmitGoalForm/)
  })
})

describe('v1.48.0 Dashboard — converges homepage + matchday route', () => {
  const DASHBOARD = readFileSync(DASHBOARD_PATH, 'utf-8')

  it("declares 'use client'", () => {
    expect(DASHBOARD.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('accepts initialMatchdayId? prop', () => {
    expect(DASHBOARD).toMatch(/initialMatchdayId\?:\s*string\s*\|\s*null/)
  })

  it('uses initialMatchdayId as the first-render selection (overrides nextMd default)', () => {
    expect(DASHBOARD).toMatch(/initialMatchdayId\s*\?\?\s*nextMd\?\.matchday\.id/)
  })

  it('mounts SubmitGoalForm gated by submitGateOpen', () => {
    expect(DASHBOARD).toMatch(/import SubmitGoalForm from '\.\/matchday\/SubmitGoalForm'/)
    expect(DASHBOARD).toMatch(/submitGateOpen[\s\S]*<SubmitGoalForm/)
  })

  it('evaluates the kickoff gate client-side via combineJstDateAndTime', () => {
    expect(DASHBOARD).toMatch(/from '@\/lib\/playerSelfReportGate'/)
    expect(DASHBOARD).toMatch(/from '@\/lib\/jst'/)
    expect(DASHBOARD).toMatch(/combineJstDateAndTime/)
  })

  it('passes all-roster `players` to SubmitGoalForm (open attribution)', () => {
    // The form's scorer dropdown sources from `players` prop.
    expect(DASHBOARD).toMatch(/<SubmitGoalForm[\s\S]*players=\{players\}/)
  })
})

describe('v1.48.0 SubmitGoalForm — green CTA + scorer dropdown', () => {
  const FORM = readFileSync(FORM_PATH, 'utf-8')

  it('CTA uses LINE green (#06C755), not the legacy pink', () => {
    expect(FORM).toMatch(/bg-\[#06C755\]/)
    expect(FORM).not.toMatch(/data-testid="submit-goal-cta"[\s\S]{0,200}bg-vibrant-pink/)
  })

  it('exposes a scorer dropdown (data-testid="submit-goal-scorer")', () => {
    expect(FORM).toMatch(/data-testid="submit-goal-scorer"/)
  })

  it('scorer dropdown sources from `players` prop, NOT locked to caller', () => {
    expect(FORM).toMatch(/players: Player\[\]/)
    // The match dropdown is no longer "participatingMatches" — it's "matches"
    expect(FORM).toMatch(/matches:\s*Array<\{/)
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
    expect(FORM).toContain('data-testid="submit-goal-scorer"')
    expect(FORM).toContain('data-testid="submit-goal-type"')
    expect(FORM).toContain('data-testid="submit-goal-assister"')
    expect(FORM).toContain('data-testid="submit-goal-minute"')
    expect(FORM).toContain('data-testid="submit-goal-submit"')
    expect(FORM).toContain('data-testid="submit-goal-cancel"')
    expect(FORM).toContain('data-testid="submit-goal-close"')
  })

  it('still calls submitOwnMatchEvent — passing scorerPlayerSlug from form input', () => {
    expect(FORM).toMatch(/submitOwnMatchEvent\(/)
    expect(FORM).toMatch(/scorerPlayerSlug:\s*scorerSlug/)
  })
})

describe('v1.48.0 CopyMatchdayLink — section header click-to-copy', () => {
  it('the component file exists', () => {
    expect(existsSync(COPY_PATH)).toBe(true)
  })

  const COPY = readFileSync(COPY_PATH, 'utf-8')

  it("declares 'use client'", () => {
    expect(COPY.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('uses navigator.clipboard.writeText to copy', () => {
    expect(COPY).toMatch(/navigator\.clipboard\.writeText/)
  })

  it('builds the URL from window.location.origin (apex + subdomain compatible)', () => {
    expect(COPY).toMatch(/window\.location\.origin/)
    expect(COPY).toMatch(/\/matchday\/\$\{matchdayId\}/)
  })

  it('fires a Sonner toast on success', () => {
    expect(COPY).toMatch(/from 'sonner'/)
    expect(COPY).toMatch(/toast\.success/)
  })

  it('exposes a per-matchday testid for e2e and unit specs', () => {
    expect(COPY).toMatch(/data-testid=\{`copy-matchday-link-\$\{matchdayId\}`\}/)
  })
})

describe('v1.48.0 MatchdayCard — eyebrow is CopyMatchdayLink, "View matchday" gone', () => {
  const CARD = readFileSync(CARD_PATH, 'utf-8')

  it('imports CopyMatchdayLink and renders it as the eyebrow', () => {
    expect(CARD).toMatch(/import CopyMatchdayLink from/)
    expect(CARD).toMatch(/<CopyMatchdayLink[\s\S]*matchdayId=\{matchday\.id\}/)
  })

  it('"View matchday" link is gone (regression target — homepage IS the matchday page)', () => {
    const CARD_NO_COMMENTS = stripComments(CARD)
    expect(CARD_NO_COMMENTS).not.toMatch(/data-testid=\{`matchday-card-view-/)
    expect(CARD_NO_COMMENTS).not.toMatch(/View matchday/)
  })

  it('still renders the legacy "See full schedule" link when showScheduleLink is true', () => {
    expect(CARD).toMatch(/showScheduleLink/)
    expect(CARD).toMatch(/href="\/schedule"/)
  })
})

describe('v1.48.1 — Submit-Goal CTA singleton across matchday changes', () => {
  const DASHBOARD = readFileSync(DASHBOARD_PATH, 'utf-8')
  const FORM = readFileSync(FORM_PATH, 'utf-8')

  // Regression target: pre-v1.48.1 the form had `key={selectedMatchday.id}`
  // which forced a full remount per swipe — combined with the Google Translate
  // DOM mutations in the root layout, the CTA visually duplicated on every
  // navigation. Dropping the key turns it into a singleton whose props
  // update on swipe, eliminating the spawn-on-scroll path entirely.
  it('Dashboard does NOT pass `key={selectedMatchday.id}` to SubmitGoalForm', () => {
    const noComments = stripComments(DASHBOARD)
    expect(noComments).not.toMatch(/<SubmitGoalForm[\s\S]{0,300}key=\{selectedMatchday\.id\}/)
  })

  it('SubmitGoalForm resets `open` + `success` when matchday.id changes (singleton state cleanup)', () => {
    expect(FORM).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]{0,200}setOpen\(false\)[\s\S]{0,200}setSuccess\(false\)[\s\S]{0,80}\},\s*\[matchday\.id\]\)/)
  })

  it('SubmitGoalModal syncs matchPublicId when the matches list changes', () => {
    expect(FORM).toMatch(/if\s*\(!matches\.find\(\(m\)\s*=>\s*m\.id\s*===\s*matchPublicId\)\)/)
    expect(FORM).toMatch(/setMatchPublicId\(matches\[0\]\?\.id\s*\?\?\s*''\)/)
  })

  it('modal shows the matchday label as a bold heading at the top', () => {
    expect(FORM).toMatch(/data-testid="submit-goal-modal-matchday-label"/)
    expect(FORM).toMatch(/Submit a goal for/)
    expect(FORM).toMatch(/\{matchday\.label\}/)
  })

  it('the bold matchday label is the visible h3 (not the legacy "Submit a goal" h3)', () => {
    // The h3 must contain the matchday label expression — pinning the
    // content of the prominent heading.
    expect(FORM).toMatch(/<h3[^>]*data-testid="submit-goal-modal-matchday-label"[^>]*>\s*\{matchday\.label\}\s*<\/h3>/)
  })
})

describe('v1.49.1 — Dashboard locks the banner to the URL-pre-selected matchday', () => {
  const DASHBOARD = readFileSync(DASHBOARD_PATH, 'utf-8')

  // Regression target: pre-v1.49.1 Dashboard mounted NextMatchdayBanner without
  // passing `lockToSelected`. Banner's "auto-default to user's next playing
  // matchday" useEffect (NextMatchdayBanner.tsx:72) fired once `useSession`
  // hydrated and silently jumped from the URL-pre-selected matchday to the
  // user's "next playing" matchday — so visiting /matchday/md2 as a logged-in
  // player whose next playing matchday was MD3 ended up showing MD3.
  // Fix: pass `lockToSelected={initialMatchdayId != null}` so the URL is
  // treated as the source of truth on the matchday route, while the homepage
  // (initialMatchdayId === undefined) keeps the auto-default.
  it('passes lockToSelected={initialMatchdayId != null} to NextMatchdayBanner', () => {
    expect(DASHBOARD).toMatch(
      /<NextMatchdayBanner[\s\S]{0,400}lockToSelected=\{initialMatchdayId\s*!=\s*null\}/
    )
  })
})

describe('v1.49.1 — /matchday/[id] case-insensitive slug match', () => {
  const PAGE = readFileSync(PAGE_PATH, 'utf-8')

  // Regression target: pre-v1.49.1 the page did `m.id === id` exactly, so
  // /matchday/MD2 (capital, the way users naturally type "matchday 2")
  // returned undefined → notFound(). Fix: normalize both sides to lowercase
  // before comparing.
  it('lowercases the URL slug before comparing to matchday.id', () => {
    expect(PAGE).toMatch(/id\.toLowerCase\(\)/)
  })

  it('lowercases matchday.id when comparing (mirror normalization)', () => {
    expect(PAGE).toMatch(/m\.id\.toLowerCase\(\)/)
  })

  it('does NOT do an exact-case `m.id === id` comparison anymore (regression target)', () => {
    expect(stripComments(PAGE)).not.toMatch(/m\.id === id\b/)
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
