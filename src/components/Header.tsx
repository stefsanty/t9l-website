'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import LineLoginButton from './LineLoginButton';
import LeagueSwitcher from './LeagueSwitcher';
import { useMemberships } from './MembershipsProvider';

interface HeaderProps {
  /**
   * v1.63.0 — when true, the STATS nav link is hidden. Threaded from
   * Dashboard when `League.preseasonMode === true` (the /stats route is
   * also redirected at the server level for direct visits). Defaults
   * false so other pages that mount Header without per-league context
   * (admin, /assign-player, etc.) keep the existing behavior.
   */
  hideStatsLink?: boolean;
  /**
   * v1.73.0 — short label for the home button. Set to
   * `league.abbreviation ?? league.name` by the page RSC; falls back to
   * the legacy hardcoded text when not provided (pages that mount Header
   * without a league context, e.g. /assign-player, /stats, /schedule).
   */
  leagueTitle?: string | null;
  /**
   * v2.2.13 — per-URL override for the self-link gate. Pre-v2.2.13 the
   * account-menu "No player assigned yet" affordance always read
   * `session.allowSelfLink`, which the JWT callback computes against
   * `getDefaultLeagueId()` — so on `/id/<non-default-league>/*` the
   * button followed the wrong league's toggle. Pages that resolve a
   * URL-scoped league pass this to override; pages that don't (admin,
   * /assign-player, /stats, /schedule) leave it undefined and the
   * button falls back to `session.allowSelfLink` (legacy behaviour).
   */
  allowSelfLinkOverride?: boolean;
}

export default function Header({ hideStatsLink = false, leagueTitle, allowSelfLinkOverride }: HeaderProps) {
  const pathname = usePathname();
  // v1.97.3 — combined league-name + chevron trigger for multi-league
  // users. Pre-v1.97.3 the league name was always a `<Link href="/">`,
  // which for users on `/test` (whose default league matches the page)
  // felt like a no-op click ("nothing happens"). When the picker
  // applies (memberships.length >= 2), LeagueSwitcher now owns the
  // title-rendering surface AND toggles the bar on click. Single-
  // league users keep the standalone Link → `/` as a home affordance
  // (no picker exists for them, so the link is the only nav target).
  const memberships = useMemberships();
  const hasPicker = memberships.length >= 2;
  const titleText = leagueTitle ?? "T9L '26 春";

  // v1.41.2 — mobile sizing trim. Pre-fix the header wrapped to two rows
  // on iPhone-width viewports because content (~366px including the Sign-in
  // pill) exceeded available space (~358px at 390px viewport after the
  // container `px-4` padding). Trimmed `px-4`, `ml-3`, `gap-2`, the Stats
  // pill padding, and the Sign-in pill padding on mobile only — desktop
  // layout unchanged via `md:` overrides. Title font kept at `text-xl`
  // (brand mark is load-bearing; trimming utility chrome was preferred).
  return (
    <header className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-header-bg backdrop-blur-md border-b border-border-default">
      <div className="flex items-center gap-2 px-3 md:px-4 h-12">
        {hasPicker ? (
          // v1.97.3 — combined trigger. LeagueSwitcher renders the
          // title + chevron inside one button so clicking the league
          // name opens the picker. The `data-testid="header-league-title"`
          // span lives inside LeagueSwitcher's button in this branch.
          <LeagueSwitcher leagueTitle={titleText} />
        ) : (
          // Single-league fallback: keep the legacy Link → `/` home
          // affordance. No picker means no trigger to combine with;
          // the link remains a useful "go home" navigation target.
          <Link href="/" className="font-display font-black uppercase tracking-tight leading-none flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity" data-testid="header-home-link">
            <span className="text-xl text-fg-high" data-testid="header-league-title">
              {titleText}
            </span>
          </Link>
        )}

        {/* v1.63.0 — STATS nav suppressed when the active league is in
            pre-season mode. Direct visits to /stats are redirected at the
            server level; this hides the link from the navbar so users
            don't see a dead-end affordance. */}
        {!hideStatsLink && (
          <nav className="flex items-center gap-1 ml-2 md:ml-3" data-testid="header-stats-nav">
            <Link
              href="/stats"
              className={`text-[11px] font-black uppercase tracking-widest px-2 md:px-2.5 py-1 rounded-lg transition-colors ${
                pathname === '/stats' ? 'bg-primary/15 text-primary' : 'text-fg-mid hover:text-fg-high'
              }`}
            >
              Stats
            </Link>
          </nav>
        )}

        <div className="flex-1 flex justify-end items-center gap-1.5 md:gap-2">
          <ThemeToggle />
          <LanguageToggle />
          <LineLoginButton allowSelfLinkOverride={allowSelfLinkOverride} />
        </div>
      </div>
    </header>
  );
}
