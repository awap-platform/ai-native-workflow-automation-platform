/**
 * Deterministic, locale-aware formatting helpers.
 *
 * Dates are formatted in UTC with an explicit locale so the server render and
 * the first client render produce identical markup regardless of the user's
 * time zone. That removes the most common React hydration mismatch (#418)
 * source without suppressing it.
 */

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
});

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats an ISO timestamp as `01 Jan 2026, 10:00 UTC`-style text. */
export function formatUtcDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const date = toDate(value);
  if (date === null) {
    return "—";
  }
  return `${dateTimeFormatter.format(date)} UTC`;
}

/** Formats an ISO date as `01 Jan 2026`. */
export function formatUtcDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const date = toDate(value);
  if (date === null) {
    return "—";
  }
  return dateFormatter.format(date);
}

const numberFormatter = new Intl.NumberFormat("en-GB");

/** Formats a number with the project's default locale. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Formats a 0..1 ratio as a one-decimal percentage. */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
