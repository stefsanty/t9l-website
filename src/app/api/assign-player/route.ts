import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { put } from "@vercel/blob";
import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function getRedis() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error("Redis not configured");
  }
  const { Redis } = await import("@upstash/redis");
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
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

  // Validate the player exists in the roster
  const raw = await fetchSheetData();
  const data = parseAllData(raw);
  const player = data.players.find((p) => p.id === playerId);

  if (!player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const playerName = player.name;
  const teamId = player.teamId;

  // Store LINE ID → player mapping in Redis
  try {
    const redis = await getRedis();
    await redis.hset("line-player-map", {
      [session.lineId]: { playerId, playerName, teamId },
    });

    // Download LINE profile picture and store in Vercel Blob
    if (session.linePictureUrl && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const picResponse = await fetch(session.linePictureUrl);
        if (picResponse.ok) {
          const blob = await picResponse.blob();
          const { url } = await put(`player-pics/${slugify(playerName)}`, blob, {
            access: "public",
            addRandomSuffix: false,
          });
          await redis.set(`player-pic:${playerId}`, url);
        }
      } catch {
        // Non-fatal: profile picture upload failed, continue
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  revalidatePath('/');
  return NextResponse.json({ ok: true, playerId, playerName, teamId });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);

  if (!session?.lineId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const redis = await getRedis();
    
    // Get current assignment to know which picture to potentially delete (if we wanted to delete from blob, but for now we just remove from redis mapping)
    const currentMapping = await redis.hget<{ playerId: string }>("line-player-map", session.lineId);
    
    if (currentMapping?.playerId) {
      await redis.del(`player-pic:${currentMapping.playerId}`);
    }
    
    await redis.hdel("line-player-map", session.lineId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  revalidatePath('/');
  return NextResponse.json({ ok: true });
}
