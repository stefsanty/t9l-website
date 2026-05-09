import Link from 'next/link'
import Header from '@/components/Header'
import type { DirectoryLeague } from '@/lib/leagueDirectoryData'

/**
 * v1.85.0 — homepage redesign phase 1b. Public-facing list of every
 * non-PRIVATE league. Rendered by `<HomepageRouter>` for unauthenticated
 * visitors AND authenticated users with zero APPROVED memberships;
 * `/test/directory` mounts it directly so the URL is shareable.
 *
 * Server component — no interactive state. Each card is a `<Link>` to
 * `/id/<slug>`. PRIVATE leagues are filtered out at the data layer
 * (`getDirectoryLeagues`); this component just renders the rows.
 *
 * Layout choices:
 *   - Single column on mobile (`max-w-lg` matches Dashboard's container).
 *   - "League Directory" header is a literal — no per-league dynamic
 *     title (the rendered surface IS the title).
 *   - Status pill differentiates PUBLIC_OPEN ("Recruiting") from
 *     PUBLIC_CLOSED ("Closed"). Both are clickable; the status pill is
 *     a label, not a gate.
 *   - "Thumbnail" placeholder uses the league's abbreviation in a
 *     coloured square (no `League.thumbnail` column exists yet — adding
 *     one is a separate phase). Falls back to the first letter of the
 *     name when there's no abbreviation.
 *   - Empty-state copy when no leagues match (catastrophic; the
 *     directory should always have ≥ 1 league in practice).
 */
export default function LeagueDirectory({
  leagues,
}: {
  leagues: ReadonlyArray<DirectoryLeague>
}) {
  return (
    <div className="flex flex-col min-h-dvh max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header leagueTitle="League Directory" />

      <main className="flex-1 px-4 pt-16 pb-8">
        <div className="animate-in pt-2">
          <h1
            className="font-display text-3xl font-black uppercase tracking-tight text-fg-high mb-1"
            data-testid="league-directory-heading"
          >
            League Directory
          </h1>
          <p className="text-xs uppercase tracking-[0.25em] text-fg-low font-bold mb-5">
            {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}
          </p>

          {leagues.length === 0 ? (
            <div
              data-testid="league-directory-empty"
              className="text-center py-16 bg-surface rounded-2xl border border-border-default"
            >
              <p className="font-display text-xl font-black uppercase text-fg-mid mb-1">
                No leagues yet
              </p>
              <p className="text-xs uppercase tracking-widest text-fg-low font-bold">
                Check back soon
              </p>
            </div>
          ) : (
            <ul className="space-y-3" data-testid="league-directory-list">
              {leagues.map((league) => (
                <li key={league.id}>
                  <Link
                    href={`/id/${league.slug}`}
                    data-testid={`league-directory-card-${league.slug}`}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border-default hover:border-primary/50 transition-colors"
                  >
                    <div
                      aria-hidden
                      className="flex-shrink-0 w-14 h-14 rounded-xl bg-surface-md border border-border-default flex items-center justify-center font-display font-black text-lg uppercase text-fg-high"
                    >
                      {(league.abbreviation ?? league.name.charAt(0)).slice(0, 4)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-display text-base font-black uppercase tracking-tight text-fg-high truncate">
                          {league.name}
                        </span>
                      </div>
                      <p className="text-[11px] uppercase tracking-widest font-bold text-fg-low truncate">
                        {league.location} · {league.ballType === 'FUTSAL' ? 'Futsal' : 'Soccer'}
                        {league.seasonLabel ? ` · ${league.seasonLabel}` : ''}
                      </p>
                    </div>
                    <span
                      data-testid={`league-directory-status-${league.slug}`}
                      className={`flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                        league.status === 'recruiting'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-surface text-fg-low'
                      }`}
                    >
                      {league.status === 'recruiting' ? 'Recruiting' : 'Closed'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <footer className="mt-3 mb-0 text-center px-4 pb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fg-low">
          © 2026 Tennozu 9-Aside League · Tokyo
        </p>
      </footer>
    </div>
  )
}
