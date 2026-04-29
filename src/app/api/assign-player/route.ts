import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { authOptions } from "@/lib/auth";
import { put } from "@vercel/blob";
import { getPlayerByPublicId } from "@/lib/publicData";
import { prisma } from "@/lib/prisma";
import { setMappingOrThrow } from "@/lib/playerMappingStore";
import { playerIdToSlug, slugToPlayerId } from "@/lib/ids";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Best-effort cleanup of the legacy Redis line-player-map hash. PR 6 cut the
// canonical mapping over to Prisma (Player.lineId), but the auth fallback in
// lib/auth.ts still consults Redis for any LINE user whose backfill row is
// missing. Removing the legacy entry on (re)assignment / unassignment keeps
// the two stores from diverging during the deprecation window. Failure is
// non-fatal — the Prisma write is the source of truth.
async function legacyRedisCleanup(
  lineId: string,
  ops: { dropMapping?: boolean; dropPic?: string },
): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    if (ops.dropMapping) await redis.hdel("line-player-map", lineId);
    if (ops.dropPic) await redis.del(`player-pic:${ops.dropPic}`);
  } catch (err) {
    console.warn("[assign-player] legacyRedisCleanup failed: %o", err);
  }
}

// Mirror the LINE profile picture into Vercel Blob and persist the resulting
// public URL to Player.pictureUrl + the legacy Redis key. PR 12 / v1.3.1
// scheduled this off the response critical path: pre-fix this whole chain
// (LINE CDN fetch + Blob put + Redis SET) ran serially before the route
// returned, costing 200–500ms warm and meaningfully more cold. Now it runs
// after the response is sent, via waitUntil. The destination renders with a
// fallback avatar (PlayerAvatar's chain handles missing pictureUrl
// gracefully) until this completes — typically <1s in the background — at
// which point revalidateTag('public-data') busts the page cache and the
// real picture appears on the next render. Failure is non-fatal: the link
// itself is already persisted.
async function uploadAndPersistLinePic(args: {
  dbPlayerId: string;
  publicPlayerId: string;
  playerName: string;
  lineUrl: string;
}): Promise<void> {
  const { dbPlayerId, publicPlayerId, playerName, lineUrl } = args;
  try {
    const picResponse = await fetch(lineUrl);
    if (!picResponse.ok) return;
    const blob = await picResponse.blob();
    const { url } = await put(`player-pics/${slugify(playerName)}`, blob, {
      access: "public",
      addRandomSuffix: false,
    });

    await prisma.player.update({
      where: { id: dbPlayerId },
      data: { pictureUrl: url },
    });

    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN,
        });
        await redis.set(`player-pic:${publicPlayerId}`, url);
      } catch {
        /* non-fatal */
      }
    }

    // Bust the public-data cache so the page renders with the new URL on the
    // next request instead of waiting up to 30s for unstable_cache to expire.
    revalidateTag("public-data", { expire: 0 });
  } catch (err) {
    console.warn("[assign-player] background pic upload failed: %o", err);
  }
}

// v1.8.0 — durable backup write for /assign-player POST.
//
// Pre-v1.8.0 the Prisma transaction blocked the response (~1–3s on cold
// Neon plus cold-lambda overhead — the bulk of the user-perceived link
// latency). v1.8.0 inverts the write path: Redis (`setMappingOrThrow`) is
// the canonical store written synchronously, and this function runs in
// `waitUntil` so the response can return as soon as the Redis write lands.
//
// The Prisma transaction here is the durable secondary that backs admin
// queries (e.g. PR 14/15's linked-players picker filter) and the recovery
// script. On failure we emit a `[v1.8.0 DRIFT]` log line carrying the
// lineId + dbPlayerId so operators can grep Vercel logs and replay via
// `scripts/auditRedisVsPrisma.ts --repair-prisma`.
async function persistAssignmentToPrisma(args: {
  lineId: string;
  dbPlayerId: string;
}): Promise<void> {
  const { lineId, dbPlayerId } = args;
  try {
    // Atomic: clear lineId from any other Player that currently holds it
    // (collision-safe because lineId is @unique), then set on target. The
    // updateMany makes the no-op case (no other holder) a clean no-throw.
    await prisma.$transaction([
      prisma.player.updateMany({
        where: { lineId, id: { not: dbPlayerId } },
        data: { lineId: null },
      }),
      prisma.player.update({
        where: { id: dbPlayerId },
        data: { lineId },
      }),
    ]);
    // Best-effort legacy-hash cleanup; was already non-fatal pre-v1.8.0.
    await legacyRedisCleanup(lineId, { dropMapping: true });
  } catch (err) {
    console.error(
      "[v1.8.0 DRIFT] kind=playerMapping op=link lineId=%s dbPlayerId=%s err=%o",
      lineId,
      dbPlayerId,
      err,
    );
  }
}

