import { expect, test } from "@playwright/test";

import { openScreen, SCREENS } from "./a11yFixtures";

/**
 * Responsive, zoom, motion and degraded-mode guarantees (UI/UX phase 10).
 *
 * - 320 px to 1920 px: no route may introduce a document-level horizontal
 *   scrollbar (the matrix from the phase-10 release-readiness scope).
 * - 640 px is half of the 1280 px laptop viewport, the effective layout width at
 *   200% browser zoom.
 * - `prefers-reduced-motion: reduce` collapses every transition and animation.
 * - `forced-colors: active` keeps visible control borders (Windows High Contrast).
 * - Slow-network and unsupported-browser notices render from runtime capability
 *   detection.
 */

test.describe.configure({ timeout: 240_000 });

const MATRIX_WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];

const REFLOW_SCREENS = [
  "login",
  "register",
  "invitation",
  "select-tenant",
  "dashboard",
  "tasks",
  "workflows",
  "documents",
  "notifications",
  "analytics",
  "admin",
  "copilot",
];

function screen(name: string) {
  const found = SCREENS.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`Unknown screen: ${name}`);
  }
  return found;
}

function stateFor(screenName: string): "empty" | "populated" {
  return screen(screenName).states.includes("populated") ? "populated" : "empty";
}

async function documentWidths(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

for (const width of MATRIX_WIDTHS) {
  test(`no route scrolls horizontally at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const definition of SCREENS) {
      const state = definition.states.includes("populated") ? "populated" : "empty";
      await openScreen(page, definition, state);
      const dimensions = await documentWidths(page);
      expect(
        dimensions.scrollWidth,
        `${definition.name} overflows at ${width}px (${dimensions.scrollWidth} > ${dimensions.clientWidth})`,
      ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    }
  });
}

test("200% zoom equivalent does not scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });

  for (const name of REFLOW_SCREENS) {
    await openScreen(page, screen(name), stateFor(name));
    const dimensions = await documentWidths(page);
    expect(
      dimensions.scrollWidth,
      `${name} overflows horizontally at the 200% zoom equivalent`,
    ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

for (const name of REFLOW_SCREENS) {
  test(`${name} collapses transitions and animations under reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openScreen(page, screen(name), stateFor(name));

    const offenders = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>("*"));
      return elements
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            transition: Number.parseFloat(style.transitionDuration || "0"),
            animation: Number.parseFloat(style.animationDuration || "0"),
          };
        })
        .filter((entry) => entry.transition > 0.01 || entry.animation > 0.01)
        .slice(0, 5);
    });
    expect(offenders, `animated elements under reduced motion on ${name}`).toEqual([]);
  });
}

test("forced-colors keeps visible borders and no overflow", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });

  await openScreen(page, screen("dashboard"), "populated");
  const border = await page
    .locator(".awap-button")
    .first()
    .evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(border).not.toBe("none");

  for (const name of ["dashboard", "tasks", "documents"]) {
    await openScreen(page, screen(name), stateFor(name));
    const dimensions = await documentWidths(page);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test("a slow 3G connection shows the slow-network notice", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: {
        effectiveType: "3g",
        saveData: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  });
  await openScreen(page, screen("dashboard"), "populated");
  await expect(page.getByTestId("slow-connection-banner")).toBeVisible();
  await expect(page.getByTestId("slow-connection-banner")).toContainText("skeleton");
});

test("an older browser without IntersectionObserver shows the unsupported-browser notice", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
  });
  await openScreen(page, screen("login"), "empty");
  await expect(page.getByTestId("unsupported-browser-banner")).toBeVisible();
  await expect(page.getByTestId("unsupported-browser-banner")).toContainText(
    "IntersectionObserver",
  );
});
