import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Phase 4 workflow catalogue and instance monitor (T4-01…T4-10, U4-01/U4-03/U4-08).
 */

const API = "**/api/v1";

const definition = {
  id: "wf-1",
  tenantId: "tenant-a",
  name: "Expense approval",
  description: "Two-step approval",
  status: "PUBLISHED",
  currentVersion: 2,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-20T10:00:00Z",
  createdBy: "11111111-1111-1111-1111-111111111111",
};

const draft = {
  ...definition,
  id: "wf-draft",
  name: "Vendor onboarding",
  status: "DRAFT",
  currentVersion: 1,
};

function instance(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    tenantId: "tenant-a",
    workflowDefinitionId: "wf-1",
    workflowVersion: 2,
    state: "COMPLETED",
    contextJson: '{"amount":10,"email":"ada@acme.com"}',
    idempotencyKey: "key-1",
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:01:00Z",
    parentInstanceId: null,
    ...overrides,
  };
}

function log(id: string, nodeId: string, action: string, payload = "{}") {
  return {
    id,
    workflowInstanceId: "inst-1",
    nodeId,
    nodeType: "TASK",
    action,
    payload,
    createdAt: "2026-11-20T10:00:00Z",
  };
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function openCatalogue(
  page: Page,
  options: {
    startStatus?: number;
    startBody?: unknown;
    onStart?: (body: Record<string, unknown>) => void;
  } = {},
): Promise<void> {
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === "GET" && path.endsWith("/workflow-definitions")) {
      await json(route, 200, [definition, draft]);
      return;
    }
    if (method === "GET" && path.endsWith("/workflow-instances")) {
      await json(route, 200, [instance(), instance({ id: "inst-2", state: "FAILED" })]);
      return;
    }
    if (method === "POST" && path.endsWith("/workflow-instances")) {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      options.onStart?.(body);
      await json(route, options.startStatus ?? 201, options.startBody ?? instance({ state: "RUNNING" }));
      return;
    }
    await json(route, 200, []);
  });

  await page.context().addCookies([
    { name: "awap_session", value: "1", url: "http://localhost:3000" },
    { name: "awap_tenant", value: "tenant-a", url: "http://localhost:3000" },
    { name: "awap_role", value: "MANAGER", url: "http://localhost:3000" },
  ]);
  await page.goto("/workflows");
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();
}

async function openInstanceDetail(
  page: Page,
  options: { detailStatus?: number; replayResult?: string } = {},
): Promise<void> {
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/workflow-definitions")) {
      await json(route, 200, [definition]);
      return;
    }
    if (path.endsWith("/workflow-instances/inst-1") && method === "GET") {
      if (options.detailStatus) {
        await route.fulfill({
          status: options.detailStatus,
          contentType: "application/problem+json",
          body: JSON.stringify({ title: "not found" }),
        });
        return;
      }
      await json(route, 200, instance());
      return;
    }
    if (path.endsWith("/logs")) {
      await json(route, 200, [
        log("l1", "start", "NODE_STARTED"),
        log("l2", "approval", "NODE_STARTED"),
        log("l3", "approval", "NODE_COMPLETED", '{"email":"ada@acme.com","card":"4111111111111111"}'),
      ]);
      return;
    }
    if (path.endsWith("/saga")) {
      await json(route, 200, {
        id: "saga-1",
        tenantId: "tenant-a",
        workflowInstanceId: "inst-1",
        sagaKey: "saga-key",
        status: "FAILED",
        failureReason: "downstream timeout",
        compensationStartedAt: null,
        compensationCompletedAt: null,
        createdAt: "2026-11-20T10:00:00Z",
        updatedAt: "2026-11-20T10:01:00Z",
        steps: [
          {
            id: "step-1",
            stepOrder: 1,
            nodeId: "charge",
            nodeType: "TASK",
            actionType: "HTTP",
            compensationType: "REFUND",
            status: "DEAD_LETTERED",
            attempts: 3,
            maxAttempts: 3,
            retryBackoffMs: 5000,
            timeoutSeconds: 30,
            nextAttemptAt: null,
            lastError: "timeout for ada@acme.com",
            compensatedAt: null,
          },
        ],
      });
      return;
    }
    if (path.endsWith("/replay") && method === "POST") {
      const dryRun = new URL(route.request().url()).searchParams.get("dryRun") === "true";
      if (dryRun) {
        await json(route, 200, {
          instanceId: "inst-1",
          dryRun: true,
          result: options.replayResult ?? "MATCHED",
          projection: { instanceId: "inst-1", state: "FAILED", currentNodeId: "approval", nodeStatuses: {}, appliedActions: 3 },
          divergences: [],
          logRows: 3,
          logPages: 1,
          durationMs: 4,
          stateHash: "abcdef0123456789",
        });
        return;
      }
      await json(route, 200, instance({ state: "RUNNING" }));
      return;
    }
    if (path.endsWith("/instances/inst-1/retry") || path.includes("/workflow-instances/inst-1/retry")) {
      await json(route, 200, instance({ state: "RUNNING" }));
      return;
    }
    await json(route, 200, []);
  });

  await page.context().addCookies([
    { name: "awap_session", value: "1", url: "http://localhost:3000" },
    { name: "awap_tenant", value: "tenant-a", url: "http://localhost:3000" },
    { name: "awap_role", value: "MANAGER", url: "http://localhost:3000" },
  ]);
  await page.goto("/instances/inst-1");
}

