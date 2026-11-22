"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  defaultLocale,
  resolveLocale,
  t as translate,
  tPlural as translatePlural,
  type Locale,
  type TranslationValues,
} from "./i18n";

export const LOCALE_COOKIE = "awap_locale";
export const LOCALE_COOKIE_MAX_AGE = 31_536_000;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: TranslationValues) => string;
  /** Plural-aware translation: selects `<key>.one|other` and formats `{count}`. */
  tp: (key: string, count: number, values?: TranslationValues) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  setLocale: () => undefined,
  t: (key, values) => translate(defaultLocale, key, values),
  tp: (key, count, values) => translatePlural(defaultLocale, key, count, values),
});

function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      setLocale: (next: Locale) => {
        if (next === locale) {
          return;
        }
        setLocaleState(next);
        writeLocaleCookie(next);
        if (typeof document !== "undefined") {
          document.documentElement.lang = next;
        }
      },
      t: (key: string, values?: TranslationValues) => translate(locale, key, values),
      tp: (key: string, count: number, values?: TranslationValues) =>
        translatePlural(locale, key, count, values),
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Reads the locale cookie in non-React code (tests, navigation helpers). */
export function readLocaleCookie(): Locale {
  if (typeof document === "undefined") {
    return defaultLocale;
  }
  const match = document.cookie.match(/(?:^|;\s*)awap_locale=([^;]*)/);
  return resolveLocale(match?.[1] ? decodeURIComponent(match[1]) : undefined);
}
