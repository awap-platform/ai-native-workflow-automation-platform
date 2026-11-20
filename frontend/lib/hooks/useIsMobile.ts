"use client";

import { useSyncExternalStore } from "react";

/**
 * Breakpoint reader for the mobile list/detail split (risk R3-07).
 *
 * `useSyncExternalStore` keeps server render and hydration identical: the server snapshot is
 * always `false`, then the client reports the real viewport on the first commit.
 */

export const MOBILE_TASKS_QUERY = "(max-width: 1023px)";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const list = window.matchMedia(MOBILE_TASKS_QUERY);
  list.addEventListener("change", onStoreChange);
  return () => list.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_TASKS_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
