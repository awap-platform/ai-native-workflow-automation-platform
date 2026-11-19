import en from "../messages/en.json";
import tr from "../messages/tr.json";

/**
 * Minimal, dependency-free i18n foundation (UI/UX section 3.5).
 *
 * All user-facing strings live in `messages/*.json`. `t` supports `{name}`
 * interpolation; `plural` uses `Intl.PluralRules` so a catalog can provide the
 * CLDR plural forms for each locale. Dates and numbers always go through
 * `Intl.*` with an explicit time zone for deterministic hydration.
 */
export const locales = ["en", "tr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

type Catalogs = Record<Locale, Record<string, string>>;

const catalogs: Catalogs = { en, tr };

export type TranslationValues = Record<string, string | number>;

/** Returns true when the value is a supported locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Resolves the best supported locale for a requested tag (`tr-TR` -> `tr`). */
export function resolveLocale(requested: string | null | undefined): Locale {
  if (!requested) {
    return defaultLocale;
  }
  const base = requested.split("-")[0]?.toLowerCase();
  return isLocale(base) ? base : defaultLocale;
}

/**
 * Translates a key and interpolates `{placeholders}`. Unknown keys fall back to
 * the default locale and then to the key itself, so a missing translation is
 * visible but never crashes a screen.
 */
export function t(
  locale: Locale,
  key: string,
  values: TranslationValues = {},
): string {
  const catalog = catalogs[locale] ?? catalogs[defaultLocale];
  const template = catalog[key] ?? catalogs[defaultLocale][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

export interface PluralForms {
  zero?: string;
  one: string;
  other: string;
}

/** Selects a CLDR plural form for `count` and interpolates `{count}`. */
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  const form = new Intl.PluralRules(locale).select(count);
  const template =
    form === "zero" ? (forms.zero ?? forms.other) : form === "one" ? forms.one : forms.other;
  return template.replace(/\{count\}/g, String(count));
}

/** Locale-aware number formatting; the value itself is never computed here. */
export function formatNumberForLocale(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Locale-aware, UTC-pinned timestamp formatting (hydration-safe). */
export function formatDateTimeForLocale(locale: Locale, value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
