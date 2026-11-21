import {
  SUPPORTED_BROWSERS,
  assessBrowserSupport,
  detectBrowserCapabilities,
  isSlowConnection,
} from "../browserSupport";

const MODERN = {
  promise: true,
  fetch: true,
  intl: true,
  intersectionObserver: true,
  matchMedia: true,
};

describe("browser capabilities", () => {
  it("detects the capabilities the shell needs", () => {
    expect(
      detectBrowserCapabilities({
        Promise: function Promise() {},
        fetch: () => Promise.resolve(),
        Intl: {},
        IntersectionObserver: class {},
        matchMedia: () => ({}),
      }),
    ).toEqual(MODERN);
  });

  it("accepts a modern browser", () => {
    expect(assessBrowserSupport(MODERN)).toEqual({ supported: true, missing: [] });
  });

  it("lists every missing capability so the warning is actionable", () => {
    expect(
      assessBrowserSupport({ ...MODERN, promise: false, intersectionObserver: false }),
    ).toEqual({ supported: false, missing: ["Promise", "IntersectionObserver"] });
  });

  it("publishes the supported browser floor", () => {
    expect(SUPPORTED_BROWSERS.map((browser) => browser.name)).toEqual([
      "Chrome",
      "Edge",
      "Firefox",
      "Safari",
    ]);
    for (const browser of SUPPORTED_BROWSERS) {
      expect(browser.minimumMajor).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("slow connection detection", () => {
  it("treats 2G, 3G and data-saver as slow", () => {
    expect(isSlowConnection("3g", false)).toBe(true);
    expect(isSlowConnection("2g", false)).toBe(true);
    expect(isSlowConnection("slow-2g", false)).toBe(true);
    expect(isSlowConnection("4g", true)).toBe(true);
  });

  it("does not flag a fast connection", () => {
    expect(isSlowConnection("4g", false)).toBe(false);
    expect(isSlowConnection(undefined, undefined)).toBe(false);
  });
});
