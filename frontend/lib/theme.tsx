"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

/**
 * Theme store (UI/UX phase 1).
 *
 * A module-level external store keeps the theme out of React state, so the
 * server snapshot (`system` / `light`) and the client snapshot cannot cause a
 * hydration mismatch. The inline bootstrap script in the root layout applies
 * the stored theme before first paint; this provider only keeps the DOM and the
 * media-query listener in sync after hydration.
 */
export const THEME_STORAGE_KEY = "awap_theme";
const THEME_EVENT = "awap-theme-change";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEMES: readonly Theme[] = ["light", "dark", "system"];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme: Theme, dark: boolean): ResolvedTheme {
  if (theme === "dark") {
    return "dark";
  }
  if (theme === "light") {
    return "light";
  }
  return dark ? "dark" : "light";
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.theme = resolved;
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  media.addEventListener("change", onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

export function getThemeSnapshot(): Theme {
  return readStoredTheme();
}

export function getServerThemeSnapshot(): Theme {
  return "system";
}

export function getResolvedThemeSnapshot(): ResolvedTheme {
  return resolveTheme(readStoredTheme(), prefersDark());
}

export function getServerResolvedThemeSnapshot(): ResolvedTheme {
  return "light";
}

export function setTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode); the in-memory DOM update still works.
  }
  applyResolvedTheme(resolveTheme(theme, prefersDark()));
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function toggleTheme(): void {
  setTheme(getResolvedThemeSnapshot() === "dark" ? "light" : "dark");
}

/** Keeps the DOM and media listener in sync without calling setState in an effect. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    getResolvedThemeSnapshot,
    getServerResolvedThemeSnapshot,
  );

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  return <>{children}</>;
}

export function useTheme(): {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
} {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerThemeSnapshot);
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    getResolvedThemeSnapshot,
    getServerResolvedThemeSnapshot,
  );
  return { theme, resolvedTheme, setTheme, toggleTheme };
}
