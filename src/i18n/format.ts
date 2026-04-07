import { Locale } from './getLocale';

export function formatMatchDate(dateStr: string | null, locale: Locale): string {
  if (!dateStr) return locale === 'ja' ? '未定' : 'TBD';
  
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function formatKickoff(time: string, _locale: Locale): string {
  // Kickoff times like "19:05" are already locale-neutral digits.
  // Labels are translated via dictionary.
  return time;
}
