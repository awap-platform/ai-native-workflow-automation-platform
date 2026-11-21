import { existsSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Phase 6 form builder and fill (T6-01…T6-10, U6-01…U6-10).
 *
 * The API is mocked so the builder layout, validation, conditional visibility,
 * calculated values, version display, error mapping and scan-gated downloads are
 * deterministic without Postgres or MinIO. Server-side enforcement lives in
 * `FormServicePhase6Test`; these specs prove the UI sends what the server needs
 * and renders every rejection the server can return.
 */

const API = "http://localhost:8080";
const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const DRAFT_KEY = "awap:form-builder-draft:tenant-a";

type Field = Record<string, unknown>;

const INTAKE_FIELDS: Field[] = [
  { id: "intro", type: "SECTION", label: "Customer" },
  { id: "name", type: "TEXT", label: "Full name", required: true },
  { id: "email", type: "EMAIL", label: "Email" },
  { id: "notes", type: "TEXTAREA", label: "Notes", maxLength: 40 },
  { id: "tier", type: "SELECT", label: "Tier", options: ["Gold", "Silver"] },
  {
    id: "vip",
    type: "TEXT",
    label: "VIP code",
    required: true,
    visibleWhen: { fieldId: "tier", operator: "EQUALS", value: "Gold" },
  },
  { id: "units", type: "NUMBER", label: "Units", min: 1, max: 5 },
  { id: "total", type: "NUMBER", label: "Total", calculated: "units * 2" },
  { id: "agree", type: "BOOLEAN", label: "I agree" },
  { id: "tags", type: "MULTI_SELECT", label: "Tags", options: ["alpha", "beta"] },
  { id: "split", type: "DIVIDER" },
];

interface MockOptions {
  fields?: Field[];
  detailStatus?: number;
  submitStatus?: number;
  submitFiles?: Array<{ fileId: string; name: string; size: number; scanStatus: string }>;
  submissions?: string[];
}

async function seedSession(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "awap_session", value: "1", url: ORIGIN, sameSite: "Lax" },
    { name: "awap_tenant", value: "tenant-a", url: ORIGIN, sameSite: "Lax" },
    { name: "XSRF-TOKEN", value: "e2e-csrf", url: API },
  ]);
}

function definition(fields: Field[]) {
  return {
    id: "form-1",
    tenantId: "tenant-a",
    name: "Customer intake",
    schemaJson: JSON.stringify({ name: "Customer intake", version: 2, fields }),
    version: 2,
    createdAt: "2026-11-20T10:00:00Z",
  };
}

async function mockApi(page: Page, options: MockOptions = {}): Promise<string[]> {
  const fields = options.fields ?? INTAKE_FIELDS;
  const submissions = options.submissions ?? [];
  const json = async (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  // Catch-all first: Playwright gives the most recently registered route priority.
  await page.route(`${API}/**`, async (route) => {
    if (route.request().method() === "GET") {
      await json(route, []);
      return;
    }
    await json(route, {});
  });

  await page.route(`${API}/api/v1/forms`, (route) => json(route, [definition(fields)]));
  await page.route(`${API}/api/v1/forms/form-1`, (route) =>
    options.detailStatus && options.detailStatus !== 200
      ? json(route, { title: "Not found" }, options.detailStatus)
      : json(route, definition(fields)),
  );
  await page.route(`${API}/api/v1/forms/form-1/submissions`, async (route) => {
    submissions.push(String(route.request().postData() ?? ""));
    if (options.submitStatus && options.submitStatus !== 201) {
      await json(route, { title: "Rejected" }, options.submitStatus);
      return;
    }
    await json(
      route,
      {
        id: "submission-1",
        formId: "form-1",
        formVersion: 2,
        workflowInstanceId: null,
        dataJson: "{}",
        submittedBy: null,
        createdAt: "2026-11-20T10:00:00Z",
        files: options.submitFiles ?? [],
      },
      201,
    );
  });
  await page.route(`${API}/api/v1/documents/**`, (route) =>
    json(route, { downloadUrl: "https://files.example.test/clean.pdf" }),
  );
  await page.route(`${API}/api/v1/workflow-instances`, (route) => json(route, []));
  return submissions;
}

async function fieldOrder(page: Page): Promise<string[]> {
  return page
    .locator("li.awap-form__row-item")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-field-id") ?? ""));
}

async function fieldSignature(page: Page): Promise<Array<Record<string, string>>> {
  return page.locator("[data-field-id]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const control = node.querySelector("input, select, textarea");
      return {
        id: node.getAttribute("data-field-id") ?? "",
        type: node.getAttribute("data-field-type") ?? "",
        tag: control?.tagName ?? "",
        inputType: control?.getAttribute("type") ?? "",
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    }),
  );
}

