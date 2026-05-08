# Architecture

## Project

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Players log in (LINE / Google / email), claim a Player record, RSVP availability for matchdays, and view live league data. Multi-tenant: a single Vercel deployment serves multiple leagues, each at `/id/<slug>` (path-based, post-v1.54.0; the apex `/` always renders the default league).

## Stack

- **Next.js** (App Router, server + client components, ISR)
- **TypeScript** (strict mode)
- **Tailwind CSS v4**
- **Prisma + `@neondatabase/serverless`** — Postgres ORM (Neon-hosted). Single source of truth for the public site (Google Sheets surface retired in v1.71.0).
- **`next-auth` v4** — LINE OAuth + Google OAuth + email magic-link (public players); Credentials provider (admin).
- **`@upstash/redis`** — Canonical store for lineId→Player mapping and per-GameWeek RSVP signals. Also caches Vercel Blob URLs for player pics.
- **`@vercel/blob`** — Player profile pictures (LINE-CDN mirror) + ID images. Client-direct upload via presigned tokens for >4.5MB payloads (post-v1.71.1; see [known-infra-issues.md](known-infra-issues.md)).
- **`sonner`** — Toast notifications (global Toaster mounted in `app/layout.tsx`).
- **Vitest** (unit) + **Playwright** (e2e) — see [testing.md](testing.md).
- Deployed to Vercel; Neon-Vercel marketplace integration auto-provisions a Neon branch DB per Vercel preview branch.

## Data flow

```
Postgres (Neon, source of truth via Prisma)
       ↓ read (lib/dbToPublicLeagueData.ts)
  lib/publicData.ts → lib/stats.ts
       ↓
  app/page.tsx (apex → default league)            renders Dashboard
  app/id/[slug]/page.tsx (per-league)             renders Dashboard
  app/id/[slug]/md/[id]/page.tsx (per-matchday)   renders Dashboard with initialMatchdayId
       ↓ Dashboard composes:
       NextMatchdayBanner / MatchdayAvailability / RsvpBar
       UserTeamBadge / GuestLoginBanner / RecruitingBanner / LeagueDetailsPanel

LINE/Google/Email → next-auth JWT callback → playerMappingStore (Redis canonical)
                                              └ Prisma fallback only on store error
Player link  → /api/assign-player → Redis sync, Prisma deferred via waitUntil
RSVP write   → /api/rsvp           → Redis sync, Prisma deferred via waitUntil
RSVP read    → publicData.getRsvpData → rsvpStore HGETALL → Prisma fallthrough on miss
i18n         → googtrans cookie set by LanguageToggle (Google Translate; no app-side pipeline)
Player pics  → /stats reads Redis player-pic:<slug> → Vercel Blob URL (LINE-CDN mirror)
```

## Routing model — path-based (post-v1.54.0)

Every tenant URL lives under `/id/<slug>`. Subdomains were torn down in v1.53.0 (`getLeagueFromHost.ts` and host-header league resolution are gone).

| Route | Purpose |
|-------|---------|
| `/` | Apex — always renders the default league (resolved via `getDefaultLeagueId()` in [`src/lib/leagueSlug.ts`](../src/lib/leagueSlug.ts)) |
| `/id/[slug]` | Per-league Dashboard (canonical post-v1.54.0) |
| `/id/[slug]/md/[id]` | Per-matchday Dashboard with `initialMatchdayId` |
| `/league/[slug]`, `/league/[slug]/md/[id]`, `/[slug]`, `/matchday/[id]` | Legacy 308-redirects to the `/id/` namespace |
| `/schedule`, `/stats`, `/assign-player`, `/account/player` | Global pages — always render against the default league |
| `/admin`, `/admin/...` | Admin shell (Credentials provider) |
| `/recruit/[slug]` | User-initiated league registration form (v1.67.2+) |
| `/join/[code]` | Invite redemption + onboarding (v1.34.0+) |

Reserved-word guard: `RESERVED_LEAGUE_SLUGS = ['id']` only (post-v1.54.0). Static segments win over `/[slug]` so a league slug "admin" lives at `/id/admin` and never collides with `/admin`. The `[slug]` → 308 form additionally rejects reserved slugs.

## File structure

