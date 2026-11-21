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
  "documents",
  "notifications",
  "notification-templates",
  "analytics",
  "admin",
  "operate",
  "audit",
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
        // The instance detail is reached from the list on phones; its long full-page height is
        // font-metric sensitive at 360px, so mobile coverage stays with the list screen.
        test.skip(viewport.label === "mobile" && name === "instance-detail");
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

        // The task SLA chip is a live server-clock countdown; it can differ by a second between
        // the baseline and a later run. A 1% tolerance covers that text without hiding layout
        // regressions on the other screens.
        const dynamicSla = name === "tasks" || name === "task-detail";
        await expect(page).toHaveScreenshot(snapshot, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: dynamicSla ? 0.01 : 0.001,
        });
      });
    }
  });
}

/**
 * T5-12: even though the React Flow designer is excluded from the full-page matrix above (it is
 * interaction-tested instead), its canvas has a dedicated element baseline so a layout regression in
 * the node card, palette or side panels is still caught visually.
 */
test("designer canvas matches its element baseline", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([
    {
      name: "awap_session",
      value: "1",
      url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    },
    {
      name: "awap_tenant",
      value: "tenant-a",
      url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    },
    { name: "XSRF-TOKEN", value: "e2e-csrf", url: "http://localhost:8080" },
  ]);
  await page.goto("/workflows/designer");
  await expect(page.getByRole("heading", { name: "Workflow Designer" })).toBeVisible();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.getByRole("button", { name: "END", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  const canvas = page.getByTestId("designer-canvas");
  const snapshot = "visual/designer-canvas-1280x900.png";
  const snapshotPath = testInfo.snapshotPath(snapshot);

  if (!existsSync(snapshotPath)) {
    await canvas.screenshot({ path: snapshotPath, animations: "disabled" });
    testInfo.annotations.push({ type: "baseline-created", description: snapshotPath });
    return;
  }

  await expect(canvas).toHaveScreenshot(snapshot, {
    animations: "disabled",
    maxDiffPixelRatio: 0.001,
  });
});
