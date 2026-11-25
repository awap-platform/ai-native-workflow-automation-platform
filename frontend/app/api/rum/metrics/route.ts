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
 * With the `rum_vitals` flag off the endpoint answers 204: the scrape target stays healthy and no
 * empty series are invented.
 */
export async function GET(): Promise<NextResponse> {
  const flags = resolveFeatureFlags(process.env);
  if (!flags.rum_vitals) {
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse(rumExposition(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
