import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * v2.2.8 — authenticated proxy for player ID images.
 *
 * Closes three findings from the 2026-05 ID-storage audit:
 *   C1: ID Blobs were `access: 'public'` with non-random paths — the URL
 *       was the only secret and was effectively brute-forceable.
 *   C2: `PlayerLeagueMembership.idShared` consent flag existed in the
 *       schema but was never enforced; the consent model was decorative.
 *   H1: Admin UI rendered `<img src={publicBlobUrl}>` directly, leaking
 *       the bearer-URL into browser history, referrer headers, devtools,
 *       network logs, and any future analytics/CDN logs.
 *
 * Behavior:
 *   - admin-gated (`session.isAdmin`); non-admin → 403; anonymous → 401
 *   - looks up `User.idFrontUrl` / `User.idBackUrl` for `userId`
 *   - enforces consent: requires at least one of the bound player's
 *     `PlayerLeagueMembership` rows to have `idShared=true`. Admins in
 *     this project are global (no per-league scoping), so any granted
 *     consent on any of the player's memberships is sufficient. Players
 *     with no PLMs (or all `idShared=false`) → 403 + `consent_not_granted`.
 *   - fetches the bytes from Vercel Blob server-side and streams them
 *     back with `Cache-Control: private, no-store` (the response carries
 *     PII, must never be cached in shared caches or the browser disk
 *     cache).
 *
 * Random-suffixed Blob URLs (the v2.2.8 upload hardening) + this proxy
 * together replace the previous bearer-URL exposure.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ userId: string; side: string }> },
) {
  const { userId, side } = await ctx.params

  if (side !== 'front' && side !== 'back') {
    return NextResponse.json({ error: 'invalid_side' }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      idFrontUrl: true,
      idBackUrl: true,
      playerId: true,
      // v2.2.15 — externally-attested users have no Blob URL on file
      // (the operator holds the original out of band). Return a
      // distinct 404 shape so the admin UI can surface "stored
      // externally — see notes" instead of a broken image.
      idCollectedExternally: true,
      idCollectedExternallyNotes: true,
    },
  })
  if (!user) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const url = side === 'front' ? user.idFrontUrl : user.idBackUrl
  if (!url) {
    // v2.2.15 — distinguish "ID held externally" from "no ID on file
    // at all" so the admin UI renders a useful surface for the former.
    if (user.idCollectedExternally) {
      return NextResponse.json(
        {
          error: 'external_id',
          notes: user.idCollectedExternallyNotes,
        },
        { status: 404 },
      )
    }
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Consent check — at least one PLM with idShared=true on the bound
  // player. If the User has no Player (orphan ID upload, shouldn't
  // happen post-v1.70 but be defensive) treat as no consent.
  if (!user.playerId) {
    return NextResponse.json({ error: 'consent_not_granted' }, { status: 403 })
  }
  const consented = await prisma.playerLeagueMembership.findFirst({
    where: { playerId: user.playerId, idShared: true },
    select: { id: true },
  })
  if (!consented) {
    return NextResponse.json({ error: 'consent_not_granted' }, { status: 403 })
  }

  const blobRes = await fetch(url)
  if (!blobRes.ok || !blobRes.body) {
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 })
  }

  const contentType = blobRes.headers.get('content-type') ?? 'application/octet-stream'
  return new NextResponse(blobRes.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
    },
  })
}
