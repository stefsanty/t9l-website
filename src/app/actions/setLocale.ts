'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Locale } from '@/i18n/getLocale';

export async function setLocaleAction(locale: Locale) {
  const cookieStore = await cookies();
  cookieStore.set('t9l-lang', locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  revalidatePath('/');
}
