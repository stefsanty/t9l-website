'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import LineLoginButton from './LineLoginButton';
import LeagueSwitcher from './LeagueSwitcher';

export default function Header() {
  const pathname = usePathname();

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
        <Link href="/" className="font-display font-black uppercase tracking-tight leading-none flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity">
          <span className="text-xl text-fg-high">T9L &apos;26</span>
          <span className="text-xl text-primary">春</span>
        </Link>

        {/* v1.52.0 — league switcher chevron next to the brand. Hidden when
            the user has < 2 league memberships (single-league users see no
            extra chrome). The component lazy-loads memberships on first
            open via /api/me/memberships. */}
        <LeagueSwitcher />

        <nav className="flex items-center gap-1 ml-2 md:ml-3">
          <Link
            href="/stats"
            className={`text-[11px] font-black uppercase tracking-widest px-2 md:px-2.5 py-1 rounded-lg transition-colors ${
              pathname === '/stats' ? 'bg-primary/15 text-primary' : 'text-fg-mid hover:text-fg-high'
            }`}
          >
            Stats
          </Link>
        </nav>

        <div className="flex-1 flex justify-end items-center gap-1.5 md:gap-2">
          <ThemeToggle />
          <LanguageToggle />
          <LineLoginButton />
        </div>
      </div>
    </header>
  );
}
