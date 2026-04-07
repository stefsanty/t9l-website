import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { writeRosterAvailability } from "@/lib/sheets";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.playerId || !session?.teamId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { matchdayId, going } = (body ?? {}) as {
    matchdayId?: string;
    going?: boolean;
  };

  if (!matchdayId || typeof matchdayId !== "string" || typeof going !== "boolean") {
    return NextResponse.json(
      { error: "matchdayId and going (boolean) required" },
      { status: 400 },
    );
  }

  if (!/^md[1-8]$/i.test(matchdayId)) {
    return NextResponse.json({ error: "Invalid matchdayId" }, { status: 400 });
  }

  try {
    await writeRosterAvailability(session.playerId, matchdayId.toLowerCase(), going);
    revalidatePath('/');
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
