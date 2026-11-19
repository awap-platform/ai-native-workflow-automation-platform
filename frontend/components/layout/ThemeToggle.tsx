"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/locale";
import { IconButton } from "../ui/icon-button";

/**
 * Light/dark toggle. Both icons are always rendered and selected with CSS so
 * the server snapshot and the client theme cannot produce different markup.
 */
export default function ThemeToggle() {
  const { t } = useI18n();
  const { resolvedTheme, toggleTheme } = useTheme();
  const label = t(resolvedTheme === "dark" ? "shell.themeLight" : "shell.themeDark");

  return (
    <IconButton
      label={label}
      variant="ghost"
      onClick={toggleTheme}
      data-testid="theme-toggle"
    >
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
    </IconButton>
  );
}
