'use server'

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { waitUntil } from '@vercel/functions'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'
import { sendMail } from '@/lib/email'
import { applicationReceivedEmail } from '@/lib/emailTemplates'
import { buildSuccessRedirect } from '@/lib/successRedirect'
import {
  legacyPositionFromArray,
  normalizePositions,
  type BallType,
} from '@/lib/positions'

/**
 * v1.64.0 / v1.65.1 — Application/recruiting workflow.
 *
 * `applyToLeague` is the public-facing apply action invoked by the
 * `RecruitingBanner` modal in two states:
 *
 *   - State C ('no_player') — authenticated user has no Player yet. We
 *     create a fresh Player + a new PlayerLeagueMembership(PENDING) for
 *     the target league. Player.userId is set per the v1.27.0 dual-
 *     write invariant. Legacy `Player.applicationStatus = PENDING` +
 *     `Player.applicationLeagueId = leagueId` are also set for
 *     stage-2 dual-write compat (read flip happens in v1.65.2).
 *
 *   - State D ('in_other_league') — authenticated user ALREADY has a
 *     Player (e.g. APPROVED in T9L) applying to a NEW league.
 *     **THE STATE D BUG FIX (v1.65.1):** create a NEW PLM(PENDING) for
 *     the existing Player in the new league. **Do NOT touch
 *     `Player.applicationStatus`** — that's a global field; flipping
 *     it would corrupt the existing-league admin's view of "this
 *     player is APPROVED". Instead we rely on the new
 *     `PlayerLeagueMembership.applicationStatus = PENDING` in the new
 *     league as the per-league source of truth. The admin of the new
 *     league sees the pending application via the v1.65.1 read path
 *     (which now unions the legacy Player.* check + the new PLM
 *     check); the admin of the existing league sees no change to the
 *     player's APPROVED state.
 *
 * Validation gates:
 *   - Sign in required (no anonymous applications). State E in the
 *     banner now toasts "Sign in to apply" rather than redirecting.
 *   - v1.80.10 — admin-orthogonal-UX rule. The gate now resolves the
 *     User row by `userId` OR `lineId` (User.lineId @unique). Admin role
 *     is NOT a gate; LINE-auth admins (Stefan-type) and grandfathered
 *     LINE sessions whose JWT predates v1.28.0 stage α.5 (no `userId`
 *     set) flow through identically. Mirrors the v1.59.1 fix in
 *     `account/player/actions.ts:requireSelfPlayerSession`. Sessions
 *     with neither identifier (admin-credentials shared-password)
 *     surface a neutral "sign in with a player account" message.
 *   - For State C: trimmed name required (≤ 100 chars). For State D:
 *     name is unused — the existing Player's name carries through.
 *   - Position is the v1.33.0 `PlayerPosition` enum or null.
 *   - LeagueId must resolve to a real League row.
 *   - For State D: the new PLM must not duplicate an existing PENDING
 *     PLM in the same league (idempotency on double-click).
 */

export interface ApplyToLeagueInput {
  leagueId: string
  // For State C: name is required. For State D: ignored (the existing
  // Player's name persists). The component sends an empty string when
  // it knows the user is in State D.
  name: string
  /**
   * v1.82.0 — multi-position. Validated server-side against the
   * league's `ballType` vocabulary. Empty array == "no position
   * recorded" (matches the legacy null behaviour).
   */
  positions?: ReadonlyArray<string>
  /**
   * v1.81.0 — origin-path tracking for the success popup. Captured at
   * form-mount time on the originating page (e.g. `/id/<slug>`) and
   * passed through so the server action can redirect to
   * `<originPath>?submitted=applyToLeague` on success. Validated via
   * `safeOriginPath` (must start with `/`, not `//`, no traversal).
   * Falls back to `/id/<league.subdomain>` when missing/invalid.
   */
  originPath?: string | null
}

