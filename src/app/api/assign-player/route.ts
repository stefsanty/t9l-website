import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { authOptions } from "@/lib/auth";
import { put } from "@vercel/blob";
import { getPublicLeagueData } from "@/lib/publicData";
import { prisma } from "@/lib/prisma";
import { setMapping } from "@/lib/playerMappingStore";

const PLAYER_ID_PREFIX = "p-";

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
  // slug carrying a "p-" prefix.
  const data = await getPublicLeagueData();
  const player = data.players.find((p) => p.id === playerId);

  if (!player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const playerName = player.name;
  const teamId = player.teamId;
  const dbPlayerId = `${PLAYER_ID_PREFIX}${playerId}`;

  // Atomic Prisma write: clear lineId from any other Player that currently
  // holds it (collision-safe because lineId is @unique), then set on target.
  // Use updateMany for the clear so a no-op (no other holder) doesn't throw.
  // pictureUrl is intentionally NOT set here — the LINE-CDN-fetch + Blob put
  // is scheduled below via waitUntil and persists the URL out of band, off
  // the response critical path.
  try {
    await prisma.$transaction([
      prisma.player.updateMany({
        where: { lineId: session.lineId, id: { not: dbPlayerId } },
        data: { lineId: null },
      }),
      prisma.player.update({
        where: { id: dbPlayerId },
        data: { lineId: session.lineId },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Drop the legacy Redis mapping for this lineId so the auth fallback can't
  // serve a stale row in front of the just-written Prisma value.
  await legacyRedisCleanup(session.lineId, { dropMapping: true });

  // Write the post-write mapping into the Redis store. As of PR 16 / v1.5.0
  // this is the **canonical** lineId→Player record consulted by the JWT
  // callback — not just a pre-warmed cache in front of Prisma. The shape
  // matches `getPlayerMappingFromDb` (slug-only, no `p-`/`t-` prefix) so
  // the next /api/auth/session via `await update()` on the client reads
  // directly from Redis with no Prisma round-trip. The Prisma transaction
  // above remains as the durable secondary that backs the admin-filter
  // query and the recovery script. Sliding 24h TTL keeps active sessions
  // alive indefinitely while letting forgotten/dead entries decay.
  await setMapping(session.lineId, { playerId, playerName, teamId });

  // Schedule the LINE-pic mirror as background work — runs after the response
  // returns. waitUntil keeps the lambda alive long enough for the Promise to
  // settle, then exits cleanly. No-op when the user has no LINE picture or
  // Blob storage isn't configured.
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

  revalidatePath("/");
  revalidateTag("public-data", { expire: 0 });
  return NextResponse.json({ ok: true, playerId, playerName, teamId });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);

  if (!session?.lineId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let unlinkedSlug: string | null = null;

  try {
    const current = await prisma.player.findUnique({
      where: { lineId: session.lineId },
      select: { id: true },
    });
    if (current) {
      unlinkedSlug = current.id.startsWith(PLAYER_ID_PREFIX)
        ? current.id.slice(PLAYER_ID_PREFIX.length)
        : current.id;
      await prisma.player.update({
        where: { id: current.id },
        data: { lineId: null },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Defensive cleanup of legacy Redis state: drop the line-player-map hash
  // entry AND the player-pic key (the unassign UX has always cleared the pic
  // cache to prompt a fresh upload on next assignment).
  await legacyRedisCleanup(session.lineId, {
    dropMapping: true,
    ...(unlinkedSlug ? { dropPic: unlinkedSlug } : {}),
  });

  // Pre-warm the JWT-callback cache (PR 9) with the null sentinel so the next
  // session read serves the un-linked state from cache instead of doing a
  // cold Prisma findUnique that confirms the same null.
  await setMapping(session.lineId, null);

  revalidatePath("/");
  revalidateTag("public-data", { expire: 0 });
  return NextResponse.json({ ok: true });
}
