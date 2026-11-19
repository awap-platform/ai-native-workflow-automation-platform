import { expect, test, type Page } from "@playwright/test";

import { installApiMocks, setSession } from "./a11yFixtures";

/**
 * Visible session expiry (UI/UX phase 2, U2-05 and T2-12).
 */
const API = "**/api/v1/**";

async function seedExpiringSession(page: Page) {
  await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
  await page.context().addCookies([
    {
      name: "awap_session_expires_at",
      value: String(Date.now() + 30_000),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
  await installApiMocks(page, false);
}

test("warns before expiry and keeps the session after refresh", async ({ page }) => {
  await seedExpiringSession(page);
  await page.route(`${API}auth/refresh`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accessToken: null, refreshToken: null, expiresIn: 3600 }),
    }),
  );

  await page.goto("/dashboard");
  const warning = page.getByTestId("session-timeout-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Your session expires in");

  await page.getByRole("button", { name: "Stay signed in" }).click();
  await expect(warning).toBeHidden();
});

test("a failed refresh returns to login with an expired-session reason", async ({ page }) => {
  await seedExpiringSession(page);
  await page.route(`${API}auth/refresh`, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({ title: "Unauthorized", status: 401 }),
    }),
  );

  await page.goto("/dashboard");
  await expect(page.getByTestId("session-timeout-warning")).toBeVisible();
  await page.getByRole("button", { name: "Stay signed in" }).click();

  await expect(page).toHaveURL(/\?reason=expired/);
  await expect(page.getByTestId("login-notice")).toContainText("session expired");
});
