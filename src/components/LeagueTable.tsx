import Image from "next/image";
import type { LeagueTableRow } from "@/types";

interface LeagueTableProps {
  rows: LeagueTableRow[];
}

export default function LeagueTable({ rows }: LeagueTableProps) {
  return (
    <div className="pl-card pl-card-magenta rounded-2xl overflow-hidden mb-10 relative">
      <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
      <div className="overflow-x-auto relative">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/15 bg-white/[0.07] text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">
              <th className="py-4 pl-4 pr-1 text-left w-8">POS</th>
              <th className="py-4 px-3 text-left">CLUB</th>
              <th className="py-4 px-2 text-center">MP</th>
              <th className="py-4 px-2 text-center">W</th>
              <th className="py-4 px-2 text-center">D</th>
              <th className="py-4 px-2 text-center">L</th>
              <th className="py-4 px-2 text-center hidden sm:table-cell">GF</th>
              <th className="py-4 px-2 text-center hidden sm:table-cell">GA</th>
              <th className="py-4 px-2 text-center">GD</th>
              <th className="py-4 pr-4 pl-2 text-center font-black text-white">PTS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, i) => (
              <tr
                key={row.team.id}
                className={`transition-colors hover:bg-white/[0.07] group ${
                  i === 0 ? "bg-vibrant-pink/5" : ""
                }`}
              >
                <td className="py-4 pl-4 pr-1">
                  <span className={`font-display text-base font-black ${i === 0 ? "text-vibrant-pink" : "text-white/40"}`}>
                    {i + 1}
                  </span>
                </td>
                <td className="py-4 px-3">
                  <div className="flex items-center gap-3">
                    <div className="relative w-7 h-7 shrink-0 bg-white/10 rounded-md p-1 border border-white/10">
                      {row.team.logo ? (
                        <Image
                          src={row.team.logo}
                          alt={row.team.name}
                          fill
                          className="object-contain p-0.5"
                        />
                      ) : (
                        <span
                          className="inline-block h-full w-full rounded-sm"
                          style={{ backgroundColor: row.team.color }}
                        />
                      )}
                    </div>
                    <span className="font-bold uppercase tracking-tight text-white group-hover:text-vibrant-pink transition-colors">
                      <span className="sm:hidden">{row.team.shortName}</span>
                      <span className="hidden sm:inline">{row.team.name}</span>
                    </span>
                  </div>
                </td>
                <td className="py-4 px-2 text-center font-bold text-white/60 tabular-nums">
                  {row.played}
                </td>
                <td className="py-4 px-2 text-center font-bold text-white/80 tabular-nums">{row.won}</td>
                <td className="py-4 px-2 text-center font-bold text-white/80 tabular-nums">{row.drawn}</td>
                <td className="py-4 px-2 text-center font-bold text-white/80 tabular-nums">{row.lost}</td>
                <td className="py-4 px-2 text-center hidden sm:table-cell font-bold text-white/40 tabular-nums">
                  {row.goalsFor}
                </td>
                <td className="py-4 px-2 text-center hidden sm:table-cell font-bold text-white/40 tabular-nums">
                  {row.goalsAgainst}
                </td>
                <td className="py-4 px-2 text-center font-bold text-white/60 tabular-nums">
                  {row.goalDifference > 0
                    ? `+${row.goalDifference}`
                    : row.goalDifference}
                </td>
                <td className="py-4 pr-4 pl-2 text-center">
                  <span className={`font-display text-xl font-black tabular-nums ${i === 0 ? "text-vibrant-pink" : "text-white"}`}>
                    {row.points}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
