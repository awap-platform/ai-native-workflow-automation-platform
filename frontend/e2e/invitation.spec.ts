import { expect, test, type Page } from "@playwright/test";

/**
 * Invitation acceptance (UI/UX phase 2, T2-08 and U2-04).
 */
const API = "**/api/v1/**";
const STRONG_PASSWORD = "Str0ng-Passw0rd!";

async function mockCsrf(page: Page) {
  await page.route(`${API}auth/csrf`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "set-cookie": "XSRF-TOKEN=test-token; Path=/" },
      body: "{}",
    }),
  );
}

test("a new user creates an account and is sent to sign in", async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await mockCsrf(page);
  await page.route(`${API}tenant-invitations/t1/accept`, async (route) => {
    body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "tenant-1", slug: "acme", name: "Acme" }),
    });
  });

  await page.goto("/invitations/accept?token=t1");
  await expect(page.getByRole("heading", { name: "Accept invitation" })).toBeVisible();
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Password", { exact: true }).fill(STRONG_PASSWORD);
  await page.getByLabel("Confirm password").fill(STRONG_PASSWORD);
  await page.getByRole("button", { name: "Accept invitation" }).click();

  await expect(page).toHaveURL(/\/\?invited=1&tenant=acme/);
  expect(body).toMatchObject({ fullName: "Ada Lovelace", password: STRONG_PASSWORD });
});

test("an existing user accepts without a password", async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await mockCsrf(page);
  await page.route(`${API}tenant-invitations/t2/accept`, async (route) => {
    body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "tenant-1", slug: "acme", name: "Acme" }),
    });
  });

  await page.goto("/invitations/accept?token=t2");
  await page.getByLabel("I already have an account").check();
  await page.getByRole("button", { name: "Accept invitation" }).click();

  await expect(page).toHaveURL(/\/\?invited=1&tenant=acme/);
  expect(body).toEqual({});
});

test("an expired or consumed invitation explains how to recover (U2-04)", async ({ page }) => {
  await mockCsrf(page);
  await page.route(`${API}tenant-invitations/t3/accept`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      body: JSON.stringify({ title: "Conflict", detail: "Invitation already consumed" }),
    }),
  );

  await page.goto("/invitations/accept?token=t3");
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Password", { exact: true }).fill(STRONG_PASSWORD);
  await page.getByLabel("Confirm password").fill(STRONG_PASSWORD);
  await page.getByRole("button", { name: "Accept invitation" }).click();

  await expect(page.getByTestId("invitation-error")).toContainText("no longer valid");
  await expect(page.getByRole("link", { name: "Request a new invitation" })).toBeVisible();
});

test("a missing token is rejected without a request", async ({ page }) => {
  await page.goto("/invitations/accept");
  await expect(page.getByTestId("invitation-missing-token")).toBeVisible();
  await expect(page.getByTestId("invitation-card")).toContainText(
    "missing or incomplete",
  );
});
