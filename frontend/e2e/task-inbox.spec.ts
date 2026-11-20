import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Phase 3 work item inbox (T3-01…T3-12, U3-01/U3-03/U3-09/U3-10).
 *
 * Every spec mocks the task contract so the assertions stay deterministic: list contents, the
 * authoritative mutation responses and the conflict/forbidden failure modes.
 */

interface Task {
  id: string;
  tenantId: string;
  workflowInstanceId: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  status: string;
  version: number;
  decisionComment: string | null;
  taskType: string;
  escalated: boolean;
  escalateAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const NOW = Date.parse("2026-11-20T12:00:00Z");

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    tenantId: "tenant-a",
    workflowInstanceId: "inst-1",
    description: "Q4 expense report",
    assigneeId: "user-1",
    status: "ASSIGNED",
    version: 1,
    decisionComment: null,
    taskType: "APPROVAL",
    escalated: false,
    escalateAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T08:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

const openTask = task({ id: "t-open", title: "Approve travel request" });
const unassignedTask = task({
  id: "t-unassigned",
  title: "Triage vendor onboarding",
  assigneeId: null,
  status: "OPEN",
  escalateAt: null,
});
const overdueTask = task({
  id: "t-overdue",
  title: "Review overdue invoice",
  status: "IN_PROGRESS",
  escalateAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
});
const completedTask = task({
  id: "t-done",
  title: "Completed contract check",
  status: "APPROVED",
  completedAt: "2026-11-19T10:00:00Z",
});

type ActionHandler = (
  route: Route,
  path: string,
  body: Record<string, unknown>,
  store: { tasks: Task[] },
) => Promise<void>;

interface InboxOptions {
  tasks?: Task[];
  mine?: Task[];
  onAction?: ActionHandler;
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function openInbox(page: Page, options: InboxOptions = {}): Promise<void> {
  const tasks = options.tasks ?? [openTask, unassignedTask, overdueTask, completedTask];
  // The mutation handler may update this store so the post-decision refetch matches the mutation.
  const store = { tasks };

  // Fallback for the shell's unrelated reads (notifications, health, tenants).
  await page.route("**/api/v1/**", async (route) => json(route, 200, []));

  await page.route("**/api/v1/tasks/mine", async (route) => {
    const mine = options.mine ?? tasks.filter((entry) => entry.assigneeId === "user-1");
    await json(route, 200, mine);
  });

  await page.route("**/api/v1/tasks", async (route) => {
    const tenant = route.request().headers()["x-tenant-id"];
    // U3-01/T3-07: another tenant sees no rows at all.
    await json(route, 200, tenant === "tenant-b" ? [] : store.tasks);
  });

  await page.route("**/api/v1/tasks/*/*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (options.onAction) {
      await options.onAction(route, path, body, store);
      return;
    }
    await json(route, 200, openTask);
  });

  await page.context().addCookies([
    { name: "awap_session", value: "1", url: "http://localhost:3000" },
    { name: "awap_tenant", value: "tenant-a", url: "http://localhost:3000" },
    { name: "awap_role", value: "MANAGER", url: "http://localhost:3000" },
  ]);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Task inbox" })).toBeVisible();
}

async function openDecision(page: Page, title: string): Promise<void> {
  await page.getByTestId(`task-row-${title}`).click();
  await page.getByRole("tab", { name: "Decision" }).click();
}

test("filters narrow the inbox to the matching rows", async ({ page }) => {
  await openInbox(page);

  await expect(page.getByTestId("task-result-count")).toHaveText("3 results");

  await page.getByTestId("task-filter-completed").click();
  await expect(page.getByTestId("task-row-t-done")).toBeVisible();
  await expect(page.getByTestId("task-row-t-open")).toHaveCount(0);

  await page.getByTestId("task-filter-overdue").click();
  await expect(page.getByTestId("task-row-t-overdue")).toBeVisible();
  await expect(page.getByTestId("task-row-t-done")).toHaveCount(0);

  await page.getByTestId("task-search").fill("travel");
  await expect(page.getByTestId("task-list-empty")).toBeVisible();
});

test("selecting a work item opens the 360 detail with its form and context", async ({ page }) => {
  await openInbox(page);
  await page.getByTestId("task-row-t-open").click();

  await expect(page.getByTestId("task-detail-heading")).toHaveText("Approve travel request");
  await expect(page.getByTestId("task-work-item")).toContainText("Q4 expense report");

  await page.getByRole("tab", { name: "Decision" }).click();
  await expect(page.getByTestId("task-comment")).toBeVisible();
});

test("approving sends one request and shows the success toast", async ({ page }) => {
  let approvals = 0;
  await openInbox(page, {
    onAction: async (route, path, _body, store) => {
      if (path.endsWith("/approve")) {
        approvals += 1;
        const updated = { ...openTask, status: "APPROVED", completedAt: new Date().toISOString() };
        store.tasks = store.tasks.map((entry) => (entry.id === updated.id ? updated : entry));
        await json(route, 200, updated);
        return;
      }
      await json(route, 200, openTask);
    },
  });

  await openDecision(page, "t-open");
  await page.getByTestId("task-approve").click();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("toast-viewport")).toContainText("Decision recorded");
  expect(approvals).toBe(1);

  // The approved row leaves the default open filter and now appears under Completed.
  await page.getByTestId("task-filter-completed").click();
  await expect(page.getByTestId("task-row-t-open")).toContainText("Approved");
});

