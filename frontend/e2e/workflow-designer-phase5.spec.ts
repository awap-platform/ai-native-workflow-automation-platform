import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Phase 5 designer parity: grouped palette, properties, validation, autosave, publish, versions,
 * BPMN interchange, keyboard-only authoring and the unsaved-changes guard.
 *
 * Every backend call is mocked so the spec is deterministic in PR mode and still exercises the
 * same UI against the live Compose stack.
 */

const API = "/api/v1/workflow-definitions";
const DEFINITION_ID = "w-phase5";
const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const currentDefinition = JSON.stringify({
  nodes: [
    { id: "s", type: "START", name: "Second start" },
    { id: "e", type: "END", name: "End" },
  ],
  transitions: [{ id: "t", from: "s", to: "e" }],
});

const previousDefinition = JSON.stringify({
  nodes: [
    { id: "s", type: "START", name: "First start" },
    { id: "e", type: "END", name: "End" },
  ],
  transitions: [{ id: "t", from: "s", to: "e" }],
});

interface MockOptions {
  publishStatus?: number;
  bpmnImport?: (body: { bpmnXml?: string }) => { status: number; body: unknown };
}

interface MockState {
  creates: string[];
  exports: string[];
  imports: string[];
  rollbacks: number[];
  publishes: number;
}

async function openDesigner(page: Page, query = ""): Promise<void> {
  await page.context().addCookies([
    { name: "awap_session", value: "1", url: ORIGIN },
    { name: "awap_tenant", value: "tenant-a", url: ORIGIN },
    { name: "XSRF-TOKEN", value: "e2e-csrf", url: "http://localhost:8080" },
  ]);
  await page.route(/\/api\/v1\/workflow-definitions\/validate-expression$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ valid: true, errors: [] }),
    }),
  );
  await page.goto(`/workflows/designer${query}`);
  await expect(page.getByRole("heading", { name: "Workflow Designer" })).toBeVisible();
}

async function connectFirstTwo(page: Page): Promise<void> {
  const source = await page
    .getByLabel("Transition source")
    .locator("option")
    .nth(1)
    .getAttribute("value");
  const target = await page
    .getByLabel("Transition target")
    .locator("option")
    .nth(2)
    .getAttribute("value");
  await page.getByLabel("Transition source").selectOption(source as string);
  await page.getByLabel("Transition target").selectOption(target as string);
  await page.getByRole("button", { name: "Add transition" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
}

async function mockApi(page: Page, options: MockOptions = {}): Promise<MockState> {
  const state: MockState = {
    creates: [],
    exports: [],
    imports: [],
    rollbacks: [],
    publishes: 0,
  };
  await page.route(/\/api\/v1\/workflow-definitions/, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname.endsWith("/bpmn/import") && method === "POST") {
      const body = request.postDataJSON() as { bpmnXml?: string };
      state.imports.push(body.bpmnXml ?? "");
      if (options.bpmnImport) {
        const response = options.bpmnImport(body);
        await route.fulfill({
          status: response.status,
          contentType: "application/problem+json",
          body: JSON.stringify(response.body),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          definitionJson: JSON.stringify({
            nodes: [
              { id: "imported-start", type: "START", name: "Imported start" },
              { id: "imported-end", type: "END", name: "Imported end" },
            ],
            transitions: [{ id: "imported-edge", from: "imported-start", to: "imported-end" }],
          }),
          warnings: [],
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/bpmn/export") && method === "POST") {
      state.exports.push(String((request.postDataJSON() as { definitionJson?: string }).definitionJson));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ bpmnXml: "<bpmn:definitions/>" }),
      });
      return;
    }
    if (url.pathname.endsWith("/versions") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "v2",
            version: 2,
            definitionJson: currentDefinition,
            status: "PUBLISHED",
            archived: false,
            current: true,
            createdAt: "2026-01-02T00:00:00Z",
          },
          {
            id: "v1",
            version: 1,
            definitionJson: previousDefinition,
            status: "PUBLISHED",
            archived: false,
            current: false,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]),
      });
      return;
    }
    if (/\/rollback\/\d+$/.test(url.pathname) && method === "POST") {
      state.rollbacks.push(Number(url.pathname.split("/").pop()));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "def-1",
          tenantId: "tenant-a",
          name: "Expense",
          description: null,
          status: "PUBLISHED",
          currentVersion: 1,
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/archive") && method === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (url.pathname.endsWith("/publish") && method === "POST") {
      state.publishes += 1;
      if (options.publishStatus === 409) {
        await route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            title: "Conflict",
            status: 409,
            detail: "The workflow was changed by another request.",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: DEFINITION_ID,
          tenantId: "tenant-a",
          name: "Phase 5 flow",
          description: null,
          status: "PUBLISHED",
          currentVersion: 2,
        }),
      });
      return;
    }
    if (url.pathname === API && method === "POST") {
      state.creates.push(String(request.postData()));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: DEFINITION_ID,
          tenantId: "tenant-a",
          name: "Phase 5 flow",
          description: null,
          status: "DRAFT",
          currentVersion: 1,
        }),
      });
      return;
    }
    if (url.pathname.startsWith(`${API}/`) && method === "GET") {
      const id = url.pathname.slice(API.length + 1);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id,
          tenantId: "tenant-a",
          name: id === "def-1" ? "Expense" : "Phase 5 flow",
          description: null,
          status: "PUBLISHED",
          currentVersion: 2,
        }),
      });
      return;
    }
    await route.fallback();
  });
  return state;
}

