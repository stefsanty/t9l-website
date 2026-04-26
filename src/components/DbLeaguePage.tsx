import type { Prisma } from '@prisma/client'

type League = Prisma.LeagueGetPayload<{
  include: {
    leagueTeams: { include: { team: true } }
    gameWeeks: {
      include: {
        venue: true
        matches: {
          include: {
            homeTeam: { include: { team: true } }
            awayTeam: { include: { team: true } }
          }
        }
      }
    }
  }
}>

function fmt(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

export default function DbLeaguePage({ league }: { league: League }) {
  const now = new Date()

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Header */}
      <div className="bg-midnight text-white px-4 py-8 text-center">
        <h1 className="font-condensed font-black text-3xl uppercase tracking-wide">{league.name}</h1>
        {league.description && (
          <p className="text-white/60 text-sm mt-1">{league.description}</p>
        )}
        <p className="text-white/50 text-xs mt-2 uppercase tracking-widest">
          {fmt(league.startDate)}
          {league.endDate ? ` – ${fmt(league.endDate)}` : ''} · {league.location}
        </p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {/* Teams */}
        <section>
          <h2 className="font-condensed font-bold text-lg uppercase tracking-wide mb-3">Teams</h2>
          <div className="grid grid-cols-2 gap-3">
            {league.leagueTeams.map((lt) => (
              <div key={lt.id} className="bg-card rounded-xl border border-border p-4 text-center">
                <p className="font-semibold text-sm">{lt.team.name}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Schedule */}
        <section>
          <h2 className="font-condensed font-bold text-lg uppercase tracking-wide mb-3">Schedule</h2>
          <div className="space-y-4">
            {league.gameWeeks.map((gw) => {
              const gwDate = gw.startDate
              const isPast = gw.endDate < now
              return (
                <div key={gw.id} className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted flex items-center justify-between">
                    <span className="font-condensed font-bold text-sm uppercase tracking-wide">
                      Matchday {gw.weekNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmt(gwDate)}</span>
                  </div>
                  <div className="divide-y divide-border">
                    {gw.matches.map((m) => (
                      <div key={m.id} className="px-4 py-3 flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-10 shrink-0 text-xs">{fmtTime(m.playedAt)}</span>
                        <span className="flex-1 text-right font-medium truncate">{m.homeTeam.team.name}</span>
                        <span className="font-mono text-xs text-muted-foreground shrink-0 px-1">
                          {m.status === 'COMPLETED' ? `${m.homeScore} – ${m.awayScore}` : 'vs'}
                        </span>
                        <span className="flex-1 font-medium truncate">{m.awayTeam.team.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
