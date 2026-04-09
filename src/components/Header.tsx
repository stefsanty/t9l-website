'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import LineLoginButton from './LineLoginButton';

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-header-bg backdrop-blur-md border-b border-border-default shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
      <div className="flex items-center gap-2 px-4 h-12">
        <Link href="/" className="font-display font-black uppercase tracking-tight leading-none flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity">
          <span className="text-xl text-fg-high">T9L &apos;26</span>
          <span className="text-xl text-primary">春</span>
        </Link>

        <nav className="flex items-center gap-1 ml-3">
          <Link
            href="/"
            className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg transition-colors ${
              pathname === '/' ? 'bg-primary/15 text-primary' : 'text-fg-mid hover:text-fg-high'
            }`}
          >
            Home
          </Link>
          <Link
            href="/stats"
            className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg transition-colors ${
              pathname === '/stats' ? 'bg-primary/15 text-primary' : 'text-fg-mid hover:text-fg-high'
            }`}
          >
            Stats
          </Link>
        </nav>

        <div className="flex-1 flex justify-end items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
          <LineLoginButton />
        </div>
      </div>
    </header>
  );
}