test("catalogue searches, filters by status and shows running counts", async ({ page }) => {
  await openCatalogue(page);

  await expect(page.getByTestId("workflow-result-count")).toHaveText("2 results");
  await expect(page.getByTestId("workflow-running-wf-1")).toHaveText("0 / 2");

  await page.getByTestId("workflow-search").fill("vendor");
  await expect(page.getByTestId("workflow-result-count")).toHaveText("1 results");
  await page.getByTestId("workflow-status").selectOption("PUBLISHED");
  await expect(page.getByTestId("workflow-result-count")).toHaveText("0 results");

  await page.getByTestId("workflow-search").fill("");
  await page.getByTestId("workflow-status").selectOption("ALL");
  await page.getByTestId("workflow-view-table").click();
  await expect(page.getByTestId("workflow-row-wf-1")).toContainText("PUBLISHED");
});

test("invalid context JSON blocks start before any request", async ({ page }) => {
  let startCalls = 0;
  await openCatalogue(page, { onStart: () => (startCalls += 1) });

  await page.getByTestId("workflow-card-wf-1").getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Start workflow" })).toBeVisible();
  await page.getByLabel("Workflow context JSON").fill("{bad");
  await expect(page.getByText(/Invalid context/)).toBeVisible();
  await expect(page.getByTestId("start-submit")).toBeDisabled();
  expect(startCalls).toBe(0);
});

test("starting a workflow sends the context and an idempotency key", async ({ page }) => {
  const captured: { body?: Record<string, unknown> } = {};
  await openCatalogue(page, { onStart: (payload) => (captured.body = payload) });

  await page.getByTestId("workflow-card-wf-1").getByRole("button", { name: "Start" }).click();
  await page.getByLabel("Workflow context JSON").fill('{"amount":42}');
  await expect(page.getByTestId("start-preview")).toContainText("Fields: amount");
  await page.getByTestId("start-submit").click();

  await expect(page.getByRole("heading", { name: "Start workflow" })).toHaveCount(0);
  expect(captured.body).toMatchObject({ workflowDefinitionId: "wf-1", contextJson: '{"amount":42}' });
  expect(typeof captured.body?.idempotencyKey).toBe("string");
});

test("an unpublished response shows the Designer call to action", async ({ page }) => {
  await openCatalogue(page, { startStatus: 400, startBody: { detail: "not published" } });

  await page.getByTestId("workflow-card-wf-1").getByRole("button", { name: "Start" }).click();
  await page.getByTestId("start-submit").click();

  await expect(page.getByTestId("start-error")).toContainText("not published");
  await expect(page.getByTestId("start-error").getByRole("link", { name: /Designer/ })).toBeVisible();
});

