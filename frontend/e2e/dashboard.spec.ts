import { expect, test } from "@playwright/test";

import { installApiMocks, setSession } from "./a11yFixtures";

/**
 * Issue 364: the dashboard answers "what needs attention now?" with pending work, SLA risk,
 * recent activity and a seven-day trend, each with its own states and deep links.
 */

test("dashboard surfaces pending work, SLA risk, activity and trend", async ({ page }) => {
  await setSession(page, { tenant: "tenant-a", role: "MANAGER" });
  await installApiMocks(page, true);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const attention = page.getByTestId("dashboard-needs-attention");
  await expect(attention).toContainText("Approve expense");
  await expect(attention.getByRole("link", { name: "Approve expense" })).toHaveAttribute(
    "href",
    "/tasks?task=task-1",
  );

  await expect(page.getByTestId("dashboard-sla-overdue")).toHaveText("1");
  await expect(page.getByTestId("dashboard-sla-unassigned")).toHaveText("0");

  await expect(page.getByTestId("dashboard-recent-activity")).toContainText("wf-1");
  await expect(page.getByTestId("dashboard-trend")).toContainText("44");
  await expect(page.getByTestId("dashboard-onboarding")).toHaveCount(0);
});

test("an empty tenant gets onboarding and explicit per-widget empty states", async ({ page }) => {
  await setSession(page, { tenant: "tenant-a", role: "MANAGER" });
  await installApiMocks(page, false);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await expect(page.getByTestId("dashboard-needs-attention")).toContainText(
    "Nothing needs attention.",
  );
  await expect(page.getByTestId("dashboard-recent-activity")).toContainText(
    "No workflow activity yet.",
  );
  await expect(page.getByTestId("dashboard-trend")).toContainText("No events");
  await expect(page.getByTestId("dashboard-onboarding")).toBeVisible();
});

test("a failing trend API does not blank the other widgets", async ({ page }) => {
  await setSession(page, { tenant: "tenant-a", role: "MANAGER" });
  await installApiMocks(page, true);
  await page.route("**/api/v1/analytics/overview**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/dashboard");

  await expect(page.getByTestId("dashboard-trend")).toContainText("Trend is unavailable");
  await expect(page.getByTestId("dashboard-needs-attention")).toContainText("Approve expense");
  await expect(page.getByTestId("dashboard-sla-risk")).toContainText("Overdue");
});
