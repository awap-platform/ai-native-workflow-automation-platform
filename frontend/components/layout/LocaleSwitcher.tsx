"use client";

import { useId } from "react";
import { useI18n } from "../../lib/locale";
import { locales, type Locale } from "../../lib/i18n";

/** Compact language switcher used by the topbar and the auth shell. */
export default function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const id = useId();

  return (
    <label className="inline-flex items-center gap-2 text-xs awap-muted" htmlFor={id}>
      <span className="sr-only">{t("shell.language")}</span>
      <select
        id={id}
        className="awap-select h-9 min-h-0 w-auto py-1 text-xs"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t("shell.language")}
        data-testid="locale-switcher"
      >
        {locales.map((value) => (
          <option key={value} value={value}>
            {value.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
