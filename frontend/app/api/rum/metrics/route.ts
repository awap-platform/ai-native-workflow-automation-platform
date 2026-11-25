import { NextResponse } from "next/server";
import { resolveFeatureFlags } from "../../../../lib/featureFlags";
import { rumExposition } from "../../../../lib/rumMetrics";

/**
 * Prometheus scrape endpoint for the real-user vitals (issue #375).
 *
 * The ingest route records each beacon into a bounded in-process histogram; this route renders it in
 * the Prometheus text format. Labels are allowlisted upstream (`route`, `metric`, `release`,
 * `device`), so the series count is bounded, and no tenant or user identifier ever appears here.
 *
 * With the `rum_vitals` flag off the body is a comment: the scrape target stays healthy (a 204 would
 * also be rejected by the Fetch response contract at build time) and no empty series are invented.
 */
export async function GET(request: Request): Promise<NextResponse> {
  // Touching the request keeps the handler dynamic: the exposition is per-process state and must be
  // rendered per scrape, never prerendered at build time.
  void request.url;
  const flags = resolveFeatureFlags(process.env);
  const body = flags.rum_vitals
    ? rumExposition()
    : "# rum_vitals is disabled; no real-user series are collected in this deployment.\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