test("groups the palette, searches it and inserts with the keyboard", async ({ page }) => {
  await mockApi(page);
  await openDesigner(page);

  for (const group of ["Events", "Activities", "Gateways", "Structural", "Extensions"]) {
    await expect(page.getByRole("heading", { name: group })).toBeVisible();
  }

  const search = page.getByLabel("Search node types");
  await search.fill("timer");
  await expect(page.getByRole("button", { name: "DELAY" })).toBeVisible();
  await expect(page.getByRole("button", { name: "APPROVAL" })).toHaveCount(0);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  await search.fill("end");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.getByRole("status").filter({ hasText: "END node added" })).toBeVisible();
});

test("edits every node through the properties panel and escapes hostile labels", async ({ page }) => {
  await mockApi(page);
  await openDesigner(page);

  await page.getByRole("button", { name: "APPROVAL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "APPROVAL node" })).toBeVisible();
  const hostile = '<img src=x onerror="window.__xss=1">';
  await page.getByLabel("Node name").fill(hostile);
  await page.getByLabel("Assignees").fill("role:MANAGER");
  await page.getByLabel("Timeout seconds").fill("45");

  const node = page.locator(".react-flow__node").first();
  await expect(node).toContainText(hostile);
  await expect(node.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  const truncated = await node.locator(".awap-designer__node-card .awap-designer__truncate").evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(truncated).toBe(true);

  await page.getByRole("button", { name: "FORM", exact: true }).click();
  await expect(page.getByLabel("Form definition ID")).toBeVisible();
  await page.getByRole("button", { name: "SCRIPT", exact: true }).click();
  await expect(page.getByLabel("Script expression")).toBeVisible();
  await page.getByRole("button", { name: "WEBHOOK", exact: true }).click();
  await expect(page.getByLabel("Webhook URL")).toBeVisible();
});

test("designer controls use the design system and pass axe with properties open", async ({
  page,
}) => {
  await mockApi(page);
  await openDesigner(page);

  await expect(page.getByLabel("Search node types")).toHaveClass(/awap-input/);

  await page.getByRole("button", { name: "APPROVAL", exact: true }).click();
  await expect(page.getByTestId("node-properties")).toBeVisible();
  await expect(page.getByLabel("Node name")).toHaveClass(/awap-input/);
  await expect(page.getByLabel("Timeout seconds")).toHaveClass(/awap-input/);
  await expect(page.getByLabel("Assignees")).toHaveClass(/awap-textarea/);

  for (const name of ["Zoom in", "Zoom out", "Fit view"]) {
    await expect(page.getByRole("button", { name })).toHaveAttribute("data-slot", "button");
  }

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page })
      .include('[data-testid="node-properties"]')
      .include(".awap-designer")
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking, `${colorScheme} designer axe: ${JSON.stringify(blocking)}`).toEqual([]);
  }
});

test("validation blocks a missing START, warns for END and focuses a disconnected node", async ({
  page,
}) => {
  await mockApi(page);
  await openDesigner(page);

  const panel = page.getByTestId("validation-panel");
  await expect(panel).toContainText("A workflow needs exactly one START node.");
  await expect(panel).toContainText("A workflow needs at least one END node.");

  await page.getByLabel("Workflow name").fill("No start");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "exactly one START" })).toBeVisible();

  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.getByRole("button", { name: "TASK", exact: true }).click();
  await expect(panel).toContainText("Every node must be reachable from START.");
  await panel
    .getByRole("button", { name: /Every node must be reachable from START/ })
    .click();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
});

