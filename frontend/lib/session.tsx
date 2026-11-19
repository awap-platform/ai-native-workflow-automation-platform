"use client";

import { useSyncExternalStore } from "react";
import { getSessionExpiry } from "./auth";

/**
 * Hydration-safe session-expiry reader. The server snapshot is `null`, so the
 * warning only appears after hydration and never causes a mismatch.
 */
const SESSION_EVENT = "awap-session-change";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener(SESSION_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(SESSION_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useSessionExpiry(): number | null {
  return useSyncExternalStore(subscribe, getSessionExpiry, () => null);
}
