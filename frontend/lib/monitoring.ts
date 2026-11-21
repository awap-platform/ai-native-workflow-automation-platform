/**
 * Real-user monitoring hooks (UI/UX phase 10).
 *
 * `next/web-vitals` produces browser metrics through
 * [`WebVitalsReporter`](../components/providers/WebVitalsReporter.tsx). This
 * module shapes them into a stable, redacted envelope and sends it to the
 * same-origin `/api/rum` ingest route with `sendBeacon` (falling back to
 * `fetch` with `keepalive`). Ingest logs one structured JSON line per event, so
 * the existing log pipeline is the integration point for Prometheus/Grafana or
 * any external RUM backend; no third-party script is loaded.
 *
 * Sending is opt-in through the `rum_vitals` feature flag, so the PR E2E stack
 * and the default configuration never emit beacons.
 */

export const RUM_SCHEMA_VERSION = 1 as const;

export interface WebVitalSample {
  id: string;
  name: string;
  value: number;
  rating: string;
  delta?: number | undefined;
  navigationType?: string | undefined;
}

export interface RumVitalEvent {
  schemaVersion: typeof RUM_SCHEMA_VERSION;
  metric: {
    id: string;
    name: string;
    value: number;
    rating: string;
    delta: number | null;
    navigationType: string | null;
  };
  route: string;
  release: string;
  recordedAt: string;
}

export interface RumSenderOptions {
  enabled: boolean;
  endpoint: string;
  release: string;
  now?: () => Date;
  send?: (url: string, body: string) => void;
}

/** True when the object carries the fields `useReportWebVitals` provides. */
export function isWebVitalSample(value: unknown): value is WebVitalSample {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.value === "number" &&
    Number.isFinite(candidate.value) &&
    typeof candidate.rating === "string"
  );
}

/**
 * Removes query strings, fragments and identifier-shaped path segments so a
 * beacon cannot leak a tenant id, task id or search term.
 */
export function sanitizeRoute(input: string): string {
  const withoutQuery = input.split("?")[0]?.split("#")[0] ?? "/";
  const segments = withoutQuery.split("/").map((segment) => {
    if (!segment) {
      return segment;
    }
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(segment)) {
      return ":id";
    }
    if (/^\d+$/.test(segment)) {
      return ":n";
    }
    return segment;
  });
  return segments.join("/") || "/";
}

/** Builds the canonical envelope for one Web Vital sample. */
export function buildRumVitalEvent(input: {
  metric: WebVitalSample;
  route: string;
  release: string;
  now?: Date;
}): RumVitalEvent {
  const recordedAt = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: RUM_SCHEMA_VERSION,
    metric: {
      id: input.metric.id,
      name: input.metric.name,
      value: input.metric.value,
      rating: input.metric.rating,
      delta: input.metric.delta ?? null,
      navigationType: input.metric.navigationType ?? null,
    },
    route: sanitizeRoute(input.route),
    release: input.release,
    recordedAt,
  };
}

/** Validates an ingest payload coming from the browser. */
export function isRumVitalEvent(value: unknown): value is RumVitalEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== RUM_SCHEMA_VERSION) {
    return false;
  }
  if (typeof candidate.route !== "string" || !candidate.route.startsWith("/")) {
    return false;
  }
  if (typeof candidate.release !== "string" || typeof candidate.recordedAt !== "string") {
    return false;
  }
  const metric = candidate.metric;
  return (
    typeof metric === "object" &&
    metric !== null &&
    typeof (metric as Record<string, unknown>).name === "string" &&
    typeof (metric as Record<string, unknown>).value === "number" &&
    Number.isFinite((metric as Record<string, unknown>).value)
  );
}

function defaultSend(url: string, body: string): void {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  });
}

/**
 * Creates the reporter passed to `useReportWebVitals`. When disabled, invalid
 * or absent metrics are ignored; a send failure never throws into React.
 */
export function createVitalSender(
  options: RumSenderOptions,
): (metric: unknown, route: string) => boolean {
  const send = options.send ?? defaultSend;
  const now = options.now ?? (() => new Date());

  return (metric, route) => {
    if (!options.enabled || !isWebVitalSample(metric)) {
      return false;
    }
    const event = buildRumVitalEvent({ metric, route, release: options.release, now: now() });
    try {
      send(options.endpoint, JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  };
}
