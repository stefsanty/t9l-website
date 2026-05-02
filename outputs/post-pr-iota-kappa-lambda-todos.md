# Post ι/κ/λ ToDos — operator + deferred work

**Date:** 2026-05-03 · **Closed chain:** ι → κ → λ shipped + live on prod (v1.37.0 / v1.38.0 / v1.39.0).

This document carries forward the ToDos that the three PRs in this chain didn't tackle. Everything below is **NOT shipped** in v1.39.0 — it's the explicit "next session pick-up" list.

## A. Operator ToDos (act when ready)

These need either env-var configuration on Vercel or manual data work. They DO NOT require code changes; they're operator-driven.

### A1. Multi-provider auth env vars on Vercel (carried forward from v1.28.0 / α.5)

The α.5 multi-provider auth foundation shipped in v1.28.0 with Google OAuth + email magic-link providers gated behind env-var presence checks. Until these vars land on Vercel, the `/auth/signin` provider picker shows LINE only:

- `GOOGLE_CLIENT_ID` — from Google Cloud Console (OAuth 2.0 Client ID)
- `GOOGLE_CLIENT_SECRET` — same
- `EMAIL_SERVER` — SMTP connection string. Recommended: Resend (free tier 100 emails/day; create account at https://resend.com, copy SMTP credentials, format as `smtp://resend:<api-key>@smtp.resend.com:587`)
- `EMAIL_FROM` — sending address (e.g. `noreply@t9l.me` once domain is set up at the email provider)

**Set on:** Production AND Preview environments on Vercel (the dev preview Neon branch uses the same envs, so previews can exercise the full flow).

**Verify after setting:**
1. Hit `/auth/signin` on the live site — Google + email buttons should now appear alongside the LINE button.
2. Click Google → completes OAuth round-trip → lands logged in (no playerId until they redeem an invite).
3. Click email → enters address → receives magic-link email → clicks → lands logged in.
4. Both should produce a fresh `User` row + `Account` row in Postgres (via the v1.28.0 PrismaAdapter).

### A2. `BLOB_READ_WRITE_TOKEN` on Vercel (PR ι requirement + PR η carried forward)

Two surfaces need this:

- `/account/player` profile picture upload (PR ι / v1.37.0). Without the token, the UI surfaces "currently unavailable, contact admin" on the picture section; the rest of the form (name / position / preferences) keeps working.
- `/join/[code]/id-upload` (PR η / v1.35.0). Without the token, the upload page surfaces a Skip flow that flips `onboardingStatus` to COMPLETED without writing URLs (admin collects ID out-of-band).

**Get the token:**
1. Go to Vercel → Storage → Blob.
2. If no Blob store exists yet, create one for the project.
3. Copy the `BLOB_READ_WRITE_TOKEN` from the integration page.
4. Add as an env var on Production AND Preview.

### A3. Pre-Blob-token users with null `idUploadedAt` (carried forward from v1.35.0)

Once A2 is set, audit whether any users completed onboarding via the Skip flow (η's BLOB-token-missing fallback). They have `Player.idUploadedAt IS NULL` despite `onboardingStatus = COMPLETED`. Either:

- Reach out to them out-of-band to collect IDs and upload via raw SQL, OR
- Use the new admin "Reset onboarding" button (θ / v1.36.0) on `/admin/leagues/[id]/players` to flip their assignment back to NOT_YET; they'll redo the onboarding flow with the BLOB upload step working this time.

**Query to find affected users:**
```sql
SELECT p.id, p.name, p.lineId
FROM "Player" p
JOIN "PlayerLeagueAssignment" pla ON pla."playerId" = p.id
WHERE p."idUploadedAt" IS NULL
  AND pla."onboardingStatus" = 'COMPLETED'
  AND pla."joinSource" IN ('CODE', 'PERSONAL');
```

### A4. End-to-end smoke test of the full onboarding chain

After A1+A2 land, exercise the full flow at least once before announcing the new onboarding to players:

1. Admin creates a Player via the "Add Player" dialog on `/admin/leagues/[id]/players` (PR ε).
2. Admin generates a PERSONAL invite via the new kebab → "Generate invite" (PR κ).
3. Open the invite URL in a fresh browser session.
4. Sign in via LINE (or Google or email — all three should work after A1).
5. Confirm preview screen → ID upload → welcome.
6. Verify on `/admin/leagues/[id]/players` that the row now shows the green "Signed up" sign-in pill (PR κ).
7. Visit `/account/player` from the new user's session and verify the form prefills with submitted data (PR ι).

### A5. New: profile picture moderation policy

PR ι ships user-uploaded profile pictures with NO moderation. Before announcing:

- Decide policy: free-text (no review), admin-review-required, or community-flag.
- If admin-review: would need a new column `Player.profilePictureModerated` and a new admin UI; not built.
- If community-flag: would need a flag-and-review surface; not built.

Until a policy is decided, the upload is open. Risk profile is low (closed league, all members are personally known to admins).

### A6. New: profile picture content guidelines

If the operator wants a content policy (no offensive imagery, no impersonation), surface it on `/account/player` near the upload affordance. Currently the only constraint is technical: JPEG/PNG/WebP, ≤5MB.

## B. Deferred work (NOT shipped in this chain)

These are explicitly out of scope per the rework plan / per session decisions. The next session picks them up only if/when the user requests.

### B1. Admin invite-management page (carried from v1.33.0 / PR ε)

Current invite workflow:
- Generate: per-row kebab "Generate invite" or bulk-select toolbar (PR ε / v1.33.0).
- Revoke: only via raw SQL `UPDATE "LeagueInvite" SET "revokedAt" = NOW() WHERE id = '...'`.
- Re-issue: generate again (creates a new invite; old one stays valid until revoked).

A dedicated `/admin/leagues/[id]/invites` page would surface:
- All active invites for the league (CODE + PERSONAL, with target player names).
- Revoke button per row.
- Re-issue (revoke + generate) action.
- Filter by status (active / used / expired / revoked).

Not built. Deferred until operator surfaces the need.

### B2. Header league switcher (carried from §10 of the rework plan)

When a User belongs to multiple leagues simultaneously, the header should expose a league switcher that updates the JWT's per-league context. This depends on:
- `session.memberships` plumbing (currently `session.leagueId` is per-request based on Host header).
- A reliable list of "leagues this User has membership in" (queryable via `Player.leagueAssignments.leagueTeam.league` join, but not exposed in the JWT today).

Deferred per §8 of the brainstorm brief — multi-tenant operator UX (subdomain attachment, per-subdomain DNS, etc.) is itself deferred.

### B3. Per-league roster-visibility setting

Currently the public site renders the full roster of every league it serves. Some leagues might want closed rosters (visible only to logged-in / linked players). Not built. New `Setting` row + middleware check would handle it.

### B4. Account-linking UI

Per the rework plan §13: a User signed in via LINE today should be able to add Google as a second `Account` row (or vice versa) so they can sign in via either provider next time. NextAuth's `Account` table supports the data model; the UI to initiate the link doesn't exist.

Defense-in-depth: `allowDangerousEmailAccountLinking` is intentionally OFF (defends against attacker creating Google account with victim's LINE email and taking over). The right answer is opt-in linking from the existing-User side.

### B5. Stage 4 (Δ) — drop `Player.lineId` + `User.lineId`

Stage γ (v1.30.0) shipped 2026-05-01 with the User-side resolver behind a `Setting('identity.read-source')` flag, default `'legacy'`. The original soak window before stage Δ is 3-4 weeks.

**Earliest natural window:** 2026-05-22 to 2026-05-29.

**Stage Δ scope:**
- Operator flip the Setting to `'user'` first; soak for ≥1 week.
- Drop `Player.lineId` and `User.lineId` columns (migration).
- Remove `getPlayerMappingFromDbLegacy` from `lib/auth.ts`.
- Remove `linkPlayerToUser` (the lineId-keyed helper) from `lib/identityLink.ts`. Every caller is already prepared to use `linkUserToPlayer` (PR λ) since it's a strict superset.
- Drop the `Setting('identity.read-source')` flag.
- Drop the legacy Redis `t9l:auth:map:` namespace in favor of a User.id-keyed namespace.
- Add the `@relation` FK between `User.playerId` and `Player.id` (deferred from PR λ — see B6).

### B6. `@relation` FK enforcement on User↔Player (carried forward from PR λ)

Pre-stage-Δ, both `User.playerId @unique` and `Player.userId @unique` exist as mirror columns without `@relation`. Adding the relation requires picking a single owning direction (Prisma rejects symmetric `fields/references`).

The natural choice is to keep `User.playerId` as the owning side (since stage Δ drops `User.lineId`, leaving `User.playerId` as the canonical link) and re-cast `Player.userId` as the inverse-only side.

Defer to stage Δ. Adding the FK now would risk a migration failure if any User.playerId row points at a non-existent Player (unlikely per the post-β backfill, but the Layer 5c audit script would need a User↔Player extension first).

## Verification

All three PRs in this chain are merged + tagged + deployed:

| PR | Version | Merge SHA | Deploy URL | Status |
|----|---------|-----------|-----------|--------|
| ι | v1.37.0 | `72bd7c8` | `https://t9l-website-pd8exllie-t9l-app.vercel.app` | live |
| κ | v1.38.0 | `338e898` | `https://t9l-website-q7c8mtqt2-t9l-app.vercel.app` | live (verified `1.38.0` in HTML) |
| λ | v1.39.0 | `5189050` | `https://t9l-website-c105hqsto-t9l-app.vercel.app` | live (verified `1.39.0` in HTML) |

Each Vercel preview hit the documented Neon-Vercel `DATABASE_URL_UNPOOLED` race; admin-merged via `gh pr merge --admin` per the runbook fallback (Unit + type-check green on each).

930 tests pass | 2 skipped (across the 3 PRs: 41 + 29 + 20 = 90 net new test cases on top of the 840-baseline).