test("autosaves the draft and restores it after a reload", async ({ page }) => {
  await mockApi(page);
  await openDesigner(page);

  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.getByLabel("Workflow name").fill("Autosaved flow");
  await expect(page.getByRole("status").filter({ hasText: "Draft autosaved at" })).toBeVisible({
    timeout: 5_000,
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Workflow Designer" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Recovered an unsaved draft" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.getByLabel("Workflow name")).toHaveValue("Autosaved flow");
});

test("publishes the saved draft and shows the post-publish summary", async ({ page }) => {
  const state = await mockApi(page);
  await openDesigner(page);

  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.getByRole("button", { name: "END", exact: true }).click();
  await connectFirstTwo(page);
  await page.getByLabel("Workflow name").fill("Phase 5 flow");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Published" })).toBeVisible();
  await expect(page.getByText(/Version 2 is published and is now the current version/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View instances for this workflow" })).toBeVisible();
  expect(state.publishes).toBe(1);
  expect(state.creates).toHaveLength(1);
});

test("handles a two-tab publish conflict without losing the draft", async ({ page }) => {
  await mockApi(page, { publishStatus: 409 });
  await openDesigner(page);

  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.getByRole("button", { name: "END", exact: true }).click();
  await connectFirstTwo(page);
  await page.getByLabel("Workflow name").fill("Conflict flow");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Another tab published" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
});

test("compares versions, rolls back and archives", async ({ page }) => {
  const state = await mockApi(page);
  await openDesigner(page, "?id=def-1");

  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByTestId("version-diff")).toContainText("1 node(s) changed");
  await expect(page.locator(".react-flow__node", { hasText: "Second start" })).toBeVisible();

  await page.getByRole("button", { name: "Rollback to version 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rolled back to version 1" })).toBeVisible();
  await expect(page.locator(".react-flow__node", { hasText: "First start" })).toBeVisible();
  expect(state.rollbacks).toEqual([1]);

  await page.getByRole("button", { name: "Archive version 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Archived version 1" })).toBeVisible();
});

test("imports BPMN, exports the current canvas and reports a line-referenced error", async ({
  page,
}) => {
  const state = await mockApi(page, {
    bpmnImport: (body) =>
      body.bpmnXml?.includes("INVALID")
        ? {
            status: 400,
            body: { title: "Bad Request", status: 400, detail: "Invalid BPMN at line 3: no process" },
          }
        : {
            status: 200,
            body: {
              definitionJson: JSON.stringify({
                nodes: [
                  { id: "imported-start", type: "START", name: "Imported start" },
                  { id: "imported-end", type: "END", name: "Imported end" },
                ],
                transitions: [
                  { id: "imported-edge", from: "imported-start", to: "imported-end" },
                ],
              }),
              warnings: [],
            },
          },
  });
  await openDesigner(page);

  const fileInput = page.getByLabel("Import BPMN file");
  await fileInput.setInputFiles({
    name: "valid.bpmn",
    mimeType: "application/xml",
    buffer: Buffer.from("<bpmn:definitions/>"),
  });
  await expect(page.getByRole("status").filter({ hasText: "Imported valid.bpmn" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  await page.getByRole("button", { name: "Export BPMN" }).click();
  await expect(page.getByRole("status").filter({ hasText: "BPMN exported" })).toBeVisible();
  await expect(page.getByLabel("Exported BPMN")).toHaveValue("<bpmn:definitions/>");
  expect(state.exports[0]).toContain("imported-start");

  await fileInput.setInputFiles({
    name: "invalid.bpmn",
    mimeType: "application/xml",
    buffer: Buffer.from("<bpmn:definitions>INVALID</bpmn:definitions>"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "line 3" })).toBeVisible();
  expect(state.imports).toHaveLength(2);
});

test("reports an oversized BPMN payload from the backend", async ({ page }) => {
  await mockApi(page, {
    bpmnImport: () => ({
      status: 413,
      body: { title: "Payload Too Large", status: 413, detail: "BPMN XML exceeds the maximum size." },
    }),
  });
  await openDesigner(page);

  await page.getByLabel("Import BPMN file").setInputFiles({
    name: "large.bpmn",
    mimeType: "application/xml",
    buffer: Buffer.from("<bpmn:definitions/>"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "maximum size" })).toBeVisible();
});

test("creates nodes and an edge with the keyboard and guards unsaved navigation", async ({
  page,
}) => {
  await mockApi(page);
  await openDesigner(page);

  const search = page.getByLabel("Search node types");
  await search.focus();
  await search.type("start");
  await search.press("ArrowDown");
  await search.press("Enter");
  await search.fill("end");
  await search.press("ArrowDown");
  await search.press("Enter");

  const source = await page.getByLabel("Transition source").locator("option").nth(1).getAttribute("value");
  const target = await page.getByLabel("Transition target").locator("option").nth(2).getAttribute("value");
  await page.getByLabel("Transition source").selectOption(source as string);
  await page.getByLabel("Transition target").selectOption(target as string);
  await page.getByRole("button", { name: "Add transition" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const prevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
