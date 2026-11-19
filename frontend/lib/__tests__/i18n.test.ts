import {
  formatDateTimeForLocale,
  formatNumberForLocale,
  isLocale,
  plural,
  resolveLocale,
  t,
} from "../i18n";

describe("i18n", () => {
  it("translates and interpolates in both catalogs", () => {
    expect(t("en", "nav.myWork")).toBe("My Work");
    expect(t("tr", "nav.myWork")).toBe("İşlerim");
    expect(t("en", "shell.tenant", { tenant: "acme" })).toBe("Tenant: acme");
  });

  it("falls back to the default locale and then to the key", () => {
    expect(t("tr", "missing.key")).toBe("missing.key");
    expect(t("en", "state.retry", { unused: "x" })).toBe("Retry");
  });

  it("resolves locales and rejects unsupported tags", () => {
    expect(resolveLocale("tr-TR")).toBe("tr");
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("de")).toBe(false);
  });

  it("selects CLDR plural forms", () => {
    const forms = { one: "{count} task", other: "{count} tasks" };
    expect(plural("en", 1, forms)).toBe("1 task");
    expect(plural("en", 2, forms)).toBe("2 tasks");
    expect(plural("tr", 2, forms)).toBe("2 tasks");
  });

  it("formats numbers and dates with an explicit locale and UTC", () => {
    expect(formatNumberForLocale("en", 1234567)).toBe("1,234,567");
    expect(formatDateTimeForLocale("en", "2026-11-09T10:00:00.000Z")).toContain("2026");
    expect(formatDateTimeForLocale("en", "not-a-date")).toBe("—");
  });
});
