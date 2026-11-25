import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import {
  adminDlqFixture,
  adminIdentityFixture,
  adminOperateFixture,
  analyticsDrilldownFixture,
  analyticsOverviewFixture,
  breakGlassFixture,
  setSession,
  tenantUsageFixture,
} from "./a11yFixtures";

/**
 * Phase 8 analytics and admin/IDM console coverage.
 *
 * The suite runs against deterministic API mocks, so it proves the UI contract (server counts,
 * drill-down, confirmations, error mapping and axe) without a backend. The audit-row and
 * escalation invariants run in the backend tests.
 */

const API = "http://localhost:8080";
const RANGE = "from=2026-11-02&to=2026-11-08";

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function problem(route: Route, status: number, detail: string): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/problem+json",
    body: JSON.stringify({ title: detail, detail }),
  });
}

async function noBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking).toEqual([]);
}

async function mockShell(page: Page): Promise<void> {
  await page.route(`${API}/actuator/health`, (route) => json(route, { status: "UP" }));
  await page.route(`${API}/api/v1/auth/me`, (route) =>
    json(route, {
      id: "user-1",
      tenantId: "tenant-a",
      email: "ada@acme.com",
      fullName: "Ada Lovelace",
      role: "TENANT_ADMIN",
    }),
  );
  await page.route(`${API}/api/v1/auth/tenants`, (route) =>
    json(route, [{ tenantId: "tenant-a", role: "TENANT_ADMIN" }]),
  );
  await page.route(`${API}/api/v1/notifications/unread-count`, (route) =>
    json(route, { count: 0 }),
  );
}

async function mockAnalytics(page: Page): Promise<{ requested: string[] }> {
  await mockShell(page);
  const requested: string[] = [];
  await page.route(`${API}/api/v1/analytics/**`, async (route) => {
    const url = new URL(route.request().url());
    requested.push(url.pathname + url.search);
    if (url.pathname.endsWith("/overview")) {
      return json(route, analyticsOverviewFixture(true));
    }
    if (url.pathname.endsWith("/drilldown")) {
      return json(route, analyticsDrilldownFixture(true));
    }
    return json(route, {}, 404);
  });
  return { requested };
}

