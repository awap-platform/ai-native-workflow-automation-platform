/**
 * Content Security Policy helpers (issue #183, UI/UX phase 0).
 *
 * Pure functions so nonce generation, header construction and report redaction
 * can be unit-tested without a running Next.js server.
 *
 * The policy never emits `unsafe-eval` or `unsafe-inline`. Inline `<script>` and
 * `<style>` blocks require the per-request nonce. The former
 * `style-src-attr 'unsafe-inline'` exception was removed once every React
 * `style` attribute was migrated to a token class (issue 363); `style-src-attr`
 * is now `'none'`.
 */

export const CSP_REPORT_URI = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";

/** Owner/tracking reference for the temporary inline-style exception. */
export const CSP_STYLE_ATTR_EXCEPTION_ISSUE = "AWAP-UIUX-PHASE-0";
/** Hard expiry. `resolveStyleAttrException` throws once this instant has passed. */
export const CSP_STYLE_ATTR_EXCEPTION_EXPIRY = "2026-12-31T00:00:00.000Z";

/** Builds the `Report-To` header value for the CSP collector. */
export const CSP_REPORT_TO = JSON.stringify({
  group: CSP_REPORT_GROUP,
  max_age: 10886400,
  endpoints: [{ url: CSP_REPORT_URI }],
});

/** Builds the `Reporting-Endpoints` header value. */
export const CSP_REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_URI}"`;

export interface CspOptions {
  nonce: string;
  /** Space-separated API origins allowed by `connect-src`. */
  apiOrigins: string;
  reportUri?: string;
  /** Injectable clock for tests and for deterministic policy snapshots. */
  now?: Date;
  /** Overrides the resolved exception state; used by tests. */
  styleAttrException?: boolean;
  /** Adds `upgrade-insecure-requests`; enabled in production deployments. */
  upgradeInsecureRequests?: boolean;
}

export type RandomValues = (bytes: Uint8Array) => Uint8Array;

export interface StyleAttrExceptionState {
  issue: string;
  expiry: string;
  active: boolean;
  expired: boolean;
  source: "env" | "default";
}

/**
 * Resolves the temporary `style-src-attr 'unsafe-inline'` exception.
 *
 * - `CSP_STYLE_ATTR_UNSAFE_INLINE=false` switches it off explicitly (the goal).
 * - Before the expiry the exception is active by default.
 * - After the expiry the function throws, so CI and the production build cannot
 *   silently keep the exception alive.
 */
export function resolveStyleAttrException(now: Date = new Date()): StyleAttrExceptionState {
  const flag = process.env.CSP_STYLE_ATTR_UNSAFE_INLINE;
  const expiry = CSP_STYLE_ATTR_EXCEPTION_EXPIRY;
  const expired = now.getTime() > new Date(expiry).getTime();

  if (flag === "false") {
    return { issue: CSP_STYLE_ATTR_EXCEPTION_ISSUE, expiry, active: false, expired, source: "env" };
  }
  if (expired) {
    throw new Error(
      `CSP style-src-attr exception expired on ${expiry} (${CSP_STYLE_ATTR_EXCEPTION_ISSUE}). ` +
        "Remove the remaining inline style attributes or set CSP_STYLE_ATTR_UNSAFE_INLINE=false.",
    );
  }
  return {
    issue: CSP_STYLE_ATTR_EXCEPTION_ISSUE,
    expiry,
    active: true,
    expired,
    source: flag === "true" ? "env" : "default",
  };
}

/**
 * Generates a per-request base64url nonce. `crypto.getRandomValues` is
 * available in the Edge runtime and in Node 20+, so the same implementation
 * runs in middleware and tests.
 */
export function generateNonce(
  randomValues: RandomValues = (bytes) => crypto.getRandomValues(bytes),
  byteLength = 16,
): string {
  const bytes = randomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}

/**
 * Builds a nonce-based policy. `strict-dynamic` lets nonce-trusted Next.js
 * bootstrap scripts load their chunks. `script-src`, `style-src-elem` and
 * `style-src-attr` never contain `unsafe-inline` or `unsafe-eval`.
 */
export function buildCsp({
  nonce,
  apiOrigins,
  reportUri = CSP_REPORT_URI,
  upgradeInsecureRequests = false,
}: CspOptions): string {
  const origins = apiOrigins.trim() || "'self'";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src 'self' ${origins}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (upgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }
  directives.push(`report-uri ${reportUri}`, `report-to ${CSP_REPORT_GROUP}`);
  return directives.join("; ");
}

/** Removes query strings, fragments and credentials from a URL-shaped value. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value, "https://redacted.invalid");
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return value.startsWith("http") ? url.toString() : `${url.pathname}`;
  } catch {
    return "[redacted]";
  }
}

const REPORT_STRING_FIELDS = [
  "document-uri",
  "referrer",
  "blocked-uri",
  "violated-directive",
  "effective-directive",
  "original-policy",
  "disposition",
  "source-file",
] as const;

const REPORT_NUMBER_FIELDS = ["status-code", "line-number", "column-number"] as const;

/**
 * Sanitizes a CSP report before logging or forwarding it. Query strings,
 * fragments, credentials, cookies and authorization material never leave the
 * process, and script samples are dropped entirely.
 */
export function redactCspReport(
  payload: unknown,
  now: Date = new Date(),
): Record<string, unknown> {
  const raw =
    payload && typeof payload === "object" && "csp-report" in payload
      ? (payload as { "csp-report": unknown })["csp-report"]
      : payload;
  if (!raw || typeof raw !== "object") {
    return { "csp-report": { "violated-directive": "unknown", "blocked-uri": "[redacted]" } };
  }
  const source = raw as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const field of REPORT_STRING_FIELDS) {
    const value = source[field];
    if (typeof value === "string") {
      sanitized[field] =
        field === "document-uri" || field === "referrer" || field === "blocked-uri" || field === "source-file"
          ? redactUrl(value)
          : value;
    }
  }
  for (const field of REPORT_NUMBER_FIELDS) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[field] = value;
    }
  }
  // Script samples can contain form values or tokens; never log them.
  sanitized["script-sample"] = "[redacted]";
  sanitized["csp-report"] = "redacted";
  return { "csp-report": sanitized, timestamp: now.toISOString() };
}
