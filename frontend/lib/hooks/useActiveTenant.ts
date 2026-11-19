"use client";

import { useSyncExternalStore } from "react";
import { getActiveTenant } from "../auth";

/**
 * Hydration-safe active-tenant reader.
 *
 * The tenant lives in a document cookie, which does not exist during the server
 * render. Reading it directly while rendering would produce different markup on
 * the server (`null`) and the client (the cookie value) and trigger React error
 * #418. `useSyncExternalStore` is the supported browser-only-state primitive:
 * React hydrates with the server snapshot (`null`) and then re-renders with the
 * client snapshot.
 */

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

/** The tenant is set with a full page reload, so a module-level read is enough. */
export function useActiveTenant(): string | null {
  return useSyncExternalStore(subscribe, getActiveTenant, getServerSnapshot);
}
