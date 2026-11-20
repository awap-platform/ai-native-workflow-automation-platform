import {
  PALETTE_GROUPS,
  PALETTE_ITEMS,
  filterPaletteItems,
  nextPaletteIndex,
  paletteByGroup,
  paletteNavigationIndex,
} from "../workflowPalette";
import { NODE_TYPES } from "../workflowDesigner";

describe("workflow palette", () => {
  it("offers every node type in exactly one group", () => {
    expect(PALETTE_ITEMS).toHaveLength(NODE_TYPES.length);
    expect(new Set(PALETTE_ITEMS.map((item) => item.type))).toEqual(new Set(NODE_TYPES));
    for (const item of PALETTE_ITEMS) {
      expect(PALETTE_GROUPS.some((group) => group.id === item.group)).toBe(true);
    }
  });

  it("groups Events, Activities, Gateways, Structural and Extensions", () => {
    const groups = paletteByGroup();
    expect(groups.map((group) => group.label)).toEqual([
      "Events",
      "Activities",
      "Gateways",
      "Structural",
      "Extensions",
    ]);
    expect(groups.find((group) => group.id === "events")?.items.map((item) => item.type)).toEqual([
      "START",
      "END",
      "DELAY",
    ]);
    expect(
      groups.find((group) => group.id === "activities")?.items.map((item) => item.type),
    ).toEqual(["FORM", "APPROVAL", "TASK", "AI_TASK"]);
  });

  it("filters by type, label and keyword case-insensitively", () => {
    expect(filterPaletteItems("web").map((item) => item.type)).toEqual(["WEBHOOK"]);
    expect(filterPaletteItems("branch").map((item) => item.type)).toContain("DECISION");
    expect(filterPaletteItems("timer").map((item) => item.type)).toEqual(["DELAY"]);
    expect(filterPaletteItems("  approval ").map((item) => item.type)).toEqual(["APPROVAL"]);
    expect(filterPaletteItems("no-such-node")).toEqual([]);
  });

  it("omits empty groups from a filtered result", () => {
    const groups = paletteByGroup("webhook");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("extensions");
  });

  it("wraps keyboard navigation inside the result list", () => {
    expect(nextPaletteIndex(0, 3, -1)).toBe(2);
    expect(nextPaletteIndex(2, 3, 1)).toBe(0);
    expect(nextPaletteIndex(1, 0, 1)).toBe(-1);
    expect(paletteNavigationIndex("ArrowDown", -1, 3)).toBe(0);
    expect(paletteNavigationIndex("ArrowUp", -1, 3)).toBe(2);
    expect(paletteNavigationIndex("Home", 2, 3)).toBe(0);
    expect(paletteNavigationIndex("End", 0, 3)).toBe(2);
    expect(paletteNavigationIndex("Enter", 0, 3)).toBeNull();
  });
});
