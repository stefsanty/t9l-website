import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { put } from "@vercel/blob";
import { getPublicLeagueData } from "@/lib/publicData";
import { prisma } from "@/lib/prisma";
import { invalidate as invalidateMappingCache } from "@/lib/playerMappingCache";

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

  let pictureUrl: string | null = null;

  // Optionally mirror LINE profile picture into Vercel Blob, then persist on
  // Player.pictureUrl. Keep the legacy `player-pic:${playerId}` Redis key in
  // sync because stats/page.tsx still reads it for SquadList/TopPerformers
  // avatars (separate from the auth-mapping concern this PR is migrating).
  if (session.linePictureUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const picResponse = await fetch(session.linePictureUrl);
      if (picResponse.ok) {
        const blob = await picResponse.blob();
        const { url } = await put(`player-pics/${slugify(playerName)}`, blob, {
          access: "public",
          addRandomSuffix: false,
        });
        pictureUrl = url;
        if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
          try {
            const { Redis } = await import("@upstash/redis");
            const redis = new Redis({
              url: process.env.KV_REST_API_URL,
              token: process.env.KV_REST_API_TOKEN,
            });
            await redis.set(`player-pic:${playerId}`, url);
          } catch {
            /* non-fatal */
          }
        }
      }
    } catch {
      // Non-fatal: profile picture upload failed, continue
    }
  }

  // Atomic Prisma write: clear lineId from any other Player that currently
  // holds it (collision-safe because lineId is @unique), then set on target.
  // Use updateMany for the clear so a no-op (no other holder) doesn't throw.
  try {
    await prisma.$transaction([
      prisma.player.updateMany({
        where: { lineId: session.lineId, id: { not: dbPlayerId } },
        data: { lineId: null },
      }),
      prisma.player.update({
        where: { id: dbPlayerId },
        data: {
          lineId: session.lineId,
          ...(pictureUrl ? { pictureUrl } : {}),
        },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Drop the legacy Redis mapping for this lineId so the auth fallback can't
  // serve a stale row in front of the just-written Prisma value.
  await legacyRedisCleanup(session.lineId, { dropMapping: true });

  // Bust the JWT-callback cache (PR 8) so the next /api/auth/session reads
  // the freshly-written Prisma row instead of the previous mapping.
  await invalidateMappingCache(session.lineId);

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

  // Bust the JWT-callback cache (PR 8) so the next session read sees the
  // un-linked Prisma state instead of the prior mapping.
  await invalidateMappingCache(session.lineId);

  revalidatePath("/");
  revalidateTag("public-data", { expire: 0 });
  return NextResponse.json({ ok: true });
}
