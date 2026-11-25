import type { RumVitalEvent } from "./monitoring";

/**
 * RUM metric contract (issue #375).
 *
 * The ingest route turns each validated beacon into a bounded Prometheus histogram. Cardinality is
 * controlled by construction: the metric name is an allowlist, the route is normalised and mapped to
 * `other` when it is unknown, the device class is one of four values, and the release label is either
 * a semantic version or `unknown`. No tenant or user identifier ever becomes a label.
 */

export const RUM_MS_METRICS = ["LCP", "INP", "FCP", "TTFB"] as const;
export const RUM_CLS_METRIC = "CLS";
export type RumMetric = (typeof RUM_MS_METRICS)[number] | typeof RUM_CLS_METRIC;

/** Milliseconds buckets (LCP per Google guidance: good 2500, poor 4000). */
export const RUM_MS_BUCKETS = [100, 250, 500, 1000, 2500, 4000, 8000] as const;
/** Unitless buckets for CLS (good 0.1, poor 0.25). */
export const RUM_CLS_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1] as const;

export const RUM_ROUTES = [
  "/dashboard",
  "/tasks",
  "/workflows",
  "/workflows/designer",
  "/forms",
  "/documents",
  "/notifications",
  "/analytics",
  "/admin",
  "/copilot",
] as const;

export const RUM_DEVICE_CLASSES = ["desktop", "mobile", "tablet", "other"] as const;
export type RumDeviceClass = (typeof RUM_DEVICE_CLASSES)[number];

/** Hard cap on distinct series; beyond it new series are dropped and counted. */
export const MAX_RUM_SERIES = 400;

/**
 * Hard cap on any label input. Besides keeping labels small, this is what makes the normalisation
 * linear: no regular expression ever sees an unbounded user string.
 */
export const MAX_LABEL_INPUT = 512;

const UNKNOWN_RELEASE = "unknown";
const OTHER_ROUTE = "other";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_ID_PATTERN = /^[0-9a-fA-F]{8,}$/;
const NUMBER_PATTERN = /^\d+$/;

/**
 * Normalises a pathname: strips query/hash, replaces identifier segments with `:id`, and buckets
 * anything outside the allowlist as `other`. This is what keeps the `route` label bounded and free of
 * user-supplied identifiers.
 */
export function normalizeRoute(pathname: string): string {
  const raw = String(pathname ?? "").slice(0, MAX_LABEL_INPUT);
  const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? "";
  // A loop instead of a trailing-slash regex: a hostile string of slashes cannot backtrack, and the
  // input is already capped, so the whole normalisation stays linear.
  let trimmed = withoutQuery;
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed === "") {
    trimmed = "/";
  }
  const segments = trimmed.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) {
    return OTHER_ROUTE;
  }
  const normalised = `/${segments
    .map((segment) =>
      UUID_PATTERN.test(segment) || HEX_ID_PATTERN.test(segment) || NUMBER_PATTERN.test(segment)
        ? ":id"
        : segment,
    )
    .join("/")}`;
  // Longest prefix first, so `/workflows/designer` wins over `/workflows`.
  const bySpecificity = [...RUM_ROUTES].sort((left, right) => right.length - left.length);
  for (const allowed of bySpecificity) {
    if (normalised === allowed || normalised.startsWith(`${allowed}/`)) {
      return allowed;
    }
  }
  return OTHER_ROUTE;
}

/** Four-value device class derived from the user agent; anything unrecognised is `other`. */
export function normalizeDeviceClass(userAgent: string | null | undefined): RumDeviceClass {
  const value = String(userAgent ?? "")
    .toLowerCase()
    .slice(0, MAX_LABEL_INPUT);
  if (!value) {
    return "other";
  }
  if (/ipad|tablet|playbook|silk/.test(value)) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android|windows phone/.test(value)) {
    return "mobile";
  }
  if (/windows|macintosh|linux|cros|x11/.test(value)) {
    return "desktop";
  }
  return "other";
}

