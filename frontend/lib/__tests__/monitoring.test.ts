import {
  RUM_SCHEMA_VERSION,
  buildRumVitalEvent,
  createVitalSender,
  isRumVitalEvent,
  isWebVitalSample,
  sanitizeRoute,
  type WebVitalSample,
} from "../monitoring";

const LCP: WebVitalSample = {
  id: "v1-123",
  name: "LCP",
  value: 1800,
  rating: "good",
  delta: 0,
  navigationType: "navigate",
};

describe("route sanitisation", () => {
  it("drops query strings and fragments", () => {
    expect(sanitizeRoute("/analytics?from=2026-11-02&tenant=tenant-a#chart")).toBe("/analytics");
  });

  it("masks numeric and UUID path segments", () => {
    expect(sanitizeRoute("/tasks/42")).toBe("/tasks/:n");
    expect(sanitizeRoute("/instances/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
      "/instances/:id",
    );
  });

  it("keeps named routes intact", () => {
    expect(sanitizeRoute("/workflows/designer")).toBe("/workflows/designer");
    expect(sanitizeRoute("")).toBe("/");
  });
});

describe("RUM envelope", () => {
  it("builds a stable envelope with schema version and null defaults", () => {
    const event = buildRumVitalEvent({
      metric: { id: "cls-1", name: "CLS", value: 0.03, rating: "good" },
      route: "/dashboard?tab=all",
      release: "1.7.0",
      now: new Date("2026-11-21T10:00:00.000Z"),
    });
    expect(event).toEqual({
      schemaVersion: RUM_SCHEMA_VERSION,
      metric: {
        id: "cls-1",
        name: "CLS",
        value: 0.03,
        rating: "good",
        delta: null,
        navigationType: null,
      },
      route: "/dashboard",
      release: "1.7.0",
      recordedAt: "2026-11-21T10:00:00.000Z",
    });
    expect(isRumVitalEvent(event)).toBe(true);
  });

  it("rejects a payload without a route or schema version", () => {
    expect(isRumVitalEvent({ schemaVersion: 1, metric: { name: "LCP", value: 1 } })).toBe(false);
    expect(
      isRumVitalEvent({ schemaVersion: 2, route: "/", release: "1", recordedAt: "", metric: {} }),
    ).toBe(false);
    expect(isRumVitalEvent(null)).toBe(false);
  });

  it("recognises a valid Web Vital sample and rejects malformed ones", () => {
    expect(isWebVitalSample(LCP)).toBe(true);
    expect(isWebVitalSample({ ...LCP, value: Number.NaN })).toBe(false);
    expect(isWebVitalSample({ id: "x" })).toBe(false);
  });
});

describe("vital sender (flag on/off behaviour)", () => {
  it("does not send when the flag is disabled", () => {
    const send = jest.fn();
    const reporter = createVitalSender({ enabled: false, endpoint: "/api/rum", release: "test", send });
    expect(reporter(LCP, "/dashboard")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends one same-origin JSON beacon when enabled", () => {
    const send = jest.fn();
    const reporter = createVitalSender({
      enabled: true,
      endpoint: "/api/rum",
      release: "test",
      send,
      now: () => new Date("2026-11-21T10:00:00.000Z"),
    });
    expect(reporter(LCP, "/tasks?task=1")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, body] = send.mock.calls[0]!;
    expect(url).toBe("/api/rum");
    const payload = JSON.parse(body);
    expect(payload.route).toBe("/tasks");
    expect(payload.metric.name).toBe("LCP");
    expect(payload.release).toBe("test");
    expect(body).not.toContain("task=1");
  });

  it("ignores an invalid metric without throwing", () => {
    const send = jest.fn();
    const reporter = createVitalSender({ enabled: true, endpoint: "/api/rum", release: "test", send });
    expect(reporter({ name: "LCP" }, "/dashboard")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a transport failure", () => {
    const reporter = createVitalSender({
      enabled: true,
      endpoint: "/api/rum",
      release: "test",
      send: () => {
        throw new Error("offline");
      },
    });
    expect(reporter(LCP, "/dashboard")).toBe(false);
  });
});
