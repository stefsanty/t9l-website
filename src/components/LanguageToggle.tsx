'use client';

import { useState, useEffect } from 'react';

export default function LanguageToggle() {
  const [locale, setLocale] = useState<'en' | 'ja'>('en');

  useEffect(() => {
    // Check localStorage first (more reliable on iOS Safari), fall back to cookie
    try {
      const stored = localStorage.getItem('t9l-lang');
      if (stored === 'ja' || document.cookie.includes('googtrans=/en/ja')) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocale('ja');
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocale('en');
      }
    } catch {
      // localStorage blocked (e.g. Safari private mode with storage disabled)
      if (document.cookie.includes('googtrans=/en/ja')) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocale('ja');
      } else {
        try {
          if ((navigator.language || '').toLowerCase().startsWith('ja')) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLocale('ja');
          }
        } catch { /* ignore */ }
      }
    }
  }, []);

  function toggle(newLocale: 'en' | 'ja') {
    if (newLocale === locale) return;
    
    // Helper to clear cookies for all likely domains
    const clearTransCookie = () => {
      const domains = [
        window.location.hostname,
        `.${window.location.hostname}`,
        window.location.hostname.split('.').slice(-2).join('.')
      ];
      domains.forEach(domain => {
        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${domain}`;
        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      });
    };

    if (newLocale === 'ja') {
      try { localStorage.setItem('t9l-lang', 'ja'); } catch { /* ignore */ }
      document.cookie = 'googtrans=/en/ja; path=/; SameSite=Lax';
    } else {
      try { localStorage.setItem('t9l-lang', 'en'); } catch { /* ignore */ }
      clearTransCookie();
      document.cookie = 'googtrans=/en/en; path=/; SameSite=Lax';
    }
    
    window.location.reload();
  }

  return (
    <div className="flex items-center bg-surface rounded-full p-0.5 border border-border-subtle">
      <button
        onClick={() => toggle('en')}
        className={`px-2 py-1 rounded-full text-[9px] font-black transition-all ${
          locale === 'en'
            ? 'bg-primary text-white shadow-[var(--glow-primary)]'
            : 'text-fg-low hover:text-fg-mid'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => toggle('ja')}
        className={`px-2 py-1 rounded-full text-[9px] font-black transition-all ${
          locale === 'ja'
            ? 'bg-primary text-white shadow-[var(--glow-primary)]'
            : 'text-fg-low hover:text-fg-mid'
        }`}
      >
        JP
      </button>
    </div>
  );
}