test("rejecting without a comment is blocked before any request", async ({ page }) => {
  let requests = 0;
  await openInbox(page, {
    onAction: async (route) => {
      requests += 1;
      await json(route, 200, openTask);
    },
  });

  await openDecision(page, "t-open");
  await page.getByTestId("task-reject").click();

  await expect(page.getByTestId("task-error")).toContainText(
    "A comment is required to reject a work item.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toBe(0);
});

test("double-clicking the confirmation produces a single request", async ({ page }) => {
  let approvals = 0;
  await openInbox(page, {
    onAction: async (route, path) => {
      if (path.endsWith("/approve")) {
        approvals += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await json(route, 200, { ...openTask, status: "APPROVED" });
    },
  });

  await openDecision(page, "t-open");
  await page.getByTestId("task-approve").click();
  const confirm = page.getByRole("button", { name: "Confirm" });
  await confirm.dblclick();

  await expect(page.getByTestId("toast-viewport")).toContainText("Decision recorded");
  expect(approvals).toBe(1);
});

test("a 409 conflict is explained in human language with a reload action", async ({ page }) => {
  await openInbox(page, {
    onAction: async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Task was decided by another user" }),
      });
    },
  });

  await openDecision(page, "t-open");
  await page.getByTestId("task-approve").click();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("task-error")).toContainText(
    "This work item changed while you were reading it. Reload and try again.",
  );
  await expect(page.getByRole("button", { name: "Reload the work item" })).toBeVisible();
});

test("a task assigned to someone else is reported as a permission failure", async ({ page }) => {
  await openInbox(page, {
    onAction: async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Task is assigned to another user." }),
      });
    },
  });

  await openDecision(page, "t-open");
  await page.getByTestId("task-approve").click();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("task-error")).toContainText(
    "You no longer have permission to act on this work item.",
  );
});

test("another tenant receives an empty inbox", async ({ page }) => {
  await openInbox(page);
  await page.context().addCookies([
    { name: "awap_tenant", value: "tenant-b", url: "http://localhost:3000" },
  ]);
  await page.reload();

  await expect(page.getByTestId("task-result-count")).toHaveText("0 results");
  await expect(page.getByTestId("task-list-empty")).toBeVisible();
});

test("keyboard J/K move the cursor and A opens the approval confirmation", async ({ page }) => {
  await openInbox(page);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("j");
  await expect(page.getByTestId("task-row-t-overdue")).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("k");
  await expect(page.getByTestId("task-row-t-overdue")).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("j");
  await page.keyboard.press("a");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Approve this work item?");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("escalation sends the new assignee and restarts the SLA", async ({ page }) => {
  let payload: Record<string, unknown> | null = null;
  await openInbox(page, {
    onAction: async (route, path, body) => {
      if (path.endsWith("/escalate")) {
        payload = body;
        await json(route, 200, {
          ...openTask,
          escalated: true,
          assigneeId: String(body.assigneeId),
          escalateAt: new Date(NOW + 3600 * 1000).toISOString(),
        });
        return;
      }
      await json(route, 200, openTask);
    },
  });

  await openDecision(page, "t-open");
  await page.getByTestId("task-assignee").fill("user-2");
  await page.getByTestId("task-escalate").click();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("toast-viewport")).toContainText("Decision recorded");
  expect(payload).toEqual({ assigneeId: "user-2" });
});

test("bulk approval reports partial success per work item", async ({ page }) => {
  await openInbox(page, {
    onAction: async (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[4];
      if (id === "t-unassigned") {
        await route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({ detail: "Task cannot be decided in status OPEN" }),
        });
        return;
      }
      await json(route, 200, { ...openTask, id, status: "APPROVED" });
    },
  });

  await page.getByTestId("task-select-all").check();
  await expect(page.getByTestId("task-bulk-count")).toContainText("3 selected");

  await page.getByTestId("task-bulk-approve").click();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("toast-viewport")).toContainText("Bulk action finished");
  await expect(page.getByTestId("toast-viewport")).toContainText("2 succeeded, 1 failed");
  await expect(page.getByTestId("toast-viewport")).toContainText("Some work items were not updated");
});

test("filtering a 1000-row inbox stays under one second", async ({ page }) => {
  // Half the rows are overdue; every row is open so the default filter shows all 1000.
  const many = Array.from({ length: 1000 }, (_, index) =>
    task({
      id: `bulk-${index}`,
      title: `Work item ${index}`,
      status: "ASSIGNED",
      escalateAt:
        index % 2 === 0
          ? new Date(NOW + 60 * 60 * 1000).toISOString()
          : new Date(NOW - 60 * 60 * 1000).toISOString(),
    }),
  );
  await openInbox(page, { tasks: many });
  await expect(page.getByTestId("task-result-count")).toHaveText("1000 results");

  const elapsed = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="task-filter-overdue"]');
    if (!button) {
      throw new Error("filter button missing");
    }
    const started = performance.now();
    button.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - started;
  });

  expect(elapsed).toBeLessThan(1000);
  await expect(page.getByTestId("task-result-count")).toHaveText("500 results");
});

test("mobile list navigation opens the separate detail route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInbox(page);

  await page.getByTestId("task-row-t-open").click();
  await expect(page).toHaveURL(/\/tasks\/t-open$/);
  await expect(page.getByTestId("task-detail-heading")).toHaveText("Approve travel request");

  await page.getByRole("button", { name: /Back to inbox/ }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId("task-list")).toBeVisible();
});
