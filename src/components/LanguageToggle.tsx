'use client';

import { useState, useEffect } from 'react';

export default function LanguageToggle() {
  const [locale, setLocale] = useState<'en' | 'ja'>('en');

  useEffect(() => {
    // Check if googtrans cookie is set to /en/ja
    if (typeof document !== 'undefined') {
      if (document.cookie.includes('googtrans=/en/ja')) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocale('ja');
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocale('en');
      }
    }
  }, []);

  function toggle(newLocale: 'en' | 'ja') {
    if (newLocale === locale) return;
    
    // Set googtrans cookie for both current domain and root path
    if (newLocale === 'ja') {
      document.cookie = 'googtrans=/en/ja; path=/';
    } else {
      document.cookie = 'googtrans=/en/en; path=/';
    }
    
    window.location.reload();
  }

  return (
    <div className="flex items-center bg-white/5 rounded-full p-0.5 border border-white/10">
      <button
        onClick={() => toggle('en')}
        className={`px-2 py-1 rounded-full text-[9px] font-black transition-all ${
          locale === 'en'
            ? 'bg-vibrant-pink text-white shadow-[0_0_8px_rgba(233,0,82,0.4)]'
            : 'text-white/45 hover:text-white/65'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => toggle('ja')}
        className={`px-2 py-1 rounded-full text-[9px] font-black transition-all ${
          locale === 'ja'
            ? 'bg-vibrant-pink text-white shadow-[0_0_8px_rgba(233,0,82,0.4)]'
            : 'text-white/45 hover:text-white/65'
        }`}
      >
        JP
      </button>
    </div>
  );
}