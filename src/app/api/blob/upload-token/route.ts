import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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
 * Authorization model:
 *   - Session must carry `userId` (LINE / Google / email; NOT admin
 *     credentials, which have no User row).
 *   - Pathname must be one of:
 *       register-pending/<userId>/...       (user-initiated registration)
 *       player-id/<playerId>/(front|back)-* (admin-invite onboarding ID)
 *       player-profile/<playerId>/...        (admin-invite onboarding picture)
 *   - We do NOT authoritatively validate playerId ownership at token-
 *     issue time — that's a Prisma round-trip and would slow the
 *     critical path. The server action that consumes the URL re-
 *     validates the bound Player ↔ User pairing before writing to DB,
 *     and refuses URLs whose pathname doesn't match the expected
 *     prefix (defense in depth via `isOwnedBlobUrl`).
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
const ID_MAX_BYTES = 8 * 1024 * 1024
const PIC_MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  const userId = (session as { userId?: string | null } | null)?.userId ?? null
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const isRegisterPending = pathname.startsWith(`register-pending/${userId}/`)
        const isPlayerId = /^player-id\/[^/]+\/(front|back)-\d+\./.test(pathname)
        const isPlayerProfile = /^player-profile\/[^/]+\/\d+\./.test(pathname)
        if (!isRegisterPending && !isPlayerId && !isPlayerProfile) {
          throw new Error('Pathname not allowed for this user')
        }
        const isPic =
          pathname.includes('/profile-') || pathname.startsWith('player-profile/')
        return {
          allowedContentTypes: isPic ? PIC_CONTENT_TYPES : ID_CONTENT_TYPES,
          maximumSizeInBytes: isPic ? PIC_MAX_BYTES : ID_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
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
