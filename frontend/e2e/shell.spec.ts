import { expect, test } from "@playwright/test";

import { flattenNavItems } from "../lib/navigation";
import { installApiMocks, setSession } from "./a11yFixtures";

/**
 * App Shell and keyboard guarantees (UI/UX phase 1, T1-05 / T1-06 / T1-07 and
 * U1-01 / U1-02 / U1-07).
 */
test.describe.configure({ timeout: 120_000 });

const HEADINGS: Record<string, string> = {
  "/tasks": "Tasks",
  "/workflows": "Workflows",
  "/workflows/designer": "Workflow Designer",
  "/forms/builder": "Form Builder",
  "/forms/fill": "Fill Form",
  "/instances": "Workflow Instances",
  "/documents": "Documents",
  "/analytics": "Analytics",
  "/notifications": "Notifications",
  "/notification-templates": "Notification templates",
  "/organizations": "Organizations",
  "/copilot": "AI Copilot",
  "/admin/csp": "CSP reports",
  "/design-system": "Design system",
};

test("every sidebar destination returns 200 and renders its heading", async ({ page }) => {
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await installApiMocks(page, false);

  for (const item of flattenNavItems()) {
    const response = await page.goto(item.href);
    expect(response?.status(), `${item.href} status`).toBe(200);
    const heading = HEADINGS[item.href];
    if (!heading) {
      throw new Error(`Missing heading map for ${item.href}`);
    }
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  }
});

test("mobile drawer closes with Escape and returns focus to the trigger", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await installApiMocks(page, false);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const trigger = page.getByTestId("open-mobile-menu");
  await trigger.click();
  const drawer = page.getByTestId("mobile-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Inbox" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Ctrl+K opens a command palette with at least 10 results and Enter navigates", async ({
  page,
}) => {
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await installApiMocks(page, false);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.keyboard.press("Control+K");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  expect(await page.getByRole("option").count()).toBeGreaterThanOrEqual(10);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tasks$/);
});

test("a non-admin role hides admin destinations and blocks the admin URL", async ({ page }) => {
  await setSession(page, { tenant: "tenant-a", role: "EMPLOYEE" });
  await installApiMocks(page, false);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "CSP reports" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Design system" })).toHaveCount(0);

  await page.goto("/admin/csp");
  await expect(page.getByTestId("forbidden-state")).toBeVisible();
  await expect(page.getByTestId("forbidden-state")).toContainText(
    "You do not have permission to view this.",
  );
});

test("an unknown route renders the 404 screen with a way back", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute(
    "href",
    "/dashboard",
  );
});

test("the shell does not scroll horizontally at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await installApiMocks(page, false);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("the shell LCP stays below 2.5s on the production stack", async ({ page }) => {
  test.skip(process.env.E2E_EXTERNAL_STACK !== "1", "LCP is measured against the production stack");
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await installApiMocks(page, false);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let value = 0;
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) {
            value = last.startTime;
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(value);
        }, 1000);
      }),
  );
  expect(lcp).toBeGreaterThan(0);
  expect(lcp).toBeLessThan(2500);
});