/**
 * v1.81.0 — success path now calls `redirect()` server-side; the resolved
 * payload exists ONLY for the error path (`ok: false`). Existing tests
 * pinning `{ ok: true, playerId, mode }` are updated in v181_*.
 */
export type ApplyToLeagueResult =
  | { ok: true; playerId: string; mode: 'fresh' | 'existing' }
  | { ok: false; error: string }

export async function applyToLeague(
  input: ApplyToLeagueInput,
): Promise<ApplyToLeagueResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, error: 'Sign in required' }
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const lineId = session.lineId || null
  if (!userId && !lineId) {
    // Neither identifier resolves to a User row (admin-credentials
    // shared-password sessions, transient pre-adapter state). Neutral
    // copy — admin role is orthogonal to user-facing apply.
    return { ok: false, error: 'Sign in with a player account to apply' }
  }

  // Verify the league exists and accepts applications.
  // v1.81.0 — `subdomain` for success-redirect fallback.
  // v1.82.0 — `ballType` for position-vocab validation.
  // v1.84.0 — gate flips from `recruiting` to `visibility`. Only PRIVATE
  // rejects; PUBLIC_CLOSED accepts via direct link.
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, visibility: true, name: true, subdomain: true, ballType: true },
  })
  if (!league) {
    return { ok: false, error: 'League not found' }
  }
  if (league.visibility === 'PRIVATE') {
    return {
      ok: false,
      error: 'This league is private — you need an invite to join',
    }
  }
  // v1.81.0 — origin-path fallback: the league's own subdomain page is
  // the natural landing for the success popup when the caller didn't
  // capture `originPath` (or when validation rejected it).
  const fallbackPath = `/id/${league.subdomain ?? DEFAULT_LEAGUE_SLUG}`

  // v1.82.0 — validate positions against the league's vocabulary.
  // `normalizePositions` throws on cross-format codes (e.g. FW in a
  // FUTSAL league); surface that as an `ok: false` error so the modal
  // shows the message rather than a generic 500.
  let validatedPositions: string[]
  try {
    validatedPositions = normalizePositions(
      input.positions,
      league.ballType as BallType | null,
    )
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid position(s)',
    }
  }
  const legacyPosition = legacyPositionFromArray(validatedPositions)

  // v1.80.10 — resolve the calling User row by `userId` first (canonical
  // post-α.5 / v1.27.0 binding), falling back to `lineId` (legacy
  // pre-v1.28.0 LINE sessions; LINE-auth admins whose role is orthogonal
  // to player binding). Both identifiers are minted by the auth server,
  // so either is a safe lookup key. Mirrors the v1.59.1 pattern in
  // `account/player/actions.ts`.
  let user: { id: string; playerId: string | null; lineId: string | null } | null = null
  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, playerId: true, lineId: true },
    })
  }
  if (!user && lineId) {
    user = await prisma.user.findUnique({
      where: { lineId },
      select: { id: true, playerId: true, lineId: true },
    })
  }
  if (!user) {
    return { ok: false, error: 'User not found' }
  }

  // ── State D — multi-league application path ──────────────────────────
  if (user.playerId) {
    const existingPlayerId = user.playerId

    // Idempotency guard — if the user already has a PLM in this league
    // (PENDING or APPROVED), don't create a duplicate. PENDING returns
    // ok with the existing playerId (banner re-renders to State B).
    const existingPlm = await prisma.playerLeagueMembership.findFirst({
      where: { playerId: existingPlayerId, leagueId: league.id },
      select: { id: true, applicationStatus: true },
    })
    if (existingPlm) {
      // Either APPROVED (already a member; admin should reject silently
      // since the user is in State A from the banner's perspective) or
      // PENDING (no-op double-submit). Both treat as success.
      // v1.81.0 — redirect to <originPath>?submitted=applyToLeague.
      redirect(buildSuccessRedirect(input.originPath, 'applyToLeague', fallbackPath))
    }

    // Create a new PLM(PENDING) for the existing Player in the new
    // league. leagueTeamId stays null until admin assigns a team on
    // approval. **Do not touch Player.applicationStatus** — it's a
    // global field; v1.65.4 drops it. Per-league truth lives on the
    // new PLM.
    await prisma.playerLeagueMembership.create({
      data: {
        playerId: existingPlayerId,
        leagueTeamId: null,
        leagueId: league.id,
        fromGameWeek: 1,
        applicationStatus: 'PENDING',
        // v1.82.0 — dual-write positions[] + legacy enum.
        positions: validatedPositions,
        position: legacyPosition,
        joinSource: 'SELF_SERVE',
        onboardingStatus: 'NOT_YET',
      },
    })

    revalidate({
      domain: 'admin',
      paths: [`/admin/leagues/${league.id}/players`],
    })
    revalidate({ domain: 'public' })

    // v1.81.0 — redirect server-side so the NEXT_REDIRECT signal
    // propagates through useTransition (mirrors v1.77.1 fix in
    // registerToLeague). The originPath fallback to `/id/<subdomain>`
    // matches the page that hosts the recruiting banner / modal.
    redirect(buildSuccessRedirect(input.originPath, 'applyToLeague', fallbackPath))
  }

  // ── State C — fresh Player + dual-write the User binding ─────────────
  const trimmedName = input.name.trim()
  if (!trimmedName) {
    return { ok: false, error: 'Your name is required' }
  }
  if (trimmedName.length > 100) {
    return { ok: false, error: 'Name must be 100 characters or fewer' }
  }

  // v1.65.4 — legacy `Player.applicationStatus` + `Player.applicationLeagueId`
  // are dropped from the schema. Position now lives only on the PLM. The
  // Player row is purely identity (name + lineId/userId + profile picture).
  const player = await prisma.$transaction(async (tx) => {
    const created = await tx.player.create({
      data: {
        name: trimmedName,
        userId: user.id,
        // Set Player.lineId for LINE users so the legacy resolver path
        // works through stage 3 (γ). Google/email users have lineId null.
        lineId: user.lineId ?? null,
      },
    })
    await tx.user.update({
      where: { id: user.id },
      // v1.72.0 — User.name = Player.name when linking.
      data: { playerId: created.id, name: trimmedName },
    })
    // v1.65.1 — PLM(PENDING) for this league is the canonical source of
    // truth (v1.65.4 drops the legacy Player.* fields).
    await tx.playerLeagueMembership.create({
      data: {
        playerId: created.id,
        leagueTeamId: null,
        leagueId: league.id,
        fromGameWeek: 1,
        applicationStatus: 'PENDING',
        // v1.82.0 — dual-write positions[] + legacy enum.
        positions: validatedPositions,
        position: legacyPosition,
        joinSource: 'SELF_SERVE',
        onboardingStatus: 'NOT_YET',
      },
    })
    return created
  })

  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${league.id}/players`],
  })
  revalidate({ domain: 'public' })

  // v1.81.0 — redirect server-side. `redirect()` throws and never
  // returns; the unreachable return below satisfies the function's
  // declared return type.
  redirect(buildSuccessRedirect(input.originPath, 'applyToLeague', fallbackPath))
  // unreachable — satisfies TypeScript's return-type check:
  return { ok: true, playerId: player.id, mode: 'fresh' }
}

/**
 * v1.67.2 — `recruitToLeagueWithOnboarding` removed.
 *
 * Pre-v1.67.2 this action created a synthetic PERSONAL `LeagueInvite`
 * with `usedCount = maxUses = 1` (pre-redeemed) plus an empty Player +
 * PLM(PENDING) all in one transaction, then routed the user to
 * `/join/<code>` expecting the page's existingBinding-detection branch
 * to forward them to `/onboarding`. Two bugs:
 *   1. `validateInvite` rejects `usedCount >= maxUses` as `'used-up'`
 *      BEFORE the existingBinding branch can fire — every State C
 *      user landed on "This invite has been used."
 *   2. The empty Player + PLM rows persisted regardless, leaving
 *      orphan PENDING applications in the admin view.
 *
 * v1.67.2 design: NO synthetic invite. NO Player or PLM upfront. The
 * State C CTA navigates to the new `/recruit/<slug>` route, which
 * renders an empty form. On submit, the existing `applyToLeague`
 * action (above) creates Player + PLM(PENDING) atomically with all
 * the data the user actually filled in. Same atomicity contract as
 * admin invites without any invite gymnastics.
 *
 * Operator follow-up: orphan rows from the v1.67.0 → v1.67.2 window
 * need a one-time cleanup pass. Surface in the PR description.
 */

/**
 * v1.68.0 — single-page registration with ID + optional profile picture.
 *
 * v1.71.1 — files now upload client-direct to Vercel Blob via
 * `@vercel/blob/client#upload`; this action receives the resulting
 * URLs (a few KB) instead of FormData multipart. Pre-v1.71.1 the
 * action ran `put` server-side after receiving the binary, but the
 * Vercel platform itself caps serverless function request bodies at
 * ~4.5MB and rejected oversize uploads at the edge with HTTP 413
 * (FUNCTION_PAYLOAD_TOO_LARGE) BEFORE the function ran — making the
 * v1.62.0 → v1.69.1 `bodySizeLimit` chain ineffective for any
 * iPhone-camera ID image.
 *
 * Defense in depth: the upload-token route at
 * `/api/blob/upload-token` gates on session.userId + pathname prefix,
 * and this action re-validates the URLs land under the user's own
 * `register-pending/<userId>/` Blob prefix via `isOwnedBlobUrl`.
 *
 * Validation gates (all run before the DB transaction):
 *   - Sign in required (rejects no-session)
 *   - v1.80.10 — admin-orthogonal-UX rule: gate accepts userId OR
 *     lineId fallback (User.lineId @unique). Admin role is NOT a gate.
 *     Sessions with neither identifier (admin-credentials shared-
 *     password) get a neutral message.
 *   - leagueId required + League must exist + recruiting
 *   - Trimmed name required (≤100 chars)
 *   - All three URLs (when present) must hostname under
 *     `*.public.blob.vercel-storage.com` AND pathname under
 *     `/register-pending/<userId>/`
 *   - User must NOT already have a Player binding (recruit is the
 *     fresh-Player path; State D users redirect at the route layer)
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_MAX_LENGTH = 254