// v1.8.0 — durable backup write for /assign-player DELETE.
//
// Same framing as `persistAssignmentToPrisma`: Redis (`setMappingOrThrow`
// with the null sentinel) is canonical and written synchronously; this
// runs in `waitUntil` to clear the durable Prisma row off the critical
// path. Drift on Prisma failure is logged and recoverable via the audit
// script.
async function persistUnassignmentToPrisma(lineId: string): Promise<void> {
  try {
    const current = await prisma.player.findUnique({
      where: { lineId },
      select: { id: true },
    });
    let unlinkedSlug: string | null = null;
    if (current) {
      unlinkedSlug = playerIdToSlug(current.id);
      await prisma.player.update({
        where: { id: current.id },
        data: { lineId: null },
      });
    }
    await legacyRedisCleanup(lineId, {
      dropMapping: true,
      ...(unlinkedSlug ? { dropPic: unlinkedSlug } : {}),
    });
  } catch (err) {
    console.error(
      "[v1.8.0 DRIFT] kind=playerMapping op=unlink lineId=%s err=%o",
      lineId,
      err,
    );
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.lineId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { playerId } = (body ?? {}) as { playerId?: string };

  if (!playerId || typeof playerId !== "string") {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }

  // Validate the player exists in the public roster (works for both Sheets
  // and DB data sources). The public id is a slug; DB Player.id is the same
  // slug carrying a "p-" prefix. v1.8.2 — uses `getPlayerByPublicId` instead
  // of the full `getPublicLeagueData()` so the validation skips the
  // (uncached) RSVP merge fanout — that read is load-bearing for dashboard
  // renders but pure overhead for write-path validation.
  const player = await getPlayerByPublicId(playerId);

  if (!player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const playerName = player.name;
  const teamId = player.teamId;
  const dbPlayerId = slugToPlayerId(playerId);

  // ── Synchronous canonical write: Redis ──────────────────────────────────
  // v1.8.0: Redis is the canonical store consulted by the JWT callback on
  // every authenticated request. Writing it synchronously here means the
  // user's next /api/auth/session (via `await update()` on the client) sees
  // the new mapping immediately — no Prisma round-trip on the read path.
  // Throwing variant: silent failure here would leave both stores empty
  // after the response, since the Prisma write is deferred below.
  try {
    await setMappingOrThrow(session.lineId, { playerId, playerName, teamId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ── Deferred durable write: Prisma transaction (background) ─────────────
  // The atomic clear-then-set runs in waitUntil. On failure the catch in
  // `persistAssignmentToPrisma` emits a `[v1.8.0 DRIFT]` log line; operator
  // recovery via `scripts/auditRedisVsPrisma.ts --repair-prisma`.
  waitUntil(persistAssignmentToPrisma({ lineId: session.lineId, dbPlayerId }));

  // ── Deferred picture mirror (independent of Prisma) ─────────────────────
  // PR 12 already moved this off the critical path. Kept independent of the
  // Prisma waitUntil above so a Prisma failure doesn't tank the picture
  // mirror and vice versa. The picture-upload path runs its own
  // `revalidateTag('public-data')` once the Blob URL lands so the new avatar
  // appears on the next dashboard render.
  if (session.linePictureUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    waitUntil(
      uploadAndPersistLinePic({
        dbPlayerId,
        publicPlayerId: playerId,
        playerName,
        lineUrl: session.linePictureUrl,
      }),
    );
  }

  // v1.8.2 — no `revalidatePath('/')` / `revalidateTag('public-data')` here.
  // The link state is owned by the JWT (refreshed via next-auth `update()`
  // on the client) and Redis (canonical store consulted by `getPlayerMapping`
  // on the next session read). Neither flows through the static `public-data`
  // cache, so busting it would only force a needless re-derivation on the
  // user's next `/` render. Mirrors v1.7.0's drop of these calls from
  // `/api/rsvp` for the same reason. The picture mirror handles its own
  // revalidate above when it actually has new data to expose.
  return NextResponse.json({ ok: true, playerId, playerName, teamId });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);

  if (!session?.lineId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // ── Synchronous canonical write: Redis (null sentinel) ──────────────────
  // The user's next session refresh reads `null` from Redis directly —
  // orphan state served without a Prisma round-trip.
  try {
    await setMappingOrThrow(session.lineId, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ── Deferred durable write: clear Prisma Player.lineId (background) ─────
  waitUntil(persistUnassignmentToPrisma(session.lineId));

  // v1.8.2 — see POST handler above for the rationale on dropping the
  // public-data revalidation. Same shape applies on unlink.
  return NextResponse.json({ ok: true });
}
