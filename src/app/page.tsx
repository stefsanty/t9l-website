import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import LeaguePublicView from "@/components/LeaguePublicView";
import { getLeagueFromHost } from "@/lib/getLeagueFromHost";
import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

export default async function Home() {
  // ── Subdomain-based league routing ────────────────────────────────────────
  const dbLeague = await getLeagueFromHost();

  if (dbLeague) {
    const league = await prisma.league.findUnique({
      where: { id: dbLeague.id },
      include: {
        leagueTeams: { include: { team: true } },
        gameWeeks: {
          include: {
            venue: true,
            matches: {
              include: {
                homeTeam: { include: { team: true } },
                awayTeam: { include: { team: true } },
              },
              orderBy: { playedAt: 'asc' },
            },
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
    });

    if (league) {
      // Serialize Dates for client component
      const serialize = (v: unknown): unknown => {
        if (v instanceof Date) return v.toISOString()
        if (Array.isArray(v)) return v.map(serialize)
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, serialize(val)]))
        }
        return v
      }

      return (
        <LeaguePublicView
          league={serialize(league) as Parameters<typeof LeaguePublicView>[0]['league']}
          leagueTeams={serialize(league.leagueTeams) as Parameters<typeof LeaguePublicView>[0]['leagueTeams']}
          gameWeeks={serialize(league.gameWeeks) as Parameters<typeof LeaguePublicView>[0]['gameWeeks']}
        />
      );
    }
  }

  // ── Default: Google Sheets-backed league ──────────────────────────────────
  let raw;
  try {
    raw = await getCachedSheetData();
  } catch {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">Data unavailable</p>
          <p className="text-sm text-white/80 font-bold uppercase tracking-widest">Try again in a moment</p>
        </div>
      </div>
    );
  }

  const data = parseAllData(raw);
  const nextMd = findNextMatchday(data.matchdays);

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      nextMd={nextMd}
    />
  );
}
