import {
  CSP_MAX_ENTRIES,
  isCspReportPayload,
  recordCspReport,
  resetCspReports,
  routeFromDocumentUri,
  summarizeCspReports,
} from "../cspReports";

const BASE = new Date("2026-11-19T10:00:00.000Z");

function report(overrides: Record<string, unknown> = {}, timestamp = BASE) {
  return {
    "csp-report": {
      "violated-directive": "style-src-attr",
      "blocked-uri": "inline",
      "document-uri": "https://app.example.com/tasks?token=secret",
      ...overrides,
    },
    timestamp: timestamp.toISOString(),
  };
}

describe("cspReports", () => {
  beforeEach(() => {
    resetCspReports();
  });

  it("recognizes legacy and Reporting API payloads", () => {
    expect(isCspReportPayload({ "csp-report": {} })).toBe(true);
    expect(isCspReportPayload({ type: "csp-violation", body: {} })).toBe(true);
    expect(isCspReportPayload({ hello: "world" })).toBe(false);
    expect(isCspReportPayload(null)).toBe(false);
  });

  it("reduces a document URI to a route without leaking the query string", () => {
    expect(routeFromDocumentUri("https://app.example.com/tasks?token=secret")).toBe("/tasks");
    expect(routeFromDocumentUri("/")).toBe("/");
  });

  it("deduplicates identical reports inside the window", () => {
    recordCspReport(report(), BASE);
    recordCspReport(report(), new Date(BASE.getTime() + 5_000));
    const summary = summarizeCspReports(new Date(BASE.getTime() + 10_000));
    expect(summary.total).toBe(2);
    expect(summary.unique).toBe(1);
    expect(summary.recent[0]?.count).toBe(2);
  });

  it("keeps a new entry after the dedupe window", () => {
    recordCspReport(report(), BASE);
    recordCspReport(report(), new Date(BASE.getTime() + 120_000));
    const summary = summarizeCspReports(new Date(BASE.getTime() + 130_000));
    expect(summary.unique).toBe(1);
    // The map key is stable, so a later report updates the same entry rather
    // than creating a duplicate route row.
    expect(summary.total).toBe(2);
  });

  it("groups by directive and route", () => {
    recordCspReport(report(), BASE);
    recordCspReport(
      report({
        "violated-directive": "script-src-elem",
        "blocked-uri": "inline",
        "document-uri": "https://app.example.com/workflows",
      }),
      BASE,
    );
    const summary = summarizeCspReports(new Date(BASE.getTime() + 1_000));
    expect(summary.unique).toBe(2);
    expect(summary.byDirective["style-src-attr"]).toBe(1);
    expect(summary.byDirective["script-src-elem"]).toBe(1);
    expect(summary.byRoute).toEqual([
      { route: "/tasks", count: 1 },
      { route: "/workflows", count: 1 },
    ]);
  });

  it("expires entries older than the retention window", () => {
    recordCspReport(report(), BASE);
    const summary = summarizeCspReports(new Date(BASE.getTime() + 25 * 60 * 60 * 1000));
    expect(summary.total).toBe(0);
    expect(summary.unique).toBe(0);
    expect(summary.lastSeen).toBeNull();
  });

  it("bounds the number of stored entries", () => {
    for (let index = 0; index < CSP_MAX_ENTRIES + 20; index += 1) {
      recordCspReport(
        report({
          "violated-directive": `directive-${index}`,
          "document-uri": `https://app.example.com/route-${index}`,
        }),
        BASE,
      );
    }
    const summary = summarizeCspReports(new Date(BASE.getTime() + 1_000));
    expect(summary.unique).toBeLessThanOrEqual(CSP_MAX_ENTRIES);
  });
});
