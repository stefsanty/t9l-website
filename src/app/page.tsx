import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import {
  computeLeagueTable,
  computePlayerStats,
  findNextMatchday,
} from "@/lib/stats";
import LeagueTable from "@/components/LeagueTable";
import NextMatchdayBanner from "@/components/NextMatchdayBanner";
import TopPerformers from "@/components/TopPerformers";
import MatchResults from "@/components/MatchResults";
import SquadList from "@/components/SquadList";

export const revalidate = 300; // ISR: 5 minutes

export default async function Home() {
  const raw = await fetchSheetData();
  const data = parseAllData(raw);

  const leagueTable = computeLeagueTable(data.teams, data.matchdays);
  const nextMd = findNextMatchday(data.matchdays);
  const playerStats = computePlayerStats(data.players, data.goals, data.ratings, data.played);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-8">
        <h1 className="font-display text-5xl font-extrabold uppercase tracking-tighter italic">
          T9L '26 Spring Season
        </h1>
        <p className="text-xs font-black text-muted uppercase tracking-[0.3em]">
          Tennozu 9-Aside League
        </p>
      </header>

      {nextMd && (
        <NextMatchdayBanner
          matchday={nextMd.matchday}
          isNext={nextMd.isNext}
          teams={data.teams}
          players={data.players}
          availability={data.availability}
        />
      )}

      <LeagueTable rows={leagueTable} />

      <div className="my-10" />

      <TopPerformers
        teams={data.teams}
        playerStats={playerStats}
      />

      <MatchResults
        matchdays={data.matchdays}
        teams={data.teams}
        goals={data.goals}
      />

      <SquadList
        teams={data.teams}
        players={data.players}
        availability={data.availability}
        nextMatchdayId={nextMd?.matchday.id || "md1"}
      />

      <footer className="mt-16 mb-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted/40">
          © 2026 Tennozu 9-Aside League
        </p>
      </footer>
    </main>
  );
}