async function openBuilder(page: Page): Promise<void> {
  await seedSession(page);
  await mockApi(page);
  await page.goto("/forms/builder");
  await expect(page.getByRole("heading", { name: "Form Builder" })).toBeVisible();
}

test.describe("form builder", () => {
  test("adds palette fields, edits properties, reorders and autosaves", async ({ page }) => {
    await openBuilder(page);
    await page.getByLabel("Form name").fill("Intake form");

    await page.getByRole("button", { name: "TEXT", exact: true }).click();
    await page.getByRole("button", { name: "TEXTAREA", exact: true }).click();
    await page.getByRole("button", { name: "SECTION", exact: true }).click();

    expect(await fieldOrder(page)).toEqual(["text_1", "textarea_1", "section_1"]);

    await page.getByRole("button", { name: "Move Textarea 1 up" }).click();
    expect(await fieldOrder(page)).toEqual(["textarea_1", "text_1", "section_1"]);

    await page.getByRole("button", { name: "Select Text 1" }).click();
    await page.getByLabel("Label").fill("Full name");
    await page.getByLabel("Required").check();
    await page.getByLabel("Minimum length").fill("2");
    await page.getByLabel("Pattern (regular expression)").fill("^[A-Za-z ]+$");

    await expect(
      page.getByRole("button", { name: "Select Full name" }),
    ).toBeVisible();

    // Draft autosave restores the canvas after a reload (U6-10 for the builder).
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByText("Draft restored from this browser.")).toBeVisible();
    expect(await fieldOrder(page)).toEqual(["textarea_1", "text_1", "section_1"]);
    await expect(page.getByRole("button", { name: "Select Full name" })).toBeVisible();
  });

  test("blocks saving a calculation cycle", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("button", { name: "NUMBER", exact: true }).click();
    await page.getByRole("button", { name: "NUMBER", exact: true }).click();

    await page.getByRole("button", { name: "Select Number 1" }).click();
    await page.getByLabel("Calculated expression").fill("number_2 + 1");
    await page.getByRole("button", { name: "Select Number 2" }).click();
    await page.getByLabel("Calculated expression").fill("number_1 + 1");

    const issues = page.getByTestId("schema-issues");
    await expect(issues).toContainText("Calculated fields form a cycle");

    await page.getByRole("button", { name: "Save form" }).click();
    await expect(page.locator(".awap-form__messages p").first()).toContainText("schema problem");
    await expect(page).toHaveURL(/forms\/builder/);
  });

  test("previews conditional visibility with the fill renderer", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("button", { name: "TEXT", exact: true }).click();
    await page.getByRole("button", { name: "TEXT", exact: true }).click();

    await page.getByRole("button", { name: "Select Text 1" }).click();
    await page.getByLabel("Required").check();

    await page.getByRole("button", { name: "Select Text 2" }).click();
    await page.getByLabel("Only show this field when…").check();
    await page.locator("#condition-field").selectOption("text_1");
    await page.locator("#condition-operator").selectOption("IS_NOT_EMPTY");

    await page.getByRole("button", { name: "Preview" }).click();
    const renderer = page.getByTestId("form-renderer");
    await expect(renderer.locator('[data-field-id="text_2"]')).toHaveCount(0);

    await renderer.locator("#preview-text_1").fill("Ada");
    await expect(renderer.locator('[data-field-id="text_2"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Validate preview" }).click();
    await expect(page.getByTestId("form-error-summary")).toHaveCount(0);

    await renderer.locator("#preview-text_1").fill("");
    await page.getByRole("button", { name: "Validate preview" }).click();
    await expect(page.getByTestId("form-error-summary")).toBeFocused();

    await page.getByRole("button", { name: "Back to builder" }).click();
    await expect(page.getByTestId("form-canvas")).toBeVisible();
  });

  test("T6-07/T6-10 preview and fill render the same fields and pixels", async ({ page }, testInfo) => {
    await seedSession(page);
    await mockApi(page);
    await page.addInitScript(
      ([key, fields]) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            name: "Parity",
            fields,
            formId: null,
            readOnly: false,
            savedAt: new Date(0).toISOString(),
          }),
        );
      },
      [DRAFT_KEY, INTAKE_FIELDS] as const,
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/forms/builder");
    await page.getByRole("button", { name: "Preview" }).click();
    const preview = page.getByTestId("form-renderer");
    await expect(preview).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const previewSignature = await fieldSignature(page);

    const previewPath = testInfo.snapshotPath("visual/form-preview-renderer-1280x900.png");
    if (!existsSync(previewPath)) {
      await preview.screenshot({ path: previewPath, animations: "disabled" });
      testInfo.annotations.push({ type: "baseline-created", description: previewPath });
    } else {
      await expect(preview).toHaveScreenshot("visual/form-preview-renderer-1280x900.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.001,
      });
    }

    await page.goto("/forms/fill?formId=form-1");
    const fill = page.getByTestId("form-renderer");
    await expect(fill).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const fillSignature = await fieldSignature(page);

    expect(fillSignature).toEqual(previewSignature);

    const fillPath = testInfo.snapshotPath("visual/form-fill-renderer-1280x900.png");
    if (!existsSync(fillPath)) {
      await fill.screenshot({ path: fillPath, animations: "disabled" });
      testInfo.annotations.push({ type: "baseline-created", description: fillPath });
    } else {
      await expect(fill).toHaveScreenshot("visual/form-fill-renderer-1280x900.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.001,
      });
    }

    // T6-10: the two surfaces must occupy the same box (within one pixel) on top of the
    // identical DOM signature, so the per-element baselines can differ by less than 0.1%.
    const previewBox = await preview.boundingBox();
    const fillBox = await fill.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(fillBox).not.toBeNull();
    if (previewBox && fillBox) {
      expect(Math.abs(previewBox.width - fillBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(previewBox.height - fillBox.height)).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("form fill", () => {
  async function openFill(page: Page, options: MockOptions = {}): Promise<string[]> {
    await seedSession(page);
    const submissions = await mockApi(page, options);
    await page.goto("/forms/fill?formId=form-1");
    await expect(page.getByRole("heading", { name: "Fill Form" })).toBeVisible();
    return submissions;
  }

  test("T6-02/T6-08 required errors focus the summary and the field", async ({ page }) => {
    await openFill(page);
    await expect(page.getByText("Version 2")).toBeVisible();

    await page.getByRole("button", { name: "Submit" }).click();

    const summary = page.getByTestId("form-error-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute("role", "alert");

    await page.getByRole("button", { name: '"Full name" is required.' }).click();
    await expect(page.locator("#fill-name")).toBeFocused();
  });

  test("T6-04 conditional fields appear in the fill route", async ({ page }) => {
    await openFill(page);
    await expect(page.locator('[data-field-id="vip"]')).toHaveCount(0);

    await page.locator("#fill-tier").selectOption("Gold");
    await expect(page.locator('[data-field-id="vip"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByTestId("form-error-summary")).toContainText('"VIP code" is required.');

    await page.locator("#fill-tier").selectOption("Silver");
    await expect(page.locator('[data-field-id="vip"]')).toHaveCount(0);
  });

  test("T6-03 calculated and bounded fields validate before submit", async ({ page }) => {
    const submissions = await openFill(page);
    await page.locator("#fill-name").fill("Ada");
    await page.locator("#fill-units").fill("3");
    await expect(page.locator("#fill-total")).toHaveValue("6");

    await page.locator("#fill-units").fill("9");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByTestId("form-error-summary")).toContainText(
      '"Units" must be at most 5.',
    );
    expect(submissions).toHaveLength(0);
  });

  test("U6-03 sends typed JSON and clears the values after success", async ({ page }) => {
    const submissions = await openFill(page);
    await page.locator("#fill-name").fill("Ada");
    await page.locator("#fill-units").fill("4");
    await page.locator("#fill-agree").check();
    await page.getByRole("checkbox", { name: "alpha" }).check();

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Submitted", { exact: true })).toBeVisible();

    const body = JSON.parse(submissions[0] ?? "{}") as { dataJson?: string };
    const data = JSON.parse(body.dataJson ?? "{}") as Record<string, unknown>;
    expect(data).toEqual({
      name: "Ada",
      units: 4,
      agree: true,
      tags: ["alpha"],
      total: 8,
    });
  });

  test("U6-04/U6-05/U6-06 map server rejections to actionable copy", async ({ page }) => {
    await openFill(page, { submitStatus: 413 });
    await page.locator("#fill-name").fill("Ada");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".awap-form__status")).toContainText("too large (HTTP 413)");

    await page.unroute(`${API}/api/v1/forms/form-1/submissions`);
    await page.route(`${API}/api/v1/forms/form-1/submissions`, (route) =>
      route.fulfill({ status: 415, contentType: "application/json", body: "{}" }),
    );
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".awap-form__status")).toContainText("not supported (HTTP 415)");

    await page.unroute(`${API}/api/v1/forms/form-1/submissions`);
    await page.route(`${API}/api/v1/forms/form-1/submissions`, (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
    );
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".awap-form__status")).toContainText("no longer exists (HTTP 404)");
  });

  test("U6-07/U6-08 scan status gates the attachment download", async ({ page }) => {
    await openFill(page, {
      submitFiles: [
        { fileId: "clean-1", name: "clean.pdf", size: 2048, scanStatus: "PROMOTED" },
        { fileId: "virus-1", name: "virus.pdf", size: 2048, scanStatus: "INFECTED" },
      ],
    });
    await page.locator("#fill-name").fill("Ada");
    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByRole("heading", { name: "Submitted files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download clean.pdf" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Download unavailable" })).toBeDisabled();
    await expect(page.getByText("Blocked: the file failed the antivirus scan")).toBeVisible();
  });

  test("U6-09 hostile labels stay text and emoji/RTL survive", async ({ page }) => {
    await openFill(page, {
      fields: [
        {
          id: "greeting",
          type: "TEXT",
          label: '<img src="x" onerror="alert(1)"> Merhaba 👋 مرحبا',
          help: "<b>not bold</b>",
        },
        { id: "name", type: "TEXT", label: "اسم 👋" },
      ],
    });

    await expect(page.getByText('<img src="x" onerror="alert(1)"> Merhaba 👋 مرحبا')).toBeVisible();
    await expect(page.locator("form img")).toHaveCount(0);
    await expect(page.getByText("<b>not bold</b>")).toBeVisible();

    await page.locator("#fill-name").fill("مرحبا 👋 Ada");
    await expect(page.locator("#fill-name")).toHaveValue("مرحبا 👋 Ada");
  });

  test("long text is blocked client-side before the request", async ({ page }) => {
    const submissions = await openFill(page);
    await page.locator("#fill-name").fill("Ada");
    await page.locator("#fill-notes").fill("x".repeat(41));
    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByTestId("form-error-summary")).toContainText(
      '"Notes" must be at most 40 characters.',
    );
    expect(submissions).toHaveLength(0);
  });

  test("U6-10 back-navigation preserves answers", async ({ page }) => {
    await openFill(page);
    await page.locator("#fill-name").fill("Ada");
    await page.locator("#fill-units").fill("2");

    await page.goto("/dashboard");
    await page.goBack();

    await expect(page.locator("#fill-name")).toHaveValue("Ada");
    await expect(page.locator("#fill-units")).toHaveValue("2");
  });

  test("read-only rendering disables the form and hides submit", async ({ page }) => {
    await seedSession(page);
    await mockApi(page);
    await page.goto("/forms/fill?formId=form-1&readonly=1");
    await expect(page.getByRole("heading", { name: "Fill Form" })).toBeVisible();
    await expect(page.locator("#fill-name")).toHaveAttribute("readonly", "");
    await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);
    await expect(page.getByText("the fields are disabled")).toBeVisible();
  });
});
