import Image from "next/image";
import type { LeagueTableRow } from "@/types";

interface LeagueTableProps {
  rows: LeagueTableRow[];
}

export default function LeagueTable({ rows }: LeagueTableProps) {
  return (
    <section>
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide mb-3">
        Standings
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted text-xs uppercase tracking-wider">
              <th className="py-2 pl-3 pr-1 text-left w-6">#</th>
              <th className="py-2 px-2 text-left">Team</th>
              <th className="py-2 px-1 text-center">MP</th>
              <th className="py-2 px-1 text-center">W</th>
              <th className="py-2 px-1 text-center">D</th>
              <th className="py-2 px-1 text-center">L</th>
              <th className="py-2 px-1 text-center hidden sm:table-cell">GF</th>
              <th className="py-2 px-1 text-center hidden sm:table-cell">GA</th>
              <th className="py-2 px-1 text-center">GD</th>
              <th className="py-2 pr-3 pl-1 text-center font-bold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.team.id}
                className={`border-b border-border/50 last:border-0 ${
                  i === 0 ? "bg-white/[0.04]" : ""
                }`}
              >
                <td className="py-2.5 pl-3 pr-1 text-muted">{i + 1}</td>
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-2">
                    {row.team.logo ? (
                      <Image
                        src={row.team.logo}
                        alt={row.team.name}
                        width={24}
                        height={24}
                        className="shrink-0 object-contain"
                      />
                    ) : (
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: row.team.color }}
                      />
                    )}
                    <span className="font-medium">
                      <span className="sm:hidden">{row.team.shortName}</span>
                      <span className="hidden sm:inline">{row.team.name}</span>
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-1 text-center text-muted">
                  {row.played}
                </td>
                <td className="py-2.5 px-1 text-center">{row.won}</td>
                <td className="py-2.5 px-1 text-center">{row.drawn}</td>
                <td className="py-2.5 px-1 text-center">{row.lost}</td>
                <td className="py-2.5 px-1 text-center hidden sm:table-cell">
                  {row.goalsFor}
                </td>
                <td className="py-2.5 px-1 text-center hidden sm:table-cell">
                  {row.goalsAgainst}
                </td>
                <td className="py-2.5 px-1 text-center">
                  {row.goalDifference > 0
                    ? `+${row.goalDifference}`
                    : row.goalDifference}
                </td>
                <td className="py-2.5 pr-3 pl-1 text-center font-display text-lg font-bold">
                  {row.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
