import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * v1.71.1 — Presigned upload-token route for client-direct Vercel Blob uploads.
 *
 * Why this exists: the v1.62.0 → v1.69.1 chain bumped Next.js's
 * `experimental.serverActions.bodySizeLimit` from 1mb → 6mb → 25mb to
 * accommodate /recruit/[slug] + /join/[code]/onboarding submissions
 * carrying up to 21MB of ID + profile-picture data. That setting is
 * INEFFECTIVE on Vercel: the Vercel platform itself caps serverless
 * function request bodies at ~4.5MB and rejects oversize requests at
 * the edge with HTTP 413 (FUNCTION_PAYLOAD_TOO_LARGE) BEFORE the
 * request ever reaches the Next.js function. Empirical confirmation
 * (2026-05-07): 4MB POST → 500 (function reached); 5MB+ POST → 413.
 *
 * v1.71.1 fix: switch ID + profile-picture uploads from server-side
 * `put` (FormData blob in the request body of a server action) to
 * client-side direct-to-Blob uploads via `@vercel/blob/client#upload`.
 * The browser PUTs each file straight to Vercel Blob storage; only the
 * resulting URLs (a few KB) reach the server action. This route issues
 * the short-lived presigned token the client needs.
 *
 * v1.74.0 — added the `team-logo/<teamId>/...` prefix for the redesigned
 * `/admin/teams-all` surface. Admin-only (admin sessions are gated by
 * `session.isAdmin`, NOT `userId` — admin-credentials sessions have no
 * User row); SVG is allowed in addition to JPEG/PNG/WEBP for vector logos.
 *
 * Authorization model:
 *   - For `register-pending/`, `player-id/`, `player-profile/` paths:
 *       session must resolve to a User row. v1.80.10 — resolution is
 *       `userId` first, falling back to `lineId` (User.lineId @unique).
 *       This mirrors the v1.59.1 fallback pattern in
 *       `account/player/actions.ts`: legacy LINE sessions and LINE-auth
 *       admins (whose admin role is orthogonal per
 *       docs/admin-orthogonal-ux.md) flow through identically. The
 *       admin-credentials shared-password sessions still have neither
 *       identifier and are still rejected.
 *   - For `team-logo/` paths:
 *       session must carry `isAdmin: true`.
 *   - We do NOT authoritatively validate playerId/teamId ownership at
 *     token-issue time — that's a Prisma round-trip and would slow the
 *     critical path. The server action that consumes the URL re-
 *     validates the bound Player ↔ User pairing (or admin role) before
 *     writing to DB, and refuses URLs whose pathname doesn't match the
 *     expected prefix (defense in depth via `isOwnedBlobUrl` /
 *     `isOwnedTeamLogoUrl`).
 *   - Content-type and size limits are enforced via
 *     `allowedContentTypes` + `maximumSizeInBytes`; Vercel Blob rejects
 *     oversize uploads at the storage layer.
 */

const ID_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'image/heif',
  'application/pdf',
]
const PIC_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const TEAM_LOGO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const ID_MAX_BYTES = 8 * 1024 * 1024
const PIC_MAX_BYTES = 5 * 1024 * 1024
const TEAM_LOGO_MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  const sessionUserId = (session as { userId?: string | null } | null)?.userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const lineId = (session as { lineId?: string | null } | null)?.lineId || null
  const isAdmin = (session as { isAdmin?: boolean } | null)?.isAdmin ?? false

  // v1.80.10 — resolve canonical User.id by `userId` first, falling back
  // to `lineId` (User.lineId @unique). Mirrors the action-layer fix in
  // `applyToLeague`/`registerToLeague`. Admin-credentials sessions still
  // have neither identifier and are caught below.
  let resolvedUserId: string | null = sessionUserId
  if (!resolvedUserId && lineId) {
    const user = await prisma.user.findUnique({
      where: { lineId },
      select: { id: true },
    })
    resolvedUserId = user?.id ?? null
  }

  if (!resolvedUserId && !isAdmin) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const isTeamLogo = /^team-logo\/[^/]+\//.test(pathname)
        if (isTeamLogo) {
          if (!isAdmin) {
            throw new Error('Admin role required for team-logo uploads')
          }
          return {
            allowedContentTypes: TEAM_LOGO_CONTENT_TYPES,
            maximumSizeInBytes: TEAM_LOGO_MAX_BYTES,
            addRandomSuffix: false,
            allowOverwrite: true,
          }
        }

        if (!resolvedUserId) {
          throw new Error('Sign in required')
        }

        const isRegisterPending = pathname.startsWith(`register-pending/${resolvedUserId}/`)
        const isPlayerId = /^player-id\/[^/]+\/(front|back)-\d+\./.test(pathname)
        const isPlayerProfile = /^player-profile\/[^/]+\/\d+\./.test(pathname)
        if (!isRegisterPending && !isPlayerId && !isPlayerProfile) {
          throw new Error('Pathname not allowed for this user')
        }
        const isPic =
          pathname.includes('/profile-') || pathname.startsWith('player-profile/')
        // v2.2.8 — ID uploads (`isPlayerId`) get `addRandomSuffix: true` so
        // the Blob path is not guessable from playerId + timestamp. Reads
        // route through the authenticated proxy at
        // `/api/admin/id-image/[userId]/[side]`. Profile pictures stay at
        // stable paths because they're intentionally public on the player
        // avatar in the UI.
        return {
          allowedContentTypes: isPic ? PIC_CONTENT_TYPES : ID_CONTENT_TYPES,
          maximumSizeInBytes: isPic ? PIC_MAX_BYTES : ID_MAX_BYTES,
          addRandomSuffix: isPlayerId ? true : false,
          allowOverwrite: !isPlayerId,
        }
      },
      onUploadCompleted: async () => {
        // No DB write here — the form's server action does it after submit.
      },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload token failed' },
      { status: 400 },
    )
  }
}
