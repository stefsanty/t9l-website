'use client';

import { useRouter } from 'next/navigation';
import { useT } from '@/i18n/I18nProvider';
import { setLocaleAction } from '@/app/actions/setLocale';
import { Locale } from '@/i18n/getLocale';

export default function LanguageToggle() {
  const { locale } = useT();
  const router = useRouter();

  async function toggle(newLocale: Locale) {
    if (newLocale === locale) return;
    await setLocaleAction(newLocale);
    router.refresh();
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
