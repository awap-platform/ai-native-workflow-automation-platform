/**
 * Open-redirect guard (UI/UX phase 2, risk R2-01).
 *
 * Only same-origin, single-slash relative paths are allowed. Protocol-relative
 * URLs (`//evil.com`), absolute URLs, backslash tricks, control characters and
 * auth-loop destinations fall back to the dashboard.
 */
const DISALLOWED_PATHS = ["/login", "/register", "/select-tenant", "/invitations"];

const FALLBACK = "/dashboard";
const SENTINEL_ORIGIN = "https://awap.invalid";

export function safeReturnTo(
  value: string | null | undefined,
  fallback: string = FALLBACK,
): string {
  if (!value) {
    return fallback;
  }
  const candidate = value.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.startsWith("/\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(candidate, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== SENTINEL_ORIGIN || !url.pathname.startsWith("/")) {
    return fallback;
  }
  if (DISALLOWED_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