/** Keeps a semantic version verbatim; anything else collapses to `unknown` (and is alerted on). */
export function normalizeRelease(value: string | null | undefined): string {
  const candidate = String(value ?? "")
    .trim()
    .slice(0, 64);
  return /^v?\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/.test(candidate)
    ? candidate
    : UNKNOWN_RELEASE;
}

/** Only allowlisted metric names become series; an unknown name is dropped and counted. */
export function normalizeMetric(value: string | null | undefined): RumMetric | null {
  const candidate = String(value ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 16);
  if (candidate === RUM_CLS_METRIC) {
    return RUM_CLS_METRIC;
  }
  return (RUM_MS_METRICS as readonly string[]).includes(candidate)
    ? (candidate as RumMetric)
    : null;
}

export function bucketsFor(metric: RumMetric): readonly number[] {
  return metric === RUM_CLS_METRIC ? RUM_CLS_BUCKETS : RUM_MS_BUCKETS;
}

export type DropReason = "unknown_metric" | "invalid_value" | "cardinality" | "invalid_payload";

interface HistogramSeries {
  metric: RumMetric;
  route: string;
  release: string;
  device: RumDeviceClass;
  counts: number[];
  count: number;
  sum: number;
}

export interface RumRegistry {
  series: Map<string, HistogramSeries>;
  dropped: Map<DropReason, number>;
}

export function createRumRegistry(): RumRegistry {
  return { series: new Map(), dropped: new Map() };
}

function seriesKey(
  metric: RumMetric,
  route: string,
  release: string,
  device: RumDeviceClass,
): string {
  return `${metric}|${route}|${release}|${device}`;
}

function drop(registry: RumRegistry, reason: DropReason): void {
  registry.dropped.set(reason, (registry.dropped.get(reason) ?? 0) + 1);
}

/**
 * Records one vital into the registry. Returns the series key on success or the drop reason, which is
 * what the route uses to decide between a 204 and a 202-with-drop.
 */
/** Structural input: the beacon envelope, or the same fields with an explicit value. */
export interface VitalObservation {
  metric?: { name?: string; value?: number } | undefined;
  route?: string | undefined;
  release?: string | undefined;
  value?: number | undefined;
}

export function observeVital(
  registry: RumRegistry,
  event: VitalObservation,
  userAgent?: string | null,
): { recorded: true; key: string } | { recorded: false; reason: DropReason } {
  const metric = normalizeMetric(event.metric?.name);
  if (!metric) {
    drop(registry, "unknown_metric");
    return { recorded: false, reason: "unknown_metric" };
  }
  const value = Number(event.value ?? event.metric?.value);
  if (!Number.isFinite(value) || value < 0) {
    drop(registry, "invalid_value");
    return { recorded: false, reason: "invalid_value" };
  }
  const route = normalizeRoute(event.route ?? "");
  const release = normalizeRelease(event.release);
  const device = normalizeDeviceClass(userAgent);
  const key = seriesKey(metric, route, release, device);

  let series = registry.series.get(key);
  if (!series) {
    if (registry.series.size >= MAX_RUM_SERIES) {
      drop(registry, "cardinality");
      return { recorded: false, reason: "cardinality" };
    }
    series = {
      metric,
      route,
      release,
      device,
      counts: bucketsFor(metric).map(() => 0),
      count: 0,
      sum: 0,
    };
    registry.series.set(key, series);
  }

  const bounds = bucketsFor(metric);
  const counts = series.counts;
  bounds.forEach((bound, index) => {
    if (value <= bound) {
      counts[index] = (counts[index] ?? 0) + 1;
    }
  });
  series.count += 1;
  series.sum += value;
  return { recorded: true, key };
}

function labels(series: HistogramSeries, extra = ""): string {
  const base =
    series.metric === RUM_CLS_METRIC
      ? `route="${series.route}",release="${series.release}",device="${series.device}"`
      : `metric="${series.metric}",route="${series.route}",release="${series.release}",device="${series.device}"`;
  return extra ? `${base},${extra}` : base;
}

