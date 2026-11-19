import {
  EMAIL_MAX_LENGTH,
  isValidEmail,
  isValidFullName,
  isValidTenantName,
  isValidTenantSlug,
} from "../validation";

describe("onboarding validation", () => {
  it("validates emails and enforces the 254 character limit", () => {
    expect(isValidEmail("ada@acme.com")).toBe(true);
    expect(isValidEmail("ada@acme")).toBe(false);
    expect(isValidEmail("ada @acme.com")).toBe(false);
    expect(isValidEmail(`${"a".repeat(EMAIL_MAX_LENGTH)}@acme.com`)).toBe(false);
  });

  it("validates tenant slugs and names", () => {
    expect(isValidTenantSlug("acme")).toBe(true);
    expect(isValidTenantSlug("acme-inc")).toBe(true);
    expect(isValidTenantSlug("ab")).toBe(false);
    expect(isValidTenantSlug("-acme")).toBe(false);
    expect(isValidTenantSlug("Acme")).toBe(false);
    expect(isValidTenantName("Acme Inc")).toBe(true);
    expect(isValidTenantName("A")).toBe(false);
  });

  it("validates full names", () => {
    expect(isValidFullName("Ada Lovelace")).toBe(true);
    expect(isValidFullName("A")).toBe(false);
  });
});
