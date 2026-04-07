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
  const { matchdayId, status } = (body ?? {}) as {
    matchdayId?: string;
    status?: string;
  };

  const VALID_STATUSES = ['GOING', 'UNDECIDED', ''];
  if (!matchdayId || typeof matchdayId !== "string" || !VALID_STATUSES.includes(status ?? 'x')) {
    return NextResponse.json(
      { error: "matchdayId and status ('GOING'|'UNDECIDED'|'') required" },
      { status: 400 },
    );
  }

  if (!/^md[1-8]$/i.test(matchdayId)) {
    return NextResponse.json({ error: "Invalid matchdayId" }, { status: 400 });
  }

  try {
    await writeRosterAvailability(session.playerId, matchdayId.toLowerCase(), status as 'GOING' | 'UNDECIDED' | '');
    revalidatePath('/');
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
