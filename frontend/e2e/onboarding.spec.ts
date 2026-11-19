import { expect, test } from "@playwright/test";

import { installApiMocks, setSession } from "./a11yFixtures";

/**
 * First-login access summary (UI/UX phase 2, T2-09 and R2-07).
 */
test("first login shows an access summary and dismissal persists", async ({ page }) => {
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await installApiMocks(page, true);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const summary = page.getByTestId("access-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Welcome to AWAP");
  await expect(summary).toContainText("pending tasks");
  await expect(summary.getByRole("link", { name: "Open inbox" })).toBeVisible();
  await expect(summary.getByRole("link", { name: "Start a workflow" })).toBeVisible();

  await page.getByTestId("access-summary-dismiss").click();
  await expect(summary).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("access-summary")).toHaveCount(0);
});
