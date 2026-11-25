import {
  MAX_RUM_SERIES,
  RUM_LABEL_ALLOWLIST,
  createRumRegistry,
  normalizeDeviceClass,
  normalizeMetric,
  normalizeRelease,
  normalizeRoute,
  observeVital,
  recordRumVital,
  renderExposition,
  resetRumMetrics,
  rumExposition,
  rumExpositionBytes,
} from "../rumMetrics";
import type { RumVitalEvent } from "../monitoring";

function event(
  name: string,
  value: number,
  route = "/dashboard",
  release = "v1.7.0",
): RumVitalEvent {
  return {
    schemaVersion: 1,
    metric: {
      id: "m-1",
      name,
      value,
      rating: "good",
      delta: null,
      navigationType: null,
    },
    route,
    release,
    recordedAt: "2026-11-25T10:00:00Z",
  };
}

describe("normalizeRoute", () => {
  it("keeps allowlisted routes and strips the query, hash and trailing slash", () => {
    expect(normalizeRoute("/dashboard?tab=1")).toBe("/dashboard");
    expect(normalizeRoute("/tasks/#/detail")).toBe("/tasks");
    expect(normalizeRoute("/workflows/designer/")).toBe("/workflows/designer");
  });

  it("replaces identifier segments with :id so the label cannot grow", () => {
    expect(normalizeRoute("/tasks/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("/tasks");
    expect(normalizeRoute("/documents/12345")).toBe("/documents");
    expect(normalizeRoute("/admin/deadbeefcafe")).toBe("/admin");
  });

  it("buckets an unknown route as other instead of creating a series", () => {
    expect(normalizeRoute("/some/private/tenant/acme")).toBe("other");
    expect(normalizeRoute("/")).toBe("other");
    expect(normalizeRoute("")).toBe("other");
  });
});

describe("normalizeDeviceClass", () => {
  it("maps real user agents onto four classes", () => {
    expect(
      normalizeDeviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"),
    ).toBe("mobile");
    expect(normalizeDeviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(normalizeDeviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(normalizeDeviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("mobile");
  });

  it("falls back to other for a missing or exotic agent", () => {
    expect(normalizeDeviceClass(null)).toBe("other");
    expect(normalizeDeviceClass("")).toBe("other");
    expect(normalizeDeviceClass("curl/8.0")).toBe("other");
  });
});

describe("normalizeRelease", () => {
  it("keeps semantic versions", () => {
    expect(normalizeRelease("v1.7.0")).toBe("v1.7.0");
    expect(normalizeRelease("1.7.0-rc.1")).toBe("1.7.0-rc.1");
  });

  it("collapses anything else to unknown", () => {
    expect(normalizeRelease(null)).toBe("unknown");
    expect(normalizeRelease("")).toBe("unknown");
    expect(normalizeRelease("feature/my-branch")).toBe("unknown");
  });
});

describe("normalizeMetric", () => {
  it("accepts the allowlist case-insensitively", () => {
    expect(normalizeMetric("lcp")).toBe("LCP");
    expect(normalizeMetric("CLS")).toBe("CLS");
  });

  it("rejects an unknown metric name", () => {
    expect(normalizeMetric("FID")).toBeNull();
    expect(normalizeMetric(undefined)).toBeNull();
  });
});

describe("observeVital", () => {
  it("records a sample into cumulative buckets", () => {
    const registry = createRumRegistry();
    expect(observeVital(registry, event("LCP", 2000))).toMatchObject({ recorded: true });

    const exposition = renderExposition(registry);
    expect(exposition).toContain("awap_rum_vital_milliseconds_bucket");
    expect(exposition).toContain('metric="LCP",route="/dashboard",release="v1.7.0",device="other"');
    expect(exposition).toContain('le="2500"} 1');
    expect(exposition).toContain('le="100"} 0');
    expect(exposition).toContain("awap_rum_vital_milliseconds_count");
  });

  it("uses the CLS histogram for layout shift and keeps the metric out of the ms metric", () => {
    const registry = createRumRegistry();
    observeVital(registry, event("CLS", 0.2));

    const exposition = renderExposition(registry);
    expect(exposition).toContain("awap_rum_cls_bucket");
    expect(exposition).toContain('le="0.25"} 1');
    expect(exposition).not.toContain("awap_rum_vital_milliseconds_bucket");
  });

  it("drops an unknown metric and counts the reason", () => {
    const registry = createRumRegistry();
    expect(observeVital(registry, event("FID", 12))).toEqual({
      recorded: false,
      reason: "unknown_metric",
    });
    expect(renderExposition(registry)).toContain(
      'awap_rum_ingest_dropped_total{reason="unknown_metric"} 1',
    );
  });

  it("drops a negative or non-numeric value", () => {
    const registry = createRumRegistry();
    expect(observeVital(registry, event("LCP", -1))).toEqual({
      recorded: false,
      reason: "invalid_value",
    });
    expect(observeVital(registry, event("LCP", Number.NaN))).toMatchObject({ recorded: false });
  });

  it("bounds the series count and counts the drop", () => {
    const registry = createRumRegistry();
    for (let index = 0; index < MAX_RUM_SERIES; index += 1) {
      observeVital(registry, {
        metric: { name: "LCP", value: 1000 },
        route: "/dashboard",
        release: `v1.0.${index}`,
      });
    }
    const over = observeVital(registry, {
      metric: { name: "INP", value: 120 },
      route: "/dashboard",
      release: "v9.9.9",
    });

    expect(over).toEqual({ recorded: false, reason: "cardinality" });
    expect(renderExposition(registry)).toContain('reason="cardinality"} 1');
  });

  it("uses the user agent for the device label", () => {
    const registry = createRumRegistry();
    observeVital(registry, event("INP", 120), "Mozilla/5.0 (iPhone) Mobile");

    expect(renderExposition(registry)).toContain('device="mobile"');
  });
});

describe("the process-wide registry", () => {
  beforeEach(() => resetRumMetrics());

  it("records through the ingest helper and renders the exposition", () => {
    expect(recordRumVital(event("LCP", 1200), "Mozilla/5.0 (Windows NT 10.0)")).toEqual({
      recorded: true,
    });

    expect(rumExposition()).toContain('metric="LCP"');
    expect(rumExpositionBytes()).toBeGreaterThan(0);
  });

  it("reports a drop for a payload the contract rejects", () => {
    const dropped = recordRumVital(event("UNKNOWN", 1));

    expect(dropped).toEqual({ recorded: false, reason: "unknown_metric" });
  });

  it("resets between screens", () => {
    recordRumVital(event("LCP", 1000));
    resetRumMetrics();

    expect(rumExposition()).not.toContain('metric="LCP"');
  });
});

describe("the label allowlist", () => {
  it("has no tenant, user or free-form label", () => {
    expect(RUM_LABEL_ALLOWLIST.metrics).toEqual(["LCP", "INP", "FCP", "TTFB", "CLS"]);
    expect(RUM_LABEL_ALLOWLIST.routes).toContain("other");
    expect(RUM_LABEL_ALLOWLIST.devices).toEqual(["desktop", "mobile", "tablet", "other"]);
    expect(JSON.stringify(RUM_LABEL_ALLOWLIST)).not.toMatch(/tenant|user/i);
  });
});
