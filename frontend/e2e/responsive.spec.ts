import { expect, test } from "@playwright/test";

import { openScreen, SCREENS } from "./a11yFixtures";

/**
 * Responsive and motion guarantees (UI/UX phase 0, U0-06 and U0-07).
 *
 * 640 px is half of the 1280 px laptop viewport, the effective layout width at
 * 200% browser zoom. The primary screens must reflow instead of introducing a
 * horizontal scrollbar. Reduced motion must collapse every transition and
 * animation to (effectively) zero.
 */

const REFLOW_SCREENS = [
  "login",
  "register",
  "dashboard",
  "tasks",
  "workflows",
  "documents",
  "notifications",
];

function screen(name: string) {
  const found = SCREENS.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`Unknown screen: ${name}`);
  }
  return found;
}

test("200% zoom equivalent does not scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });

  for (const name of REFLOW_SCREENS) {
    await openScreen(page, screen(name), "populated");
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      dimensions.scrollWidth,
      `${name} overflows horizontally at the 200% zoom equivalent`,
    ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test("reduced motion collapses transitions and animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openScreen(page, screen("login"), "empty");

  const durations = await page.evaluate(() => {
    const button = document.querySelector('[data-slot="button"]');
    if (!button) {
      return null;
    }
    const style = getComputedStyle(button);
    return {
      transition: style.transitionDuration,
      animation: style.animationDuration,
    };
  });

  expect(durations).not.toBeNull();
  expect(Number.parseFloat(durations?.transition ?? "0")).toBeLessThanOrEqual(0.01);
  expect(Number.parseFloat(durations?.animation ?? "0")).toBeLessThanOrEqual(0.01);
});