```
src/
├── app/
│   ├── layout.tsx                      # AuthProvider, ThemeProvider, Sonner Toaster
│   ├── page.tsx                        # Apex — renders default league via Dashboard
│   ├── loading.tsx                     # Apex skeleton (v1.59.0 — instant nav swap)
│   ├── id/[slug]/page.tsx              # Canonical per-league Dashboard (v1.54.0+)
│   ├── id/[slug]/md/[id]/page.tsx      # Per-matchday Dashboard
│   ├── [slug]/, league/, matchday/     # Legacy 308-redirects
│   ├── admin/                          # Admin shell (Credentials)
│   ├── recruit/[slug]/                 # State C user-initiated registration (v1.67.2+)
│   ├── join/[code]/                    # Invite redemption + onboarding (v1.34.0+)
│   ├── account/player/                 # User self-service profile (v1.37.0+)
│   ├── assign-player/                  # Picker + linking flow
│   ├── schedule/, stats/               # Global public pages
│   └── api/
│       ├── auth/[...nextauth]/         # next-auth handler
│       ├── assign-player/route.ts      # POST/DELETE: link/unlink lineId/userId → playerId
│       ├── rsvp/route.ts               # POST: RSVP write
│       ├── me/memberships/route.ts     # League switcher data (v1.59.0)
│       ├── blob/upload-token/route.ts  # Presigned Vercel Blob tokens (v1.71.1)
│       └── recruiting/actions.ts       # registerToLeague, applyToLeague
├── components/
│   ├── Dashboard.tsx                   # Single public renderer (v1.25.0)
│   ├── NextMatchdayBanner.tsx, MatchdayAvailability.tsx, RsvpBar.tsx
│   ├── LeagueSwitcher.tsx              # Header dropdown (v1.52.0+, SSR-hydrated v1.59.0)
│   ├── PlayerAvatar.tsx, LineLoginButton.tsx, RecruitingBanner.tsx
│   ├── registration/                   # RegistrationFields shared between recruit + onboarding
│   └── admin/, ui/                     # Admin tabs + shadcn-style primitives
├── lib/
│   ├── leagueSlug.ts                   # getDefaultLeagueId, getLeagueIdBySlug, validateLeagueSlug
│   ├── publicData.ts                   # Cached static read + uncached RSVP merge
│   ├── dbToPublicLeagueData.ts         # Prisma → LeagueData adapter
│   ├── auth.ts                         # next-auth authOptions
│   ├── playerMappingStore.ts           # Upstash-canonical lineId→Player (24h sliding TTL)
│   ├── rsvpStore.ts                    # Upstash-canonical per-GameWeek RSVP (matchday + 90d TTL)
│   ├── identityLink.ts                 # User↔Player binding helpers
│   ├── revalidate.ts                   # revalidate({ domain }) — single cache-bust entry point
│   ├── jst.ts                          # Canonical JST date/time helpers
│   ├── memberships.ts                  # League switcher data helper
│   ├── ids.ts                          # Slug↔DB-id helpers
│   ├── prisma.ts                       # Prisma client singleton
│   └── version.ts                      # APP_VERSION
└── types/
    └── index.ts                        # All TypeScript interfaces
```

## Public id conventions

- `Player.id` — slug shape via `lib/data.ts#slugify`. Example: "Ian Noseda" → `ian-noseda`.
- `Team.id` — slug shape. Example: "Mariners FC" → `mariners-fc`.
- DB-level ids are prefixed (`p-<slug>` / `t-<slug>` / `lt-...` / `m-...` / `g-...`) per [`src/lib/ids.ts`](../src/lib/ids.ts). Slug↔DB-id helpers (`playerIdToSlug`, `slugToPlayerId`) bridge namespaces.

## Environment variables

```
# LINE OAuth
LINE_CLIENT_ID
LINE_CLIENT_SECRET
NEXTAUTH_SECRET
NEXTAUTH_URL                   # https://t9l.me in prod, http://localhost:3000 in dev

# Google OAuth (next-auth providers/google — OAuth-only, not Sheets)
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# Upstash Redis — canonical lineId→Player mapping + per-GameWeek RSVP
KV_REST_API_URL
KV_REST_API_TOKEN

# Vercel Blob (player pics + ID images)
BLOB_READ_WRITE_TOKEN

# Postgres (Neon-Vercel marketplace integration provisions both per branch)
DATABASE_URL                   # Pooled (PgBouncer)
DATABASE_URL_UNPOOLED          # Direct (used by `prisma migrate deploy` + Prisma `directUrl`)

# Email magic-link (Resend)
RESEND_API_KEY
EMAIL_FROM
```

Auth features (RSVP, player assignment) degrade gracefully when KV/Blob vars are missing.

## Commands

```bash
npm run dev          # Local dev
npm run build        # Production build (routes through scripts/build.mjs; see known-infra-issues.md)
npm run lint         # ESLint
npm run test:run     # Vitest one-shot (matches CI)
npm run test:e2e     # Playwright against $BASE_URL (default https://t9l.me)
```

## Internationalization

Delivered via Google Translate's `googtrans` cookie set by [`src/components/LanguageToggle.tsx`](../src/components/LanguageToggle.tsx). No app-side translation pipeline. The `formatJstFriendly` helper accepts a `'en' | 'ja'` locale parameter so server-side date rendering can match the page language.

## Important notes

- League rosters and schedules are **dynamic per league** — team count, player count, matchday count, and match duration vary across leagues. Read from Prisma; do not hardcode counts.
- Matchday dates can be null. Display "TBD" when null (per v1.31.0).
- Match scores derive from `MatchEvent` rows (v1.42.0+). A match's score is computed live from its events (filtered to GOAL types and applied via the `OWN_GOAL` flip).
- Player pictures: `/stats` reads Redis `player-pic:<slug>` → Vercel Blob URL (mirror of the LINE display picture). Other public surfaces use `PlayerAvatar`'s static fallback chain.
