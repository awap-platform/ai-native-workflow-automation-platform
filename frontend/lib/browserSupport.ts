/**
 * Browser capability and connection checks (UI/UX phase 10).
 *
 * The application targets the evergreen desktop and mobile browsers listed in
 * [`COMPATIBILITY.md`](../../COMPATIBILITY.md). Rather than blocking an unknown
 * user agent, the UI checks the capabilities the shell actually needs and shows
 * a dismissible warning when one is missing, so an older browser can still read
 * the fallback page. Connection checks drive the slow-network notice.
 */

export interface BrowserCapabilities {
  promise: boolean;
  fetch: boolean;
  intl: boolean;
  intersectionObserver: boolean;
  matchMedia: boolean;
}

export interface BrowserSupportResult {
  supported: boolean;
  missing: string[];
}

export const SUPPORTED_BROWSERS: ReadonlyArray<{ name: string; minimumMajor: number }> = [
  { name: "Chrome", minimumMajor: 100 },
  { name: "Edge", minimumMajor: 100 },
  { name: "Firefox", minimumMajor: 100 },
  { name: "Safari", minimumMajor: 15 },
];

export const SLOW_EFFECTIVE_TYPES: ReadonlySet<string> = new Set(["slow-2g", "2g", "3g"]);

/** Reads the capabilities that the React shell and query layer rely on. */
export function detectBrowserCapabilities(scope: {
  Promise?: unknown;
  fetch?: unknown;
  Intl?: unknown;
  IntersectionObserver?: unknown;
  matchMedia?: unknown;
} = globalThis): BrowserCapabilities {
  return {
    promise: typeof scope.Promise === "function",
    fetch: typeof scope.fetch === "function",
    intl: typeof scope.Intl === "object" && scope.Intl !== null,
    intersectionObserver: typeof scope.IntersectionObserver === "function",
    matchMedia: typeof scope.matchMedia === "function",
  };
}

/** Maps missing capabilities to human-readable labels. */
export function assessBrowserSupport(
  capabilities: BrowserCapabilities,
): BrowserSupportResult {
  const missing: string[] = [];
  if (!capabilities.promise) {
    missing.push("Promise");
  }
  if (!capabilities.fetch) {
    missing.push("fetch");
  }
  if (!capabilities.intl) {
    missing.push("Intl");
  }
  if (!capabilities.intersectionObserver) {
    missing.push("IntersectionObserver");
  }
  return { supported: missing.length === 0, missing };
}

/** True for 2G/3G connections and for the browser's data-saver mode. */
export function isSlowConnection(
  effectiveType: string | null | undefined,
  saveData: boolean | null | undefined,
): boolean {
  if (saveData === true) {
    return true;
  }
  return typeof effectiveType === "string" && SLOW_EFFECTIVE_TYPES.has(effectiveType);
}
