/**
 * v1.69.0 — Player Availability Visualization toggle.
 *
 * The matchday availability section now exposes a toggle between two
 * presentations: the existing 9-a-side formation pitch, and a new flat
 * pill-list view colored by player position.
 *
 * Toggle preference persists per-user via localStorage; defaults to
 * formation. Toggle is rendered next to both section headers ("Who Played"
 * for past matchdays, "Who else is coming?" for upcoming).
 *
 * These tests are structural (file source matchers) — the component is a
 * `'use client'` boundary and bringing up a React/jsdom render harness
 * for a single feature is more cost than the regression coverage warrants.
 * The test seam pins: (1) toggle UI exists and is wired through state,
 * (2) localStorage is read on mount + written on change, (3) both views
 * render conditionally per `viewMode`, (4) pill-list colors are sourced
 * from the canonical position color map.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.69.0 MatchdayAvailability — view mode plumbing', () => {
  const src = read('src/components/MatchdayAvailability.tsx')

  it('declares an AvailabilityViewMode type with formation + list members', () => {
    expect(src).toMatch(/AvailabilityViewMode\s*=\s*['"]formation['"]\s*\|\s*['"]list['"]/)
  })

  it('owns a viewMode useState in the main component, defaulting to formation', () => {
    expect(src).toMatch(/useState<AvailabilityViewMode>\(['"]formation['"]\)/)
  })

  it('hydrates viewMode from localStorage on mount via useEffect', () => {
    // The effect reads the canonical key and conditionally promotes the value.
    expect(src).toMatch(/useEffect\(/)
    expect(src).toMatch(/localStorage\.getItem\(VIEW_MODE_STORAGE_KEY\)/)
    expect(src).toMatch(/stored\s*===\s*['"]formation['"]\s*\|\|\s*stored\s*===\s*['"]list['"]/)
  })

  it('persists viewMode changes to localStorage', () => {
    expect(src).toMatch(/localStorage\.setItem\(VIEW_MODE_STORAGE_KEY,\s*next\)/)
  })

  it('uses a stable storage key under the t9l namespace', () => {
    expect(src).toMatch(/VIEW_MODE_STORAGE_KEY\s*=\s*['"]t9l-availability-view['"]/)
  })

  it('catches localStorage read/write errors so private mode does not crash', () => {
    // Two try blocks (read, write) — count is at least 2.
    const tryCount = (src.match(/try\s*\{/g) || []).length
    expect(tryCount).toBeGreaterThanOrEqual(2)
  })
})

describe('v1.69.0 MatchdayAvailability — toggle UI', () => {
  const src = read('src/components/MatchdayAvailability.tsx')

  it('defines a ViewModeToggle component', () => {
    expect(src).toMatch(/function ViewModeToggle\(/)
  })

  it('renders both Pitch and List buttons inside the toggle', () => {
    expect(src).toMatch(/availability-view-formation/)
    expect(src).toMatch(/availability-view-list/)
  })

  it('marks the active button with aria-pressed', () => {
    expect(src).toMatch(/aria-pressed=\{mode\s*===\s*['"]formation['"]\}/)
    expect(src).toMatch(/aria-pressed=\{mode\s*===\s*['"]list['"]\}/)
  })

  it('mounts the toggle near the "Who else is coming?" header (upcoming)', () => {
    // The toggle is rendered in the same flex row as the upcoming-matchday h3.
    expect(src).toMatch(/Who else is coming\?[\s\S]{0,400}<ViewModeToggle\s/)
  })

  it('mounts the toggle near the "Who Played" header (past)', () => {
    expect(src).toMatch(/Who Played[\s\S]{0,400}<ViewModeToggle\s/)
  })

  it('threads viewMode + handleViewModeChange into both toggle mounts', () => {
    const toggleMounts = src.match(/<ViewModeToggle[^>]*\/>/g) || []
    expect(toggleMounts.length).toBeGreaterThanOrEqual(2)
    for (const mount of toggleMounts) {
      expect(mount).toMatch(/mode=\{viewMode\}/)
      expect(mount).toMatch(/onChange=\{handleViewModeChange\}/)
    }
  })
})

describe('v1.69.0 MatchdayAvailability — TeamPillList view', () => {
  const src = read('src/components/MatchdayAvailability.tsx')

  it('defines a TeamPillList component', () => {
    expect(src).toMatch(/function TeamPillList\(/)
  })

  it('renders an empty-state message when there are no confirmations', () => {
    expect(src).toMatch(/TeamPillList[\s\S]*No confirmations yet/)
  })

  it('exports a getPositionPillColor helper covering all canonical positions', () => {
    expect(src).toMatch(/export function getPositionPillColor/)
    for (const pos of ['GK', 'DF', 'DF\\/MF', 'MF', 'MF\\/FWD', 'FWD']) {
      expect(src).toMatch(new RegExp(`case ['"]${pos}['"]`))
    }
  })

  it('matches SquadList position colors (single source of truth for positions)', () => {
    const squadList = read('src/components/SquadList.tsx')
    // Spot-check: GK / DF / FWD must use the same Tailwind class strings.
    expect(squadList).toMatch(/'GK': return 'bg-zinc-950 text-white border-white\/20'/)
    expect(src).toMatch(/case ['"]GK['"]:\s*return\s*['"]bg-zinc-950 text-white border-white\/20['"]/)
    expect(squadList).toMatch(/'DF': return 'bg-blue-600 text-white border-blue-400\/30'/)
    expect(src).toMatch(/case ['"]DF['"]:\s*return\s*['"]bg-blue-600 text-white border-blue-400\/30['"]/)
    expect(squadList).toMatch(/'FWD': return 'bg-red-600 text-white border-red-400\/30'/)
    expect(src).toMatch(/case ['"]FWD['"]:\s*return\s*['"]bg-red-600 text-white border-red-400\/30['"]/)
  })

  it('renders pills inside a flex-wrap container with a list testid', () => {
    expect(src).toMatch(/data-testid="availability-pill-list"/)
    expect(src).toMatch(/className="mt-2 flex flex-wrap/)
  })

  it('per-player pills use getPositionPillColor and carry per-player testids', () => {
    expect(src).toMatch(/getPositionPillColor\(p\.position\)/)
    expect(src).toMatch(/data-testid={`availability-pill-\$\{p\.id\}`}/)
  })
})

describe('v1.69.0 MatchdayAvailability — viewMode routes both branches', () => {
  const src = read('src/components/MatchdayAvailability.tsx')

  it('past-matchday expanded panel switches between TeamPillList and TeamFormation', () => {
    // Two ternaries against viewMode === 'list' (past-matchday + upcoming-matchday branches).
    const branches = src.match(/viewMode\s*===\s*['"]list['"]/g) || []
    expect(branches.length).toBeGreaterThanOrEqual(2)
  })

  it('TeamPillList is rendered in both branches when viewMode is list', () => {
    const pillListMounts = src.match(/<TeamPillList[\s\S]*?\/>/g) || []
    expect(pillListMounts.length).toBeGreaterThanOrEqual(2)
  })

  it('TeamFormation is still rendered in both branches when viewMode is formation', () => {
    const formationMounts = src.match(/<TeamFormation[\s\S]*?\/>/g) || []
    expect(formationMounts.length).toBeGreaterThanOrEqual(2)
  })
})

describe('v1.69.0 — version pinned', () => {
  // Floor check — v1.69.0 introduced the toggle; subsequent patches stay
  // in the v1.69.x line. Pinning the literal value would conflict with
  // every patch bump (cf. v1.69.1 body-limit fix).
  it('APP_VERSION is in the v1.69.x line or later', () => {
    const src = read('src/lib/version.ts')
    expect(src).toMatch(/APP_VERSION\s*=\s*['"](?:1\.69\.\d+|1\.[7-9]\d*\.\d+|[2-9]\.\d+\.\d+)['"]/)
  })
})
