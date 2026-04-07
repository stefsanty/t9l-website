'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import type { MessageKey } from './en';
import type { Locale } from './getLocale';

interface I18nContextType {
  locale: Locale;
  dict: Record<MessageKey, string>;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Record<MessageKey, string>;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={{ locale, dict }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useT must be used within an I18nProvider');
  }

  const t = (key: MessageKey) => {
    return context.dict[key] || key;
  };

  return { t, locale: context.locale };
}