/** Renders the Prometheus text exposition for the registry. */
export function renderExposition(registry: RumRegistry): string {
  const lines: string[] = [];
  const ms = [...registry.series.values()].filter((series) => series.metric !== RUM_CLS_METRIC);
  const cls = [...registry.series.values()].filter((series) => series.metric === RUM_CLS_METRIC);

  if (ms.length > 0) {
    lines.push(
      "# HELP awap_rum_vital_milliseconds Real-user web vital in milliseconds (LCP, INP, FCP, TTFB).",
      "# TYPE awap_rum_vital_milliseconds histogram",
    );
    for (const series of ms) {
      bucketsFor(series.metric).forEach((bound, index) => {
        lines.push(
          `awap_rum_vital_milliseconds_bucket{${labels(series, `le="${bound}"`)}} ${series.counts[index]}`,
        );
      });
      lines.push(
        `awap_rum_vital_milliseconds_bucket{${labels(series, 'le="+Inf"')}} ${series.count}`,
        `awap_rum_vital_milliseconds_sum{${labels(series)}} ${series.sum}`,
        `awap_rum_vital_milliseconds_count{${labels(series)}} ${series.count}`,
      );
    }
  }

  if (cls.length > 0) {
    lines.push(
      "# HELP awap_rum_cls Real-user cumulative layout shift (unitless).",
      "# TYPE awap_rum_cls histogram",
    );
    for (const series of cls) {
      bucketsFor(RUM_CLS_METRIC).forEach((bound, index) => {
        lines.push(
          `awap_rum_cls_bucket{${labels(series, `le="${bound}"`)}} ${series.counts[index]}`,
        );
      });
      lines.push(
        `awap_rum_cls_bucket{${labels(series, 'le="+Inf"')}} ${series.count}`,
        `awap_rum_cls_sum{${labels(series)}} ${series.sum}`,
        `awap_rum_cls_count{${labels(series)}} ${series.count}`,
      );
    }
  }

  lines.push(
    "# HELP awap_rum_vital_samples_total Beacons accepted per metric, route, release and device.",
    "# TYPE awap_rum_vital_samples_total counter",
  );
  for (const series of registry.series.values()) {
    lines.push(`awap_rum_vital_samples_total{${labels(series)}} ${series.count}`);
  }

  lines.push(
    "# HELP awap_rum_ingest_dropped_total Beacons rejected at ingest, by reason.",
    "# TYPE awap_rum_ingest_dropped_total counter",
  );
  for (const [reason, count] of registry.dropped.entries()) {
    lines.push(`awap_rum_ingest_dropped_total{reason="${reason}"} ${count}`);
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// Process-wide registry used by the ingest and scrape routes. Reset in tests.
// ---------------------------------------------------------------------------------------------

/** UTF-8 byte length without `TextEncoder`, so the module also loads in older test harnesses. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

let activeRegistry = createRumRegistry();

/** Byte size of the last rendered exposition, used by the scrape route's cache. */
let cachedBytes = 0;

export function rumRegistry(): RumRegistry {
  return activeRegistry;
}

export function resetRumMetrics(): void {
  activeRegistry = createRumRegistry();
  cachedBytes = 0;
}

export function recordRumVital(
  event: RumVitalEvent,
  userAgent?: string | null,
): { recorded: boolean; reason?: DropReason } {
  const result = observeVital(activeRegistry, event, userAgent);
  cachedBytes = utf8Length(renderExposition(activeRegistry));
  return result.recorded ? { recorded: true } : { recorded: false, reason: result.reason };
}

export function rumExposition(): string {
  return renderExposition(activeRegistry);
}

export function rumExpositionBytes(): number {
  return cachedBytes;
}

/** The exact label allowlist, exported so the audit test can assert it stays bounded. */
export const RUM_LABEL_ALLOWLIST = {
  metrics: [...RUM_MS_METRICS, RUM_CLS_METRIC],
  routes: [...RUM_ROUTES, OTHER_ROUTE],
  devices: [...RUM_DEVICE_CLASSES],
  releases: "semantic version or unknown",
} as const;
