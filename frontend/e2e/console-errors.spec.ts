import { expect, test, type Page } from "@playwright/test";

import { openScreen, SCREENS } from "./a11yFixtures";

/**
 * Zero-console-error gate (UI/UX phase 0, T0-01 / T0-02 / T0-03).
 *
 * For every screen this spec asserts:
 * - no console error (including CSP violations reported by the browser),
 * - no uncaught page error,
 * - no React hydration mismatch (#418 / #423 / "Hydration failed"),
 * - no `securitypolicyviolation` event.
 *
 * It runs in the same deterministic mock environment as the accessibility
 * suite, so a failure points at the application, not at a missing backend.
 */

interface ViolationEvent {
  directive: string;
  blockedURI: string;
  sourceFile: string;
}

const HYDRATION_PATTERN = /hydration|#418|#423|did not match|server rendered/i;

async function installCspProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __awapCspViolations__?: ViolationEvent[] };
    target.__awapCspViolations__ = [];
    window.addEventListener("securitypolicyviolation", (event) => {
      target.__awapCspViolations__?.push({
        directive: event.violatedDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
      });
    });
  });
}

for (const screen of SCREENS) {
  test(`${screen.name} has no console errors, page errors, hydration errors or CSP violations`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    await installCspProbe(page);

    await openScreen(page, screen, "empty");
    // Give React one tick to finish the hydration commit before reading state.
    await page.waitForTimeout(300);

    const violations = await page.evaluate(() => {
      const target = window as unknown as { __awapCspViolations__?: ViolationEvent[] };
      return target.__awapCspViolations__ ?? [];
    });

    expect(
      violations,
      `CSP violations on ${screen.path}: ${JSON.stringify(violations)}`,
    ).toEqual([]);
    expect(pageErrors, `uncaught page errors on ${screen.path}`).toEqual([]);

    const hydrationErrors = consoleErrors.filter((message) => HYDRATION_PATTERN.test(message));
    expect(
      hydrationErrors,
      `hydration errors on ${screen.path}: ${hydrationErrors.join("\n")}`,
    ).toEqual([]);

    expect(
      consoleErrors,
      `console errors on ${screen.path}: ${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
}