export interface RegisterToLeagueInput {
  leagueId: string
  name: string
  /**
   * v1.78.0 — required. Validated server-side (regex + ≤254 chars).
   * Conditionally written to `User.email` only if the User row's email
   * is currently null. Existing verified emails are NOT overwritten so
   * a user who already authenticated via Google/email-magic-link keeps
   * their verified address. The `@unique` constraint on `User.email`
   * may surface a Prisma `P2002` if the submitted address belongs to a
   * different User; that surfaces as a friendly error.
   */
  email: string
  /**
   * v1.82.0 — multi-position. Validated server-side against the
   * league's `ballType` vocabulary.
   */
  positions?: ReadonlyArray<string>
  idFrontUrl: string
  idBackUrl: string
  profilePictureUrl?: string | null
  /** v1.80.0 — optional free-text comments for the admin. Trimmed before storage. */
  comments?: string | null
  /**
   * v1.81.0 — origin-path tracking for the success popup. Captured at
   * form-mount time on `/recruit/<slug>` and used to redirect to
   * `<originPath>?submitted=registerToLeague`. The `/recruit/<slug>`
   * page itself short-circuits a now-bound user back to `/id/<slug>`
   * (the route-level guard at [src/app/recruit/[slug]/page.tsx]:
   * `if (user.playerId) redirect(...)` ), so the originating-page
   * popup pattern relies on the originPath being the league page or a
   * page that doesn't bounce. The form passes `/id/<slug>` directly.
   */
  originPath?: string | null
}

