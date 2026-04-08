'use client';

import Image from "next/image";
import { useSession } from "next-auth/react";
import type { LeagueTableRow } from "@/types";

interface LeagueTableProps {
  rows: LeagueTableRow[];
}

export default function LeagueTable({ rows }: LeagueTableProps) {
  const { data: session } = useSession();
  const userTeamId = session?.teamId;
  const leaderPoints = rows[0]?.points ?? 0;

  return (
    <div className="pl-card pl-card-magenta rounded-2xl overflow-hidden mb-10 relative">
      <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
      <div className="overflow-x-auto relative">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface text-fg-high text-[10px] font-black uppercase tracking-[0.2em]">
              <th className="py-4 pl-4 pr-1 text-left w-8">{"POS"}</th>
              <th className="py-4 px-3 text-left">{"CLUB"}</th>
              <th className="py-4 px-2 text-center">{"MP"}</th>
              <th className="py-4 px-2 text-center">{"W"}</th>
              <th className="py-4 px-2 text-center">{"D"}</th>
              <th className="py-4 px-2 text-center">{"L"}</th>
              <th className="py-4 px-2 text-center hidden sm:table-cell">{"GF"}</th>
              <th className="py-4 px-2 text-center hidden sm:table-cell">{"GA"}</th>
              <th className="py-4 px-2 text-center">{"GD"}</th>
              <th className="py-4 pr-4 pl-2 text-center font-black text-fg-high">{"PTS"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row, i) => {
              const isUserTeam = userTeamId === row.team.id;
              return (
                <tr
                  key={row.team.id}
                  className={`transition-colors hover:bg-surface group ${
                    isUserTeam ? "bg-success/10" : ""
                  }`}
                >
                  <td className="py-4 pl-4 pr-1">
                    <span className={`font-display text-base font-black ${isUserTeam ? "text-success" : "text-fg-high"}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-4 px-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-7 h-7 shrink-0 bg-surface-md rounded-md p-1 border border-border-subtle">
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
                      <div className="flex flex-col">
                        <span className="font-bold uppercase tracking-tight text-fg-high group-hover:text-primary transition-colors leading-tight" translate="no">
                          <span className="sm:hidden">{row.team.shortName}</span>
                          <span className="hidden sm:inline">{row.team.name}</span>
                        </span>
                        {isUserTeam && (
                          <span className="text-[9px] font-black text-tertiary text-fg-mid tracking-widest uppercase mt-0.5">
                            {"Your Team"}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-2 text-center font-bold text-fg-high tabular-nums">
                    {row.played}
                  </td>
                  <td className="py-4 px-2 text-center font-bold text-fg-mid tabular-nums">{row.won}</td>
                  <td className="py-4 px-2 text-center font-bold text-fg-mid tabular-nums">{row.drawn}</td>
                  <td className="py-4 px-2 text-center font-bold text-fg-mid tabular-nums">{row.lost}</td>
                  <td className="py-4 px-2 text-center hidden sm:table-cell font-bold text-fg-high tabular-nums">
                    {row.goalsFor}
                  </td>
                  <td className="py-4 px-2 text-center hidden sm:table-cell font-bold text-fg-high tabular-nums">
                    {row.goalsAgainst}
                  </td>
                  <td className="py-4 px-2 text-center font-bold text-fg-high tabular-nums">
                    {row.goalDifference > 0
                      ? `+${row.goalDifference}`
                      : row.goalDifference}
                  </td>
                  <td className="py-4 pr-4 pl-2 text-center">
                    <span className={`font-display text-xl font-black tabular-nums ${isUserTeam ? "text-tertiary" : "text-fg-high"}`}>
                      {row.points}
                    </span>
                    {i > 0 && row.points < leaderPoints && (
                      <div className="text-[9px] font-black tabular-nums text-fg-mid leading-none mt-0.5">
                        -{leaderPoints - row.points}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

