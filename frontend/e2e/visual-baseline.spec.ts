import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { openScreen, SCREENS, type ScreenDefinition } from "./a11yFixtures";

/**
 * Visual regression baseline (UI/UX phase 0, T0-05).
 *
 * The first run writes the baseline images and records a `baseline-created`
 * annotation, so the suite is green while the baseline is being introduced.
 * Every later run compares at four viewports with a 0.1% pixel tolerance.
 *
 * The set is intentionally limited to deterministic, non-canvas screens; the
 * React Flow designer is covered by interaction tests instead.
 */

const VIEWPORTS = [
  { width: 360, height: 800, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1280, height: 800, label: "laptop" },
  { width: 1440, height: 900, label: "desktop" },
];

const VISUAL_SCREEN_NAMES = new Set([
  "login",
  "register",
  "dashboard",
  "tasks",
  "task-detail",
  "workflows",
  "instances",
  "instance-detail",
  "organizations",
  "notifications",
]);

function screenFor(name: string): ScreenDefinition {
  const screen = SCREENS.find((candidate) => candidate.name === name);
  if (!screen) {
    throw new Error(`Unknown visual screen: ${name}`);
  }
  return screen;
}

async function waitForStableLayout(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

for (const viewport of VIEWPORTS) {
  test.describe(`visual baseline (${viewport.label})`, () => {
    for (const name of VISUAL_SCREEN_NAMES) {
      const screen = screenFor(name);
      const state = screen.states.includes("populated") ? "populated" : "empty";

      test(`${name} matches the ${viewport.label} baseline`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openScreen(page, screen, state);
        await waitForStableLayout(page);

        const snapshot = `visual/${name}-${viewport.width}x${viewport.height}.png`;
        const snapshotPath = testInfo.snapshotPath(snapshot);

        if (!existsSync(snapshotPath)) {
          await page.screenshot({ path: snapshotPath, fullPage: true, animations: "disabled" });
          testInfo.annotations.push({
            type: "baseline-created",
            description: snapshotPath,
          });
          return;
        }

        await expect(page).toHaveScreenshot(snapshot, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.001,
        });
      });
    }
  });
}
