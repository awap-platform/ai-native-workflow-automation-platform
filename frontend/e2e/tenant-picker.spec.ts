import { expect, test, type Page } from "@playwright/test";

/**
 * Tenant picker (UI/UX phase 2, T2-05 / T2-06 / T2-07 and U2-06 / U2-11).
 */
const API = "**/api/v1/**";

async function seedSession(page: Page) {
  await page.context().addCookies([
    { name: "awap_session", value: "1", url: "http://localhost:3000", sameSite: "Lax" },
  ]);
}

async function mockDashboard(page: Page) {
  await page.route(`${API}tasks`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}workflow-instances`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}notifications/unread-count`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' }),
  );
}

test("a single tenant is selected automatically", async ({ page }) => {
  await seedSession(page);
  await mockDashboard(page);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ tenantId: "tenant-a", role: "TENANT_ADMIN" }]),
    }),
  );

  await page.goto("/select-tenant");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("multiple tenants show cards and persist the chosen tenant", async ({ page }) => {
  await seedSession(page);
  await mockDashboard(page);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { tenantId: "tenant-a", role: "TENANT_ADMIN" },
        { tenantId: "tenant-b", role: "EMPLOYEE" },
      ]),
    }),
  );

  await page.goto("/select-tenant");
  await expect(page.getByTestId("tenant-card-tenant-a")).toBeVisible();
  await page
    .getByTestId("tenant-card-tenant-b")
    .getByRole("button", { name: "Continue" })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "awap_tenant")?.value).toBe("tenant-b");
});

test("a forbidden membership lookup shows the forbidden state (T2-07)", async ({ page }) => {
  await seedSession(page);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      body: JSON.stringify({ title: "Forbidden", status: 403 }),
    }),
  );

  await page.goto("/select-tenant");
  await expect(page.getByTestId("forbidden-state")).toBeVisible();
  await expect(page).toHaveURL(/\/select-tenant/);
});

test("a server failure shows an error with retry (U2-06)", async ({ page }) => {
  await seedSession(page);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ title: "Server error", status: 500 }),
    }),
  );

  await page.goto("/select-tenant");
  await expect(page.getByTestId("error-state")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a user without access gets an explanation and admin CTA (U2-11)", async ({ page }) => {
  await seedSession(page);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto("/select-tenant");
  await expect(page.getByTestId("tenant-empty-state")).toBeVisible();
  await expect(page.getByText("contact your workspace administrator")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create tenant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
