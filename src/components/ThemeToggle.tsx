'use client';

import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <div className="flex items-center bg-surface rounded-full p-0.5 border border-border-subtle">
      <button
        onClick={() => theme === 'dark' && toggle()}
        aria-label="Switch to light mode"
        className={`px-2 py-1 rounded-full text-[9px] font-black transition-all ${
          theme === 'light'
            ? 'bg-primary text-white shadow-[var(--glow-primary)]'
            : 'text-fg-low hover:text-fg-mid'
        }`}
      >
        {/* Sun icon */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      </button>
      <button
        onClick={() => theme === 'light' && toggle()}
        aria-label="Switch to dark mode"
        className={`px-2 py-1 rounded-full text-[9px] font-black transition-all ${
          theme === 'dark'
            ? 'bg-primary text-white shadow-[var(--glow-primary)]'
            : 'text-fg-low hover:text-fg-mid'
        }`}
      >
        {/* Moon icon */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    </div>
  );
}
