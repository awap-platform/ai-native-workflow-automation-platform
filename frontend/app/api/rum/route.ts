import { NextResponse } from "next/server";
import { resolveFeatureFlags } from "../../../lib/featureFlags";
import { isRumVitalEvent } from "../../../lib/monitoring";
import { recordRumVital } from "../../../lib/rumMetrics";

/**
 * Real-user Web Vitals ingest (UI/UX phase 10).
 *
 * - Disabled unless the `rum_vitals` feature flag is on; with the flag off the
 *   beacon is acknowledged and dropped so an in-flight client never retries.
 * - Valid envelopes are logged as one structured `rum-vital` line. The log
 *   pipeline is the documented integration point for Prometheus, Grafana or an
 *   external RUM backend; set `RUM_COLLECTOR_URL` to forward the envelope.
 * - Malformed bodies return 400 so a broken client is visible in dashboards.
 * - The payload was already redacted in the browser (no query strings, masked
 *   identifiers) and is re-validated here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const flags = resolveFeatureFlags(process.env);
  if (!flags.rum_vitals) {
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!isRumVitalEvent(payload)) {
    return NextResponse.json({ error: "invalid-rum-event" }, { status: 400 });
  }

  console.info("rum-vital", JSON.stringify(payload));

  // Issue #375: the beacon also feeds a bounded Prometheus histogram, which is what the dashboard,
  // the alert rules and the release gate read. A dropped sample is counted, never thrown.
  const recorded = recordRumVital(payload, request.headers.get("user-agent"));
  if (!recorded.recorded) {
    console.info("rum-vital-dropped", JSON.stringify({ reason: recorded.reason }));
  }

  const collector = process.env.RUM_COLLECTOR_URL;
  if (collector) {
    try {
      await fetch(collector, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Monitoring must never break the response path.
    }
  }

  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
