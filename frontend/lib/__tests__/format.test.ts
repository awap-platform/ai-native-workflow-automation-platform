import { formatNumber, formatPercent, formatUtcDate, formatUtcDateTime } from "../format";

describe("format", () => {
  it("formats timestamps deterministically in UTC", () => {
    expect(formatUtcDateTime("2026-11-09T10:00:00.000Z")).toBe("09 Nov 2026, 10:00 UTC");
    expect(formatUtcDate("2026-11-09T10:00:00.000Z")).toBe("09 Nov 2026");
  });

  it("returns an em dash for missing or invalid values", () => {
    expect(formatUtcDateTime(null)).toBe("—");
    expect(formatUtcDateTime(undefined)).toBe("—");
    expect(formatUtcDateTime("not-a-date")).toBe("—");
    expect(formatUtcDate("not-a-date")).toBe("—");
  });

  it("formats numbers and ratios with the en-GB locale", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatPercent(0.1429)).toBe("14.3%");
  });
});