export async function registerToLeague(
  input: RegisterToLeagueInput,
): Promise<ApplyToLeagueResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, error: 'Sign in required' }
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const lineId = session.lineId || null
  if (!userId && !lineId) {
    // Neither identifier resolves to a User row. Neutral copy — admin
    // role is orthogonal to user-facing apply per the standing rule.
    return { ok: false, error: 'Sign in with a player account to apply' }
  }

  if (!input.leagueId) {
    return { ok: false, error: 'Missing leagueId' }
  }
  const trimmedName = input.name.trim()
  if (!trimmedName) {
    return { ok: false, error: 'Your name is required' }
  }
  if (trimmedName.length > 100) {
    return { ok: false, error: 'Name must be 100 characters or fewer' }
  }

  // v1.78.0 — email is required. Trimmed + lowercased before validation
  // and storage so case differences don't bypass the unique constraint.
  const trimmedEmail = input.email.trim().toLowerCase()
  if (!trimmedEmail) {
    return { ok: false, error: 'Email is required' }
  }
  if (trimmedEmail.length > EMAIL_MAX_LENGTH) {
    return { ok: false, error: 'Email is too long' }
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return { ok: false, error: 'Please enter a valid email address' }
  }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    // v1.82.0 — also pulls `ballType` for position-vocabulary validation.
    // v1.84.0 — gates on `visibility`; see `applyToLeague` for the rationale.
    select: { id: true, visibility: true, name: true, subdomain: true, ballType: true },
  })
  if (!league) return { ok: false, error: 'League not found' }
  if (league.visibility === 'PRIVATE') {
    return {
      ok: false,
      error: 'This league is private — you need an invite to join',
    }
  }

  // v1.82.0 — validate positions against the league's vocabulary.
  let validatedPositions: string[]
  try {
    validatedPositions = normalizePositions(
      input.positions,
      league.ballType as BallType | null,
    )
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid position(s)',
    }
  }
  const legacyPosition = legacyPositionFromArray(validatedPositions)

  // v1.80.10 — resolve User row by `userId` first, falling back to
  // `lineId` (User.lineId @unique). Mirrors the v1.59.1 pattern in
  // `account/player/actions.ts` so legacy LINE sessions and LINE-auth
  // admins flow through identically.
  let user: { id: string; playerId: string | null; lineId: string | null; email: string | null } | null = null
  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, playerId: true, lineId: true, email: true },
    })
  }
  if (!user && lineId) {
    user = await prisma.user.findUnique({
      where: { lineId },
      select: { id: true, playerId: true, lineId: true, email: true },
    })
  }
  if (!user) return { ok: false, error: 'User not found' }
  if (user.playerId) {
    return {
      ok: false,
      error: 'You already have a player. Use the apply button on the league page.',
    }
  }

  // Defense in depth: the URLs must live under the user's own
  // register-pending prefix on Vercel Blob. The token route gated the
  // PUT keyed on the SAME canonical User.id we just resolved here.
  const expectedPrefix = `/register-pending/${user.id}/`
  if (!isOwnedBlobUrl(input.idFrontUrl, expectedPrefix)) {
    return { ok: false, error: 'Front of ID is required' }
  }
  if (!isOwnedBlobUrl(input.idBackUrl, expectedPrefix)) {
    return { ok: false, error: 'Back of ID is required' }
  }
  if (input.profilePictureUrl && !isOwnedBlobUrl(input.profilePictureUrl, expectedPrefix)) {
    return { ok: false, error: 'profilePictureUrl is not yours' }
  }

  // v1.78.0 — only WRITE the submitted email if `User.email` is currently
  // null. If the User already has a verified email (Google or magic-link
  // sign-in), we don't silently overwrite it; the user can edit it via
  // a separate self-service surface in a follow-up. Submitting a
  // different address than the one already on file is harmless — we
  // just keep the verified one.
  const shouldWriteEmail = !user.email

  // Atomic transaction: Player + User.playerId mirror + PLM(PENDING)
  // with every URL populated up-front. Onboarding is COMPLETE — the
  // user filled everything in one shot, no follow-up step.
  // v1.70.0 — ID images move to User; profile picture stays on Player.
  let player: { id: string }
  try {
    player = await prisma.$transaction(async (tx) => {
      const created = await tx.player.create({
        data: {
          name: trimmedName,
          userId: user.id,
          lineId: user.lineId ?? null,
          profilePictureUrl: input.profilePictureUrl ?? null,
        },
      })
      await tx.user.update({
        where: { id: user.id },
        data: {
          playerId: created.id,
          // v1.72.0 — User.name = Player.name when linking.
          name: trimmedName,
          idFrontUrl: input.idFrontUrl,
          idBackUrl: input.idBackUrl,
          idUploadedAt: new Date(),
          // v1.78.0 — conditionally write email; do not overwrite a
          // pre-existing verified address.
          ...(shouldWriteEmail ? { email: trimmedEmail } : {}),
        },
      })
      await tx.playerLeagueMembership.create({
        data: {
          playerId: created.id,
          leagueTeamId: null,
          leagueId: league.id,
          fromGameWeek: 1,
          applicationStatus: 'PENDING',
          // v1.82.0 — dual-write positions[] + legacy enum.
          positions: validatedPositions,
          position: legacyPosition,
          joinSource: 'SELF_SERVE',
          onboardingStatus: 'COMPLETED',
          // v1.80.0 — persist trimmed comments; null when blank/omitted.
          comments: input.comments?.trim() || null,
        },
      })
      return created
    })
  } catch (err) {
    // v1.78.0 — Prisma P2002 = unique-constraint violation. With this
    // PR the only newly-introduced unique field on the write path is
    // `User.email`; surface a friendly error so the user knows the
    // submitted email is already linked to a different account.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return {
        ok: false,
        error: 'This email is already linked to another account. Sign in with that account, or use a different email.',
      }
    }
    throw err
  }

  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${league.id}/players`],
  })
  revalidate({ domain: 'public' })

  // v1.79.0 — fire-and-forget application-received email. Queued via
  // `waitUntil` so SMTP latency stays off the response critical path; a
  // failure here MUST NOT block the redirect. `sendMail` resolves a
  // discriminated result rather than throwing, so swallow on error and
  // log so operators can grep for `[v1.79.0 EMAIL]`.
  waitUntil(
    sendMail({
      to: trimmedEmail,
      ...applicationReceivedEmail({
        leagueName: league.name,
        playerName: trimmedName,
      }),
    }).then((result) => {
      if (result.status !== 'sent') {
        console.error(
          '[v1.79.0 EMAIL] kind=applicant-received path=registerToLeague status=%s reason=%s',
          result.status,
          result.reason,
        )
      }
    }),
  )

  // v1.77.1 — redirect server-side so the NEXT_REDIRECT signal propagates
  // through useTransition even when iOS Safari backgrounds the tab mid-flight.
  // `redirect()` throws and is never returned from; the line below is unreachable.
  // v1.81.0 — append `?submitted=registerToLeague` so the destination
  // mounts the success popup; safe origin defaults to the league page.
  const fallbackPath = `/id/${league.subdomain ?? DEFAULT_LEAGUE_SLUG}`
  redirect(buildSuccessRedirect(input.originPath, 'registerToLeague', fallbackPath))
  // unreachable — satisfies TypeScript's return-type check:
  return { ok: true, playerId: player.id, mode: 'fresh' }
}

function isOwnedBlobUrl(url: string, expectedPrefix: string): boolean {
  // Vercel Blob URLs are of the form
  //   https://<storeId>.public.blob.vercel-storage.com/<pathname>
  // The pathname must include the user's expected prefix.
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('.public.blob.vercel-storage.com')) return false
    return u.pathname.includes(expectedPrefix)
  } catch {
    return false
  }
}
