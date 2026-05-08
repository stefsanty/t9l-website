# Known infra issues

## Vercel platform body cap (~4.5MB) → client-direct upload pattern (v1.71.1)

**Problem.** Vercel's platform itself caps serverless function request bodies at ~4.5MB and rejects oversize requests at the edge with HTTP 413 (`FUNCTION_PAYLOAD_TOO_LARGE`) BEFORE the Next.js function ever runs. Empirical confirmation against prod (2026-05-07): 4MB POST → 500 (function reached); 5MB+ POST → 413 (rejected at edge, never hit the lambda).

The v1.62.0 → v1.69.1 chain that bumped `experimental.serverActions.bodySizeLimit` from 1mb → 6mb → 25mb was **ineffective** — Next.js's setting cannot override the Vercel platform cap. Browsers received HTTP 413 with no parseable body → React's `useTransition` surfaced the generic "unexpected response" error.

**Fix shape (v1.71.1).** Route bytes around the function entirely. Browser PUTs each file straight to Vercel Blob via `@vercel/blob/client#upload`; only the resulting URLs (a few KB) reach the server action.

- **New endpoint:** [`src/app/api/blob/upload-token/route.ts`](../src/app/api/blob/upload-token/route.ts) issues short-lived presigned upload tokens via `handleUpload` from `@vercel/blob/client`. Gates on `session.userId` (401 on no session) + pathname prefix (`register-pending/<userId>/`, `player-id/<playerId>/(front|back)-`, or `player-profile/<playerId>/`). Per-pathname `allowedContentTypes` + `maximumSizeInBytes` + `addRandomSuffix: false`.
- **Client-direct upload** in [`src/components/registration/RegistrationFields.tsx`](../src/components/registration/RegistrationFields.tsx). Server actions take typed objects with `idFrontUrl` / `idBackUrl` / `profilePictureUrl` — never FormData.
- **Defensive validation in actions:** `isOwnedBlobUrl(url, '/register-pending/<userId>/')` rejects forged URLs. The token route is the primary gate; this is defense in depth.
- **`bodySizeLimit` in [`next.config.ts`](../next.config.ts):** lowered to `'2mb'` — the setting only gates JSON-shaped server-action payloads now (the platform 4.5MB cap overrides for multipart anyway).

**Standing rule.** Any new feature that uploads files >4MB MUST use this pattern. Don't bump `bodySizeLimit` in hopes of solving it; the platform cap wins.

**Out of scope (deferred):** `/account/player` picture upload still uses FormData (its 5MB cap is below the platform limit and works fine — would be a parallel refactor with no user-visible benefit).

## Neon-Vercel preview env race (resolved in v1.58.1)

Vercel preview builds used to fail on the first deploy of new PR branches with `P1012: Environment variable not found: DATABASE_URL_UNPOOLED` because the Neon-Vercel marketplace integration's per-branch DB provisioning hadn't completed yet.

**Fix (v1.58.1):** builds now route through [`scripts/build.mjs`](../scripts/build.mjs) which substitutes a placeholder for missing `DATABASE_URL_UNPOOLED` (so `prisma generate` parses cleanly) and skips `prisma migrate deploy` when the placeholder is active. Production builds with real env vars take the original code path. Test pin: [`tests/unit/buildScript.test.ts`](../tests/unit/buildScript.test.ts).

**Fallback if it still fails.** `gh pr merge <num> --admin --merge` once Unit + tsc are green — the merge to main triggers a prod deploy that uses the always-provisioned production Neon env.

## Neon free-tier branch limit (10 concurrent)

Project `young-lake-57212861` is capped at 10 concurrent branches. When `neonctl branches create` returns `branches limit exceeded`:

- **Additive-only PRs** may proceed without a Layer-3 snapshot, with a "Snapshot not taken" note + rollback recipe (`DROP TABLE/COLUMN ...` + code revert) in the ledger row. Layers 1–2 (git tag + Vercel promotion) still apply.
- **Non-additive PRs** (column drops, type changes, data migrations) must wait for a snapshot to be retired before merging.

Snapshots older than 5 PRs ago can be retired by the active session to free Neon branch slots; Layers 1–2 still cover older windows.

## V8 / Vercel TZ=UTC trap (resolved in v1.9.0)

**Problem.** On Vercel, the Node.js process runs with `process.env.TZ` defaulting to UTC. `new Date("2026-04-16T14:30")` in a server action used to parse the string as UTC clock time — per the ECMAScript spec for ISO-without-Z forms, V8 uses the host TZ. Admins in JST who typed "14:30" had submissions interpreted as 14:30 UTC = 23:30 JST — a 9-hour skew on every match scheduled by any non-JST admin.

**Fix:** all date/time conversions go through canonical helpers in [`src/lib/jst.ts`](../src/lib/jst.ts). See [time-handling.md](time-handling.md).

## Pre-v1.9.0 row skew (one-shot operator action)

Pre-v1.9.0 may have produced `Match.playedAt` rows that are 9 hours off. v1.9.0 stops the bleeding but does NOT bulk-fix existing skewed rows. **Operator action:** spot-check `Match.playedAt` rows and re-save any that look wrong via the admin UI (which now displays JST correctly). Bulk-fix scripts are out of scope — we can't programmatically distinguish "stored correctly as JST 14:30" from "stored skewed as UTC 14:30 (= JST 23:30)" without external context.
