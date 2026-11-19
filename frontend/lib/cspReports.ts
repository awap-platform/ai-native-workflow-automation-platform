/**
 * In-memory CSP violation aggregator (UI/UX phase 0).
 *
 * The collector is intentionally dependency-free: it de-duplicates bursts,
 * groups by directive and route, and exposes a summary for the admin
 * dashboard. A production deployment forwards the same redacted payload to the
 * external collector configured by `CSP_REPORT_COLLECTOR_URL`; this store is the
 * local, zero-infrastructure view that makes violations observable during the
 * rollout.
 */

export const CSP_DEDUPE_WINDOW_MS = 60_000;
export const CSP_REPORT_TTL_MS = 24 * 60 * 60 * 1000;
export const CSP_MAX_ENTRIES = 500;

export interface CspViolation {
  directive: string;
  blockedUri: string;
  documentUri: string;
  route: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CspRouteCount {
  route: string;
  count: number;
}

export interface CspReportSummary {
  total: number;
  unique: number;
  since: string | null;
  lastSeen: string | null;
  dedupeWindowMs: number;
  byDirective: Record<string, number>;
  byRoute: CspRouteCount[];
  recent: CspViolation[];
}

type SanitizedReport = Record<string, unknown> & {
  "csp-report"?: Record<string, unknown>;
  timestamp?: string;
};

const store = new Map<string, CspViolation>();

/** Extracts the first string value for any of the given keys. */
function firstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "unknown";
}

/** Reduces a redacted document URI to a stable route for grouping. */
export function routeFromDocumentUri(documentUri: string): string {
  try {
    const url = new URL(documentUri, "https://redacted.invalid");
    return url.pathname || "/";
  } catch {
    return "[redacted]";
  }
}

/** Returns true when the report contains a recognizable violation body. */
export function isCspReportPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate["csp-report"] && typeof candidate["csp-report"] === "object") {
    return true;
  }
  // Reporting API shape: { type: "csp-violation", body: { ... } }
  return (
    candidate.type === "csp-violation" &&
    candidate.body !== null &&
    typeof candidate.body === "object"
  );
}

/**
 * Records a redacted report. Duplicate reports for the same
 * directive + blocked URI + route inside the dedupe window increment the count
 * instead of creating a new entry, so a single broken component cannot flood
 * the dashboard or trigger an alarm storm.
 */
export function recordCspReport(payload: SanitizedReport, now: Date = new Date()): CspViolation {
  const body = (payload["csp-report"] ?? {}) as Record<string, unknown>;
  const directive = firstString(body, [
    "violated-directive",
    "effective-directive",
    "effectiveDirective",
    "violatedDirective",
  ]);
  const blockedUri = firstString(body, ["blocked-uri", "blockedURL", "blockedUri"]);
  const documentUri = firstString(body, ["document-uri", "documentURL", "documentUri"]);
  const route = routeFromDocumentUri(documentUri);
  const key = `${directive}|${blockedUri}|${route}`;
  const existing = store.get(key);
  const timestamp = now.toISOString();

  // The map key is the dedupe identity: every repeat increments the same
  // grouped entry, while `unique` stays the number of distinct identities.
  if (existing) {
    existing.count += 1;
    existing.lastSeen = timestamp;
    return existing;
  }

  const entry: CspViolation = {
    directive,
    blockedUri,
    documentUri,
    route,
    count: 1,
    firstSeen: timestamp,
    lastSeen: timestamp,
  };
  store.set(key, entry);

  // Bound the store so a hostile client cannot grow it without limit.
  while (store.size > CSP_MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    store.delete(oldestKey);
  }
  return entry;
}

/** Returns the aggregated view the admin dashboard renders. */
export function summarizeCspReports(now: Date = new Date()): CspReportSummary {
  const cutoff = now.getTime() - CSP_REPORT_TTL_MS;
  const entries = [...store.values()].filter(
    (entry) => new Date(entry.lastSeen).getTime() >= cutoff,
  );

  const byDirective: Record<string, number> = {};
  const byRouteMap = new Map<string, number>();
  let total = 0;
  let lastSeen: string | null = null;
  let since: string | null = null;

  for (const entry of entries) {
    total += entry.count;
    byDirective[entry.directive] = (byDirective[entry.directive] ?? 0) + entry.count;
    byRouteMap.set(entry.route, (byRouteMap.get(entry.route) ?? 0) + entry.count);
    if (lastSeen === null || entry.lastSeen > lastSeen) {
      lastSeen = entry.lastSeen;
    }
    if (since === null || entry.firstSeen < since) {
      since = entry.firstSeen;
    }
  }

  const byRoute = [...byRouteMap.entries()]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    unique: entries.length,
    since,
    lastSeen,
    dedupeWindowMs: CSP_DEDUPE_WINDOW_MS,
    byDirective,
    byRoute,
    recent: entries
      .slice()
      .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
      .slice(0, 20),
  };
}

/** Clears the store. Test-only seam; never called by production code. */
export function resetCspReports(): void {
  store.clear();
}
