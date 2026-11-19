/**
 * First-login access-summary dismissal (UI/UX phase 2, R2-07).
 * `useSyncExternalStore` keeps the server snapshot (`false`) and the client
 * snapshot (localStorage) hydration-safe.
 */
export const ACCESS_SUMMARY_KEY = "awap_access_summary_dismissed";
const EVENT = "awap-onboarding-change";

export function isAccessSummaryDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(ACCESS_SUMMARY_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissAccessSummary(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ACCESS_SUMMARY_KEY, "1");
  } catch {
    // Storage can be blocked; the in-memory UI still dismisses for this session.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetAccessSummary(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(ACCESS_SUMMARY_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeAccessSummary(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener(EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
