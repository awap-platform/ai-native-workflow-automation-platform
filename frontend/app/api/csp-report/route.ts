import { NextResponse } from "next/server";
import { redactCspReport } from "../../../lib/csp";
import {
  isCspReportPayload,
  recordCspReport,
  summarizeCspReports,
  type CspReportSummary,
} from "../../../lib/cspReports";

/**
 * CSP violation collector (issue #183, UI/UX phase 0).
 *
 * POST accepts both the legacy `csp-report` body and the Reporting API
 * `{ type, body }` shape. Reports are redacted before they are logged or
 * forwarded: query strings, fragments, credentials and script samples never
 * leave the process.
 *
 * - valid report -> 204 and recorded locally;
 * - malformed JSON or an unrecognized body -> 400 (never 2xx, so a broken
 *   client is visible in dashboards);
 * - GET returns the aggregated summary used by the admin dashboard.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!isCspReportPayload(payload)) {
    return NextResponse.json({ error: "invalid-csp-report" }, { status: 400 });
  }

  // Normalize the Reporting API envelope to the legacy fields the aggregator
  // understands, then redact.
  const candidate = payload as Record<string, unknown>;
  const normalized =
    candidate["csp-report"] !== undefined ? payload : { "csp-report": candidate.body };

  const redacted = redactCspReport(normalized);
  recordCspReport(redacted);

  const collector = process.env.CSP_REPORT_COLLECTOR_URL;
  if (collector) {
    try {
      await fetch(collector, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(redacted),
      });
    } catch {
      // Reporting must never break the response path.
    }
  }
  console.warn("csp-violation", JSON.stringify(redacted));
  return new NextResponse(null, { status: 204 });
}

export async function GET(): Promise<NextResponse<CspReportSummary>> {
  return NextResponse.json(summarizeCspReports(), {
    headers: { "Cache-Control": "no-store" },
  });
}
