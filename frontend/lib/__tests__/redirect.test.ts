import { safeReturnTo } from "../redirect";

describe("safeReturnTo", () => {
  it("allows same-origin relative paths and preserves query/hash", () => {
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("/tasks?filter=mine#top")).toBe("/tasks?filter=mine#top");
    expect(safeReturnTo("/admin/csp")).toBe("/admin/csp");
  });

  it("rejects open redirects and protocol-relative URLs", () => {
    expect(safeReturnTo("//evil.com")).toBe("/dashboard");
    expect(safeReturnTo("https://evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/\\evil.com")).toBe("/dashboard");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/dashboard");
    expect(safeReturnTo("dashboard")).toBe("/dashboard");
    expect(safeReturnTo("")).toBe("/dashboard");
    expect(safeReturnTo(null)).toBe("/dashboard");
  });

  it("rejects auth-loop destinations", () => {
    expect(safeReturnTo("/login")).toBe("/dashboard");
    expect(safeReturnTo("/register?step=2")).toBe("/dashboard");
    expect(safeReturnTo("/invitations/accept?token=x")).toBe("/dashboard");
    expect(safeReturnTo("/select-tenant")).toBe("/dashboard");
  });
});
