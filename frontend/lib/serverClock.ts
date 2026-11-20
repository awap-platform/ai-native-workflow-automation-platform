/**
 * Server-time reference for SLA countdowns (phase 3, risk R3-05).
 *
 * Every API response carries an HTTP `Date` header. The first response after a page load measures
 * the browser/server clock skew; `serverNow()` then answers in server time so a wrong workstation
 * clock cannot make a task look overdue. Skew larger than a day is treated as a broken header and
 * ignored instead of producing absurd deadlines.
 */

const MAX_SKEW_MS = 24 * 60 * 60 * 1000;

let offsetMs = 0;

interface DateHeaderSource {
  headers?: { get?: (name: string) => string | null } | null;
}

/** Records the skew implied by one response. Returns the applied offset in milliseconds. */
export function recordServerClock(response: DateHeaderSource, receivedAt: number = Date.now()): number {
  const raw = response.headers?.get?.("date");
  if (!raw) {
    return offsetMs;
  }
  const serverMs = Date.parse(raw);
  if (Number.isNaN(serverMs)) {
    return offsetMs;
  }
  const skew = serverMs - receivedAt;
  if (Math.abs(skew) > MAX_SKEW_MS) {
    return offsetMs;
  }
  offsetMs = skew;
  return offsetMs;
}

/** Current time in server terms. */
export function serverNow(now: number = Date.now()): number {
  return now + offsetMs;
}

/** Applied offset, exposed for diagnostics and tests. */
export function serverClockOffsetMs(): number {
  return offsetMs;
}

/** Clears the offset; used by tests and by logout. */
export function resetServerClock(): void {
  offsetMs = 0;
}
