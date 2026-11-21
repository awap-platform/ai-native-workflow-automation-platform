/**
 * Shared export download helper for the Phase 8 analytics and audit views.
 *
 * A large export can outlive the browser's default patience. The helper aborts a slow request,
 * retries it once, and reports that the retry happened so the page can announce it instead of
 * silently starting over. Only a timeout is retried; an HTTP error is surfaced immediately.
 */

export interface ExportRequest {
  url: string;
  timeoutMs?: number;
  retries?: number;
  onRetry?: (attempt: number) => void;
}

export interface ExportResult {
  blob: Blob;
  bytes: number;
  truncated: boolean;
  usedRetry: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Fetches an export with a timeout and one retry for timeout failures. */
export async function fetchExport({
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  onRetry,
}: ExportRequest): Promise<ExportResult> {
  let attempt = 0;
  let usedRetry = false;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }
      const blob = await response.blob();
      return {
        blob,
        bytes: blob.size,
        truncated: response.headers.get("X-AWAP-Export-Truncated") === "true",
        usedRetry,
      };
    } catch (error) {
      if (!isTimeout(error) || attempt >= retries) {
        throw error;
      }
      attempt += 1;
      usedRetry = true;
      onRetry?.(attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Triggers a browser download for an export blob. */
export function saveExport(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