async function mockAdmin(page: Page, overrides: { identityStatus?: number } = {}) {
  await mockShell(page);
  await page.route(`${API}/api/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/api/v1/admin/identity")) {
      if (overrides.identityStatus === 403) {
        return problem(route, 403, "Only tenant admins can use the console.");
      }
      return json(route, adminIdentityFixture(true));
    }
    if (url.pathname.endsWith("/api/v1/admin/operate")) {
      return json(route, adminOperateFixture(true));
    }
    if (url.pathname.endsWith("/api/v1/admin/audit")) {
      return json(route, {
        items: [
          {
            id: "audit-1",
            entityType: "USER",
            entityId: "user-1",
            action: "ROLE_CHANGED",
            oldValue: "EMPLOYEE",
            newValue: "MANAGER",
            actorId: "user-1",
            createdAt: "2026-11-09T10:00:00Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      });
    }
    if (url.pathname.endsWith("/api/v1/admin/dlq")) {
      return json(route, adminDlqFixture(true));
    }
    if (url.pathname.endsWith("/api/v1/admin/break-glass")) {
      return json(route, breakGlassFixture);
    }
    if (/\/api\/v1\/tenants\/[^/]+\/usage$/.test(url.pathname)) {
      return json(route, tenantUsageFixture(true));
    }
    if (method === "PUT" && url.pathname.includes("/api/v1/admin/users/")) {
      return json(route, {
        ...adminIdentityFixture(true).users[0]!,
        role: "MANAGER",
      });
    }
    if (method === "POST" && url.pathname.includes("/api/v1/admin/invitations")) {
      return problem(route, 429, "Tenant user quota exceeded. The invitation was not created.");
    }
    if (method === "POST" && url.pathname.includes("/api/v1/admin/dlq/")) {
      return json(route, {
        id: "delivery-1",
        status: "RETRYING",
        attempts: 0,
        detail: "Delivery re-queued for the retry scheduler.",
      });
    }
    if (method === "DELETE" && url.pathname.includes("/api/v1/admin/users/")) {
      return problem(route, 409, "The last tenant administrator cannot be removed or demoted.");
    }
    return json(route, {}, 404);
  });
}

test.describe("phase 8 analytics", () => {
  test("T8-01/U8-07 server counts, filters and reversed-range validation", async ({ page }) => {
    await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
    const { requested } = await mockAnalytics(page);
    await page.goto(`/analytics?${RANGE}`);

    await expect(page.getByTestId("analytics-total-events-value")).toHaveText("44");
    await expect(page.getByTestId("analytics-completed-workflows-value")).toHaveText("12");
    await expect(page.getByTestId("analytics-workflow-p95-value")).toHaveText("2.5 s");
    await expect(
      page.getByRole("img", { name: /Event totals by bucket/ }),
    ).toBeVisible();

    await page.getByRole("textbox", { name: "To", exact: true }).fill("2026-11-09");
    await expect
      .poll(() => requested.some((url) => url.includes("to=2026-11-09")))
      .toBe(true);
    await expect(page.getByTestId("analytics-completed-workflows-value")).toHaveText("12");

    await page.getByRole("textbox", { name: "From", exact: true }).fill("2099-12-31");
    await expect(page.getByTestId("range-error")).toHaveText("From must not be after to.");
    await noBlockingViolations(page);
  });

  test("T8-02/U8-04 drill-down list and partial metric source", async ({ page }) => {
    await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
    await mockShell(page);
    await page.route(`${API}/api/v1/analytics/overview**`, (route) =>
      json(route, {
        ...analyticsOverviewFixture(true),
        dashboard: {
          ...analyticsOverviewFixture(true).dashboard,
          dataCompleteness: {
            dailyTotalsAvailable: true,
            rawEventsAvailable: false,
            sampleCount: 0,
          },
        },
      }),
    );
    await page.route(`${API}/api/v1/analytics/drilldown**`, (route) =>
      json(route, analyticsDrilldownFixture(true)),
    );
    await page.goto(`/analytics?${RANGE}`);

    await expect(page.getByTestId("partial-state")).toContainText(
      "Raw-event analytics are temporarily unavailable.",
    );
    await page.getByRole("button", { name: "Drill down" }).first().click();
    await expect(page.getByTestId("analytics-drilldown")).toContainText("1 sampled event");
    await expect(page.getByTestId("drilldown-row-sample-1")).toContainText("approval");
  });
});

test.describe("phase 8 admin and IDM console", () => {
  test("T8-03/T8-05 role confirmation, audit copy and quota message", async ({ page }) => {
    await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
    await mockAdmin(page);
    await page.goto("/admin");

    await expect(page.getByTestId("admin-users-table")).toContainText("ada@acme.com");
    await page.getByLabel("Role for ada@acme.com").selectOption("MANAGER");
    await expect(page.getByTestId("admin-role-confirm")).toContainText("audited");
    await page
      .getByTestId("admin-role-confirm")
      .getByRole("button", { name: "Change role" })
      .click();
    await expect(page.getByTestId("admin-status")).toContainText(
      "Role for ada@acme.com changed to MANAGER.",
    );

    await page.getByLabel("Email").fill("new@acme.com");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page
      .getByTestId("admin-invite-confirm")
      .getByRole("button", { name: "Create invitation" })
      .click();
    await expect(page.getByTestId("mutation-error")).toContainText("Tenant user quota exceeded.");
    await noBlockingViolations(page);
  });

  test("T8-10 tenant B admin gets a 403 forbidden state", async ({ page }) => {
    await setSession(page, { tenant: "tenant-b", role: "TENANT_ADMIN" });
    await mockAdmin(page, { identityStatus: 403 });
    await page.goto("/admin");

    await expect(page.getByTestId("forbidden-state")).toContainText(
      "Only a tenant administrator can open the identity console.",
    );
  });

  test("T8-06/U8-05 DLQ is empty or retries with confirmation and result", async ({ page }) => {
    await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
    await mockAdmin(page);
    await page.goto("/admin/operate");

    await expect(page.getByTestId("operate-workflows-value")).toHaveText("3");
    await page.getByTestId("dlq-retry-delivery-1").click();
    await expect(page.getByTestId("operate-dlq-confirm")).toContainText("audited");
    await page
      .getByTestId("operate-dlq-confirm")
      .getByRole("button", { name: "Retry delivery" })
      .click();
    await expect(page.getByTestId("operate-status")).toContainText(
      "Delivery re-queued for the retry scheduler. Status: RETRYING.",
    );
  });

  test("audit rows, break-glass log and export range validation", async ({ page }) => {
    await setSession(page, { tenant: "tenant-a", role: "TENANT_ADMIN" });
    await mockAdmin(page);
    await page.goto(`/admin/audit?${RANGE}`);

    await expect(page.getByTestId("audit-table")).toContainText("ROLE_CHANGED");
    await expect(page.getByTestId("break-glass-summary")).toContainText("389");
    await expect(page.getByTestId("break-glass-merges")).toContainText("936a7c8");

    await page.getByRole("textbox", { name: "From", exact: true }).fill("2099-12-31");
    await expect(page.getByTestId("audit-range-error")).toHaveText(
      "From must not be after to.",
    );
    await expect(page.getByRole("button", { name: "Export audit CSV" })).toBeDisabled();
  });
});
