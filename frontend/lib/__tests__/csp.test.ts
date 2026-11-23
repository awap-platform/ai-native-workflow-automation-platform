import {
  buildCsp,
  CSP_REPORT_TO,
  CSP_STYLE_ATTR_EXCEPTION_EXPIRY,
  cspHeaderName,
  generateNonce,
  redactCspReport,
  redactUrl,
  resolveStyleAttrException,
  type CspOptions,
} from "../csp";

const DURING_EXCEPTION = new Date("2026-11-19T00:00:00.000Z");
const AFTER_EXPIRY = new Date("2027-01-01T00:00:00.000Z");

function policy(overrides: Partial<CspOptions> = {}): string {
  return buildCsp({
    nonce: "abc123",
    apiOrigins: "https://api.example.com",
    now: DURING_EXCEPTION,
    ...overrides,
  });
}

describe("csp", () => {
  const originalFlag = process.env.CSP_STYLE_ATTR_UNSAFE_INLINE;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.CSP_STYLE_ATTR_UNSAFE_INLINE;
    } else {
      process.env.CSP_STYLE_ATTR_UNSAFE_INLINE = originalFlag;
    }
  });

  it("generates a URL-safe nonce with the requested entropy", () => {
    const nonce = generateNonce((bytes) => bytes.fill(255));
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce.length).toBe(22);
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it("builds a nonce policy that never allows unsafe script execution", () => {
    const csp = policy();
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("style-src-elem 'self' 'nonce-abc123'");
    expect(csp).toContain("connect-src 'self' https://api.example.com");
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("report-to csp-endpoint");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("blocks style attributes by default on every ordinary route", () => {
    const csp = policy();
    expect(csp).toContain("style-src-attr 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });

  it("allows only the reviewed designer geometry surface", () => {
    const csp = policy({ styleAttr: "unsafe-inline" });
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    // The exception is still scoped to attributes; inline <style>/<script> need the nonce.
    expect(csp).not.toMatch(/style-src-elem[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("fails the build after the exception expiry", () => {
    expect(() => resolveStyleAttrException(AFTER_EXPIRY)).toThrow(/expired/);
    expect(CSP_STYLE_ATTR_EXCEPTION_EXPIRY).toBe("2026-12-31T00:00:00.000Z");
  });

  it("adds upgrade-insecure-requests only when requested", () => {
    expect(policy()).not.toContain("upgrade-insecure-requests");
    expect(policy({ upgradeInsecureRequests: true })).toContain("upgrade-insecure-requests");
  });

  it("locks down object, frame and base directives", () => {
    const csp = policy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("uses the report-only header name when requested", () => {
    expect(cspHeaderName(false)).toBe("Content-Security-Policy");
    expect(cspHeaderName(true)).toBe("Content-Security-Policy-Report-Only");
    expect(CSP_REPORT_TO).toContain('"url":"/api/csp-report"');
  });

  it("redacts query strings and credentials from report URLs", () => {
    expect(redactUrl("https://user:pass@example.com/page?token=secret#frag")).toBe(
      "https://example.com/page",
    );
    expect(redactUrl("/relative?token=secret")).toBe("/relative");
  });

  it("drops script samples and sensitive fields from the report", () => {
    const redacted = redactCspReport(
      {
        "csp-report": {
          "document-uri": "https://app.example.com/tasks?token=abc",
          "blocked-uri": "https://evil.example.com/x?y=1",
          "script-sample": "document.cookie",
          "violated-directive": "script-src",
          "effective-directive": "script-src-elem",
          "line-number": 12,
          "column-number": 3,
          cookie: "awap_session=1",
          authorization: "Bearer secret",
        },
      },
      DURING_EXCEPTION,
    );
    const report = redacted["csp-report"] as Record<string, unknown>;
    expect(report["document-uri"]).toBe("https://app.example.com/tasks");
    expect(report["blocked-uri"]).toBe("https://evil.example.com/x");
    expect(report["script-sample"]).toBe("[redacted]");
    expect(report["line-number"]).toBe(12);
    expect(report).not.toHaveProperty("cookie");
    expect(report).not.toHaveProperty("authorization");
    expect(JSON.stringify(redacted)).not.toContain("token=abc");
    expect(redacted.timestamp).toBe(DURING_EXCEPTION.toISOString());
  });

  it("handles malformed reports without throwing", () => {
    expect(() => redactCspReport(null)).not.toThrow();
    expect(redactCspReport("nope")).toHaveProperty("csp-report");
  });
});
