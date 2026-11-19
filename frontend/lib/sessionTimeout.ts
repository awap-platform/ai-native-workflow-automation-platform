/** Session-timeout policy and formatting helpers (UI/UX phase 2). */

export const SESSION_WARNING_MS = 2 * 60 * 1000;

export function sessionRemainingMs(expiresAt: number, now: number = Date.now()): number {
  return Math.max(0, expiresAt - now);
}

export function shouldWarn(expiresAt: number, now: number = Date.now()): boolean {
  const remaining = sessionRemainingMs(expiresAt, now);
  return remaining > 0 && remaining <= SESSION_WARNING_MS;
}

/** Formats a remaining duration as `m:ss`. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
