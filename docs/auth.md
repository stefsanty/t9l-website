# Auth flows

NextAuth v4 with PrismaAdapter (post-v1.28.0). Three providers for public users + Credentials provider for admin.

## Providers

| Provider | Use | Identity column |
|----------|-----|-----------------|
| **LINE OAuth** | Primary public sign-in (Tokyo league context — most players use LINE) | `User.lineId @unique` (legacy `Player.lineId` mirror archived in v1.65.x) |
| **Google OAuth** | Secondary public sign-in (v1.28.0+) | Account row + `User.email @unique` |
| **Email magic-link** (Resend) | Tertiary public sign-in (v1.28.0+) | Account row + `User.email @unique` |
| **Credentials** | Admin login at `/admin/login` (env-var checked) | No User row — admin-credentials sessions have null `userId` and `lineId` |

## Session shape

Defined in [`src/types/next-auth.d.ts`](../src/types/next-auth.d.ts). The JWT callback in [`src/lib/auth.ts`](../src/lib/auth.ts) populates these fields each request.

```ts
session: {
  user: { name?, email?, image? }
  userId?: string         // User.id — populated for OAuth/email users; null for admin-credentials and pre-v1.28.0 LINE-only sessions
  lineId?: string         // LINE provider sub — populated only for LINE sessions
  playerId?: string       // Player slug for the resolved league
  playerName?: string
  teamId?: string         // LeagueTeam.id for the player's team in the active league
  leagueId?: string       // Resolved via getDefaultLeagueId() (apex always = default; no host-header resolution post-v1.53.0)
  allowSelfLink?: boolean // From League.allowSelfLink — drives picker visibility
  isAdmin?: boolean       // From ADMIN_LINE_IDS env var or Credentials login
}
```

## JWT callback flow (post-v1.61.0)

For every request:

1. **Admin-credentials short-circuit.** No userId / lineId → only `isAdmin` is set; everything else null.
2. **`getDefaultLeagueId()`** (cached, ~ms warm) — always reached, regardless of provider.
3. **`getLeagueAllowSelfLink(leagueId)`** (cached `unstable_cache` 30s, `'leagues'` tag) — populates `session.allowSelfLink`.
4. **Player mapping resolution:**
   - **LINE branch:** `getPlayerMapping(lineId, leagueId)` → Redis-canonical `playerMappingStore` (24h sliding TTL). Defensive Prisma fallback only on Upstash error.
   - **Non-LINE branch (v1.61.0+):** `getPlayerMappingByUserId(userId, leagueId)` → Prisma `User.playerId @unique` lookup. No Redis caching today.
5. **Resolved fields** populate `session.playerId`, `playerName`, `teamId`.

The v1.58.0 short-circuit that skipped league + mapping work for non-LINE sessions was reverted in v1.61.0 because Google/email users gained the picker (per `League.allowSelfLink`).

## Cookie domain

The session JWT cookie is scoped to the apex domain via [`getAuthCookieDomain()`](../src/lib/auth.ts) — currently `.t9l.me`. This was originally for cross-subdomain reads (v1.24.0); subdomains were torn down in v1.53.0, but the cookie scoping is preserved so existing sessions don't all force a re-auth. See [domain-migration-runbook.md](domain-migration-runbook.md) for the full migration sequence if the apex ever changes.

## Constants in `'use server'` files

**Standing rule (v1.59.2):** Never `export const` (or any non-async value) from a file with `'use server'` at the top. Next.js converts EVERY export from a `'use server'` file into a server-action proxy on the client side via `createServerReference(...)`. Constants imported into client components become functions, not values, and crash on first use. Constants/types/interfaces shared between server actions and client components live in a separate neutral module (e.g. [`src/app/account/player/validation.ts`](../src/app/account/player/validation.ts)).

## Recruit / onboarding flows

Two separate user-facing flows for joining a league:

### `/recruit/[slug]` — State C user-initiated registration (v1.67.2+)

For users with NO existing Player. Renders a form (name + position + email + ID images + profile picture). On submit: `applyToLeague` creates Player + PLM(PENDING) atomically. State A/B/D users (already have a Player) redirect to `/id/<slug>` for the apex banner.

### `/join/[code]` — admin-issued invite redemption (v1.34.0+)

Admin generates a `LeagueInvite` code; user lands on `/join/<code>` (linked from email or copy-paste); valid invites flow into `/onboarding` for the same form shape. `OnboardingStatus { PENDING, COMPLETED }` and `JoinSource { ADMIN, SELF_SERVE, INVITE }` track provenance.

### Inputs

Both flows pass through [`src/components/registration/RegistrationFields.tsx`](../src/components/registration/RegistrationFields.tsx) — shared component. Files upload **client-direct to Vercel Blob** (post-v1.71.1) via the presigned-token endpoint at [`src/app/api/blob/upload-token/route.ts`](../src/app/api/blob/upload-token/route.ts) — see [known-infra-issues.md](known-infra-issues.md) for why.

## ID images and profile pictures

Per-person, not per-league (post-v1.70.0): `User.idFrontUrl`, `User.idBackUrl`, `User.idUploadedAt`, `User.image` / `Player.pictureUrl`. The recruit + onboarding flows write to User; admin "purge ID" clears the User columns and DEL's Blob assets.

## Self-link toggle

Per-league `League.allowSelfLink` (v1.60.0). When false, `/assign-player` renders a "request an invite" surface; admins issue invite codes to control roster claims. Independent of provider type — applies equally to LINE / Google / email users.

## Sign-in flow (UI shell)

- [`SignInLightbox`](../src/components/SignInLightbox.tsx) — modal with provider buttons. Mounted globally in `Header.tsx`. Triggered by any auth-gated CTA via `setSignInOpen(true)`.
- **Standing rule:** preserve callback URL across sign-in. Current behavior: providers redirect to `/auth/callback/<provider>` then to the URL the user was on before the modal opened. Helper: [`src/lib/signInCallbackUrl.ts`](../src/lib/signInCallbackUrl.ts).
