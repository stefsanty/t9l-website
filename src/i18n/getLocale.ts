import { cookies } from 'next/headers';

export type Locale = 'en' | 'ja';

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const lang = cookieStore.get('t9l-lang')?.value;
  if (lang === 'ja') return 'ja';
  return 'en';
}
