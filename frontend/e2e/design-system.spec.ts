import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { installApiMocks, setSession } from "./a11yFixtures";

/**
 * Design-system catalogue gates (UI/UX phase 1, T1-03 / T1-04 / T1-10 and
 * R1-04). The catalogue is the single source used by the visual snapshots,
 * dark-mode axe scan, theme toggle and long-Turkish-text checks.
 */

const VIEWPORTS = [
  { width: 360, height: 800, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1280, height: 800, label: "laptop" },
  { width: 1440, height: 900, label: "desktop" },
];

type Theme = "light" | "dark";

async function openDesignSystem(
  page: Page,
  { theme = "light", locale = "en" }: { theme?: Theme; locale?: "en" | "tr" } = {},
): Promise<void> {
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN", locale });
  await installApiMocks(page, false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((value) => {
    window.localStorage.setItem("awap_theme", value);
  }, theme);
  await page.goto("/design-system");
  await page
    .getByRole("heading", { name: locale === "tr" ? "Tasarım sistemi" : "Design system" })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The brand mark is an image. Wait only for the visible logo so a screenshot can never
  // capture the alt text when the first image request is still in flight. Hidden responsive
  // variants are lazy-loaded and must not block the capture.
  await page.waitForFunction(() => {
    const logos = Array.from(document.querySelectorAll<HTMLImageElement>('img[alt="AWAP"]'));
    return logos.every(
      (image) => image.getClientRects().length === 0 || (image.complete && image.naturalWidth > 0),
    );
  });
  await page.waitForTimeout(200);
}

function formatViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    help: string;
    nodes: Array<{ target: unknown }>;
  }>,
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} [${violation.impact}]: ${violation.help}\n    ${violation.nodes
          .map((node) => JSON.stringify(node.target))
          .join("\n    ")}`,
    )
    .join("\n");
}

for (const theme of ["light", "dark"] as const) {
  test(`design system (${theme}) has no critical or serious axe violations`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDesignSystem(page, { theme });
    if (theme === "dark") {
      await expect(page.locator("html")).toHaveClass(/dark/);
    }

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking, formatViolations(blocking)).toEqual([]);
  });
}

test("theme toggle flips the document between light and dark", async ({ page }) => {
  await openDesignSystem(page, { theme: "light" });
  const toggle = page.getByTestId("theme-toggle");
  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await toggle.click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("long Turkish labels truncate without horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDesignSystem(page, { theme: "light", locale: "tr" });

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

  const longText = page.getByTitle(/Kurumsal iş akışı/);
  await expect(longText).toBeVisible();
  const textOverflow = await longText.evaluate((element) => getComputedStyle(element).textOverflow);
  expect(textOverflow).toBe("ellipsis");
});

for (const theme of ["light", "dark"] as const) {
  for (const viewport of VIEWPORTS) {
    test(`design system ${theme} baseline (${viewport.label})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openDesignSystem(page, { theme });

      const snapshot = `visual/design-system-${theme}-${viewport.width}x${viewport.height}.png`;
      const snapshotPath = testInfo.snapshotPath(snapshot);

      if (!existsSync(snapshotPath)) {
        mkdirSync(dirname(snapshotPath), { recursive: true });
        await page.screenshot({ path: snapshotPath, fullPage: true, animations: "disabled" });
        testInfo.annotations.push({ type: "baseline-created", description: snapshotPath });
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
}
