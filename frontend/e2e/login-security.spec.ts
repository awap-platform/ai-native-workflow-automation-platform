import { expect, test, type Page } from "@playwright/test";

/**
 * Login security and resilience (UI/UX phase 2, T2-03 / T2-04 / T2-11 and
 * U2-07).
 */

const API = "**/api/v1/**";

async function mockLogin(
  page: Page,
  status: number,
  options: { retryAfter?: number; body?: unknown } = {},
) {
  await page.route(`${API}auth/login`, async (route) => {
    const headers: Record<string, string> = {};
    if (options.retryAfter !== undefined) {
      headers["retry-after"] = String(options.retryAfter);
    }
    if (status === 200) {
      headers["set-cookie"] = "awap_session=1; Path=/";
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      headers,
      body: JSON.stringify(options.body ?? {}),
    });
  });
}

async function fillLogin(page: Page, password = "wrong") {
  await page.getByLabel("Tenant slug").fill("acme");
  await page.getByLabel("Email").fill("ada@acme.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
}

test("wrong credentials show one generic message and keep the URL", async ({ page }) => {
  await mockLogin(page, 401, { body: { detail: "Unknown tenant" } });
  await page.goto("/");
  await fillLogin(page);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("login-error")).toContainText(
    "Email or password is incorrect.",
  );
  await expect(page).toHaveURL(/\/$/);
});

test("rate limiting shows Retry-After and disables the submit button", async ({ page }) => {
  await mockLogin(page, 429, { retryAfter: 30 });
  await page.goto("/");
  await fillLogin(page);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("login-error")).toContainText("Too many attempts");
  await expect(page.getByTestId("login-error")).toContainText("Try again in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
});

test("a temporary auth outage is explained", async ({ page }) => {
  await mockLogin(page, 503, { retryAfter: 10 });
  await page.goto("/");
  await fillLogin(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-error")).toContainText(
    "Sign-in is temporarily unavailable",
  );
});

test("an expired session shows a reason banner on the login page", async ({ page }) => {
  await page.goto("/?reason=expired");
  await expect(page.getByTestId("login-notice")).toContainText("Your session expired");
});

test("returnTo cannot become an open redirect", async ({ page }) => {
  await mockLogin(page, 200);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ tenantId: "tenant-a", role: "TENANT_ADMIN" }]),
    }),
  );
  await page.route(`${API}tasks`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}workflow-instances`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}notifications/unread-count`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' }),
  );

  await page.goto("/?returnTo=//evil.com");
  await fillLogin(page, "Str0ng-Passw0rd!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).not.toHaveURL(/evil\.com/);
});

test("a safe returnTo survives login and tenant selection", async ({ page }) => {
  await mockLogin(page, 200);
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ tenantId: "tenant-a", role: "TENANT_ADMIN" }]),
    }),
  );
  await page.route(`${API}tasks`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}workflow-instances`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}notifications/unread-count`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' }),
  );

  await page.goto("/?returnTo=/tasks");
  await fillLogin(page, "Str0ng-Passw0rd!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
});

test("double submit sends exactly one login request", async ({ page }) => {
  let calls = 0;
  await page.route(`${API}auth/login`, async (route) => {
    calls += 1;
    // Hold the response so both clicks land while the first request is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "set-cookie": "awap_session=1; Path=/" },
      body: "{}",
    });
  });
  await page.route(`${API}auth/tenants`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`${API}notifications/unread-count`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' }),
  );

  await page.goto("/");
  await fillLogin(page, "Str0ng-Passw0rd!");
  const button = page.getByRole("button", { name: "Sign in" });
  await Promise.all([button.click(), button.click().catch(() => undefined)]);
  await page.waitForTimeout(500);
  expect(calls).toBe(1);
});
