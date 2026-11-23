import { expect, test } from "@playwright/test";

import { hasHorizontalOverflow, rectsOverlap } from "../lib/layout";
import { openScreen, SCREENS } from "./a11yFixtures";

/**
 * Issue 360: visual baselines only prove "no change"; these structural assertions prove the
 * layout itself is sound on the same multi-row fixture the baselines use.
 */

const tasksScreen = SCREENS.find((screen) => screen.name === "tasks");
if (!tasksScreen) {
  throw new Error("The tasks screen fixture is missing.");
}

const ROW_IDS = ["task-1", "task-long", "task-tr"];

test("the three-row inbox has no overlapping cells or visible selection labels", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScreen(page, tasksScreen, "populated");

  await expect(page.getByTestId(/^task-row-/)).toHaveCount(3);
  // The visual fixture now sets a real role; no baseline may contain "Role: Unknown".
  await expect(page.getByTestId("sidebar-role")).toContainText("MANAGER");
  await expect(page.getByTestId("sidebar-role")).not.toContainText("Unknown");

  for (const id of ROW_IDS) {
    const title = page.getByTestId(`task-row-${id}`);
    const row = title.locator("xpath=..");
    const checkbox = page.getByTestId(`task-check-${id}`);
    await expect(checkbox).toHaveAttribute("aria-label", /^Select /);
    // Row labels stay in the accessibility tree, never as visible text. The select-all label
    // outside the rows is intentionally visible, so the assertion is scoped to each row.
    await expect(row.getByText(/^Select /)).toHaveCount(0);

    const [checkboxBox, titleBox, badgeBox, slaBox] = await Promise.all([
      checkbox.boundingBox(),
      title.locator("span").first().boundingBox(),
      row.getByTestId(/^task-status-/).boundingBox(),
      row.getByTestId(/^task-sla-/).boundingBox(),
    ]);

    expect(rectsOverlap(checkboxBox, titleBox), `${id}: checkbox/title`).toBe(false);
    expect(rectsOverlap(titleBox, badgeBox), `${id}: title/badge`).toBe(false);
    expect(rectsOverlap(titleBox, slaBox), `${id}: title/SLA`).toBe(false);
    expect(rectsOverlap(badgeBox, slaBox), `${id}: badge/SLA`).toBe(false);
  }
});

test("the three-row inbox does not scroll horizontally at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openScreen(page, tasksScreen, "populated");
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(3);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(hasHorizontalOverflow(scrollWidth, clientWidth)).toBe(false);
});
