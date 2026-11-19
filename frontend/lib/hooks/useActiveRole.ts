"use client";

import { useSyncExternalStore } from "react";

/**
 * Hydration-safe role reader. `awap_role` is written by the identity flow and
 * is only used for menu visibility and client-side route guarding; the backend
 * remains the authorization source of truth.
 */
export const ROLE_COOKIE = "awap_role";

function readRole(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(/(?:^|;\s*)awap_role=([^;]*)/);
  const value = match?.[1];
  return value ? decodeURIComponent(value) : null;
}

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getServerSnapshot(): string | null {
  return null;
}

export function useActiveRole(): string | null {
  return useSyncExternalStore(subscribe, readRole, getServerSnapshot);
}
