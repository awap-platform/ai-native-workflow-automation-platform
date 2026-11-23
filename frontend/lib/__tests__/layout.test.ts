import { hasHorizontalOverflow, rectsOverlap } from "../layout";

describe("layout geometry", () => {
  it("detects a synthetic overlap and ignores touching or distant boxes", () => {
    const base = { x: 0, y: 0, width: 100, height: 20 };
    expect(rectsOverlap(base, { x: 90, y: 0, width: 20, height: 20 })).toBe(true);
    expect(rectsOverlap(base, { x: 100, y: 0, width: 20, height: 20 })).toBe(false);
    expect(rectsOverlap(base, { x: 0, y: 20, width: 20, height: 20 })).toBe(false);
    expect(rectsOverlap(base, null)).toBe(false);
  });

  it("detects horizontal overflow only when scroll width exceeds client width", () => {
    expect(hasHorizontalOverflow(321, 320)).toBe(true);
    expect(hasHorizontalOverflow(320, 320)).toBe(false);
    expect(hasHorizontalOverflow(300, 320)).toBe(false);
  });
});
