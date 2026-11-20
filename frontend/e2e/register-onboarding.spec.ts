import { expect, test, type Page } from "@playwright/test";

/**
 * Registration wizard (UI/UX phase 2, T2-01 and U2-01 / U2-02 / U2-03 / U2-07).
 */
const API = "**/api/v1/**";
const STRONG_PASSWORD = "Str0ng-Passw0rd!";

async function fillWorkspace(page: Page, slug = "acme", name = "Acme Inc") {
  await page.getByLabel("Tenant slug").fill(slug);
  await page.getByLabel("Company name").fill(name);
}

async function fillAdmin(page: Page, email = "ada@acme.com") {
  await page.getByLabel("Admin full name").fill("Ada Lovelace");
  await page.getByLabel("Admin email").fill(email);
}

async function fillSecurity(page: Page) {
  await page.getByLabel("Admin password").fill(STRONG_PASSWORD);
  await page.getByLabel("Confirm password").fill(STRONG_PASSWORD);
  await page.getByLabel(/I accept the terms/).check();
}

async function toSummary(page: Page) {
  await page.goto("/register");
  await fillWorkspace(page);
  await page.getByTestId("register-next").click();
  await fillAdmin(page);
  await page.getByTestId("register-next").click();
  await fillSecurity(page);
  await page.getByTestId("register-next").click();
  await expect(page.getByTestId("register-summary")).toBeVisible();
}

test("creates a tenant through the wizard and returns to login", async ({ page }) => {
  const posts: string[] = [];
  await page.route(`${API}tenants`, async (route) => {
    posts.push(String(route.request().postData()));
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });

  await toSummary(page);
  await expect(page.getByTestId("register-summary")).toContainText("Acme Inc");
  await page.getByTestId("register-submit").click();

  await expect(page).toHaveURL(/\/\?registered=1&tenant=acme/);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain('"slug":"acme"');
});

test("empty fields are blocked before any request (U2-01)", async ({ page }) => {
  let posts = 0;
  await page.route(`${API}tenants`, (route) => {
    posts += 1;
    return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });

  await page.goto("/register");
  await page.getByTestId("register-next").click();
  await expect(page.getByTestId("register-error")).toBeVisible();
  await expect(page.getByTestId("register-step-0")).toBeVisible();
  expect(posts).toBe(0);
});

test("an overlong email is rejected before the request (U2-02)", async ({ page }) => {
  let posts = 0;
  await page.route(`${API}tenants`, (route) => {
    posts += 1;
    return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });

  await page.goto("/register");
  await fillWorkspace(page);
  await page.getByTestId("register-next").click();
  await page.getByLabel("Admin full name").fill("Ada Lovelace");
  await page.getByLabel("Admin email").fill(`${"a".repeat(250)}@acme.com`);
  await page.getByTestId("register-next").click();

  await expect(page.getByTestId("register-error")).toContainText("valid email");
  await expect(page.getByTestId("register-step-1")).toBeVisible();
  expect(posts).toBe(0);
});

test("a duplicate slug returns to the workspace step with a clear message (U2-03)", async ({
  page,
}) => {
  await page.route(`${API}tenants`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      body: JSON.stringify({ title: "Conflict", detail: "Slug already exists" }),
    }),
  );

  await toSummary(page);
  await page.getByTestId("register-submit").click();

  await expect(page.getByTestId("register-server-error")).toContainText("already taken");
  await expect(page.getByTestId("register-step-0")).toBeVisible();
});

test("double submit creates exactly one tenant (U2-07)", async ({ page }) => {
  let posts = 0;
  await page.route(`${API}tenants`, async (route) => {
    posts += 1;
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });

  await toSummary(page);
  // Dispatch both clicks synchronously: a Playwright click would wait for the button to become
  // enabled again and time out once the first click disables it.
  const clicked = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="register-submit"]');
    button?.click();
    button?.click();
    return button !== null;
  });
  expect(clicked).toBe(true);
  await page.waitForTimeout(500);
  expect(posts).toBe(1);
});

test("password strength and mismatch are explained", async ({ page }) => {
  await page.goto("/register");
  await fillWorkspace(page);
  await page.getByTestId("register-next").click();
  await fillAdmin(page);
  await page.getByTestId("register-next").click();
  await page.getByLabel("Admin password").fill("weakpass");
  await page.getByLabel("Confirm password").fill("weakpass");
  await page.getByLabel(/I accept the terms/).check();
  await page.getByTestId("register-next").click();

  await expect(page.getByTestId("register-error")).toContainText("Password requirement");
  await expect(page.getByText("Password strength:")).toBeVisible();
});