test("a conflicting idempotency key is explained", async ({ page }) => {
  await openCatalogue(page, { startStatus: 409, startBody: { detail: "conflict" } });

  await page.getByTestId("workflow-card-wf-1").getByRole("button", { name: "Start" }).click();
  await page.getByTestId("start-submit").click();

  await expect(page.getByTestId("start-error")).toContainText("idempotency key with different context");
});

test("instance list filters by state and exports the visible rows", async ({ page }) => {
  await openCatalogue(page);
  await page.goto("/instances");
  await expect(page.getByRole("heading", { name: "Workflow Instances" })).toBeVisible();

  await expect(page.getByTestId("instance-result-count")).toHaveText("2 instances");
  await page.getByTestId("instance-filter").selectOption("FAILED");
  await expect(page.getByTestId("instance-result-count")).toHaveText("1 instances");
  await expect(page.getByTestId("instance-row-inst-2")).toContainText("FAILED");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("instance-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("workflow-instances.csv");
  await expect(page.getByTestId("toast-viewport")).toContainText("1 rows exported");
});

test("instance detail shows the node timeline, redacted logs and saga", async ({ page }) => {
  await openInstanceDetail(page);

  await expect(page.getByTestId("instance-state")).toHaveText("COMPLETED");
  const timeline = page.getByTestId("instance-detail");
  await expect(timeline.getByRole("heading", { name: "approval" }).first()).toBeVisible();
  await expect(timeline).toContainText("NODE_COMPLETED");
  await expect(timeline).not.toContainText("4111111111111111");

  await page.getByRole("tab", { name: "Variables" }).click();
  await expect(page.getByTestId("instance-context")).toContainText('"amount": 10');

  await page.getByRole("tab", { name: "Saga" }).click();
  await expect(page.getByRole("table", { name: "Saga steps" })).toContainText("DEAD_LETTERED");
  await expect(page.getByTestId("saga-compensate")).toBeVisible();
});

test("retry is confirmed and updates the instance state", async ({ page }) => {
  let retries = 0;
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/workflow-instances/inst-1") && route.request().method() === "GET") {
      await json(route, 200, instance({ state: "FAILED" }));
      return;
    }
    if (path.endsWith("/workflow-instances/inst-1/retry")) {
      retries += 1;
      await json(route, 200, instance({ state: "RUNNING" }));
      return;
    }
    await json(route, 200, []);
  });
  await page.context().addCookies([
    { name: "awap_session", value: "1", url: "http://localhost:3000" },
    { name: "awap_tenant", value: "tenant-a", url: "http://localhost:3000" },
  ]);
  await page.goto("/instances/inst-1");

  await page.getByTestId("instance-retry").click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("toast-viewport")).toContainText("Action applied");
  expect(retries).toBe(1);
});

test("replay dry run gates apply on a matched projection", async ({ page }) => {
  await openInstanceDetail(page, { replayResult: "MATCHED" });
  await page.getByTestId("instance-replay-preview").click();
  await expect(page.getByTestId("replay-report")).toContainText("MATCHED");
  await expect(page.getByTestId("instance-replay-apply")).toBeEnabled();
});

test("a divergent replay cannot be applied", async ({ page }) => {
  await openInstanceDetail(page, { replayResult: "DIVERGED" });
  await page.getByTestId("instance-replay-preview").click();
  await expect(page.getByTestId("replay-report")).toContainText("DIVERGED");
  await expect(page.getByTestId("instance-replay-apply")).toBeDisabled();
});

test("a deleted instance renders the not-found state", async ({ page }) => {
  await openInstanceDetail(page, { detailStatus: 404 });
  await expect(page.getByTestId("instance-missing")).toContainText("Instance not found");
  await expect(page.getByRole("link", { name: "Back to instances" })).toBeVisible();
});
