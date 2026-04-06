# T9L Website — Session Handover

_Last updated: 2026-04-07_

## What has been built

The project is a **Next.js 14 (App Router) website** for the Tennozu 9-Aside League (T9L), deployed to Vercel at t9l.me. It is read-only V1 — all data comes from a Google Sheet via the Sheets API.

### Current state: partial build

Only one section of the home page is wired up end-to-end. The remaining four sections exist as spec but have no component files yet.

#### What's done

| Area | Status |
|------|--------|
| `src/lib/sheets.ts` | Fetches all 6 sheet tabs in a single `batchGet`. Falls back to mock data when env vars are absent. ISR `revalidate = 300`. |
| `src/lib/mock-data.ts` | Full mock dataset (4 teams, ~50 players, 8 MDs, MD1 goals, MD1 ratings). Used in dev without credentials. |
| `src/lib/data.ts` | Parses all raw sheet arrays into typed models: teams, players, schedule, goals, ratings, availability. |
| `src/lib/stats.ts` | `computeLeagueTable`, `computeTopScorers`, `computeTopAssisters`, `computeTopRated`, `findNextMatchday` — all implemented. |
| `src/types/index.ts` | All TypeScript interfaces: `Team`, `Player`, `Match`, `Matchday`, `Goal`, `PlayerRating`, `Availability`, `LeagueTableRow`, `TopScorer`, `TopAssister`, `TopRated`, `LeagueData`. |
| `src/components/LeagueTable.tsx` | Fully built. Shows team logo, name (short on mobile), MP/W/D/L/GF/GA/GD/Pts. GF/GA hidden on mobile. Leader row highlighted. |
| `src/app/page.tsx` | Fetches data, computes league table, renders `<LeagueTable>`. Only this section rendered — others not yet added. |
| `src/app/layout.tsx` | Barlow Condensed (display) + Inter (body) from Google Fonts. Dark theme via CSS vars. |
| `src/app/globals.css` | CSS vars: `--background #0a0a0a`, `--foreground #ededed`, `--muted #888888`, `--border #1f1f1f`, `--card #111111`. Tailwind v4 `@theme inline` block. |
| `public/team_logos/` | Four PNG logos: `Mariners FC.png`, `Fenix FC.png`, `Hygge SC.png`, `FC Torpedo.png`. |
| `TEAM_LOGOS` map in `data.ts` | Maps team IDs to `/team_logos/<name>.png`. Overrides the null logo from the sheet. |

#### What's missing (not yet built)

These components are specified in `docs/spec.md` and `CLAUDE.md` but have **no files yet**:

1. **`NextMatchdayBanner.tsx`** — Hero section: "NEXT MATCHDAY — MD[X]", date/TBD, all 3 match pairings with kickoff times, sitting-out team, per-team availability count (expandable).
2. **`TopPerformers.tsx`** — 3 cards: top scorer, top assister, top rated. All stat functions (`computeTopScorers`, `computeTopAssisters`, `computeTopRated`) exist in `stats.ts` and are ready to use.
3. **`MatchResults.tsx`** — Stacked by matchday (most recent first), 3 scores per matchday, expandable goalscorers per match.
4. **`SquadList.tsx`** — Per-team collapsible sections, player name + position, availability badge (✅/❓) for next matchday.

None of these are rendered in `page.tsx` yet either. The page currently only shows `<LeagueTable>`.

---

## Key architecture notes

- **Data flow**: `page.tsx` (server component) → `fetchSheetData()` → `parseAllData()` → pass typed data to components as props. All components are client-renderable but currently server-rendered.
- **Mock data**: When `GOOGLE_SHEET_ID` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` env vars are absent, `sheets.ts` automatically returns mock data from `mock-data.ts`. This means `npm run dev` works locally without credentials.
- **Team logos**: Static PNGs in `public/team_logos/`. Referenced via `TEAM_LOGOS` constant in `data.ts` keyed by team slug (`mariners-fc`, `fenix-fc`, `hygge-sc`, `fc-torpedo`). The `Team.logo` field on all teams is now populated.
- **Tailwind v4**: Uses `@import "tailwindcss"` and `@theme inline` in `globals.css`. Custom colors (`background`, `foreground`, `muted`, `border`, `card`) are mapped via CSS vars. Font aliases `font-display` and `font-body` are also in the theme.
- **`next.config.ts`**: Minimal — only has a redirect from `/minato` → an AppSheet URL. No image domain config needed (logos are local).

---

## Immediate next steps

The natural continuation is building the remaining home page sections in order (top to bottom per spec):

1. Add `NextMatchdayBanner.tsx` — uses `findNextMatchday()` from `stats.ts` and the `availability` map from `parseAllData()`.
2. Add `TopPerformers.tsx` — uses `computeTopScorers`, `computeTopAssisters`, `computeTopRated` from `stats.ts`.
3. Add `MatchResults.tsx` — uses `matchdays` from `parseAllData()`, expandable goalscorers per match from `goals`.
4. Add `SquadList.tsx` — uses `players` + `availability` from `parseAllData()`, `findNextMatchday()` to know which MD to badge.
5. Wire all four into `page.tsx`.

---

## Environment / deployment

- **Vercel**: Auto-deploys on push to `main`.
- **Required env vars** (set in Vercel dashboard):
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
  - `GOOGLE_PRIVATE_KEY` (PEM, with literal `\n` for newlines — `sheets.ts` handles `.replace(/\\n/g, "\n")`)
  - `GOOGLE_SHEET_ID` = `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc`
- **Local dev**: `npm run dev` — works without env vars (uses mock data).
- **Build**: `npm run build` — will fail without env vars unless mock-data fallback is triggered.

---

## File map

```
src/
├── app/
│   ├── layout.tsx          # Fonts, metadata, dark theme body
│   ├── page.tsx            # Home — server component (only LeagueTable rendered so far)
│   └── globals.css         # CSS vars + Tailwind v4 theme
├── components/
│   └── LeagueTable.tsx     # Done — shows logo, stats, leader highlight
├── lib/
│   ├── sheets.ts           # Google Sheets batchGet + mock fallback
│   ├── mock-data.ts        # Full mock dataset for local dev
│   ├── data.ts             # Sheet row parsers → typed models
│   └── stats.ts            # League table, top scorers/assisters/rated, next matchday
└── types/
    └── index.ts            # All TypeScript interfaces

public/
└── team_logos/
    ├── Mariners FC.png
    ├── Fenix FC.png
    ├── Hygge SC.png
    └── FC Torpedo.png

docs/
├── spec.md                 # Full V1 product spec (authoritative)
└── handover.md             # This file

CLAUDE.md                   # Project instructions for Claude (stack, data model, UI spec)
```
