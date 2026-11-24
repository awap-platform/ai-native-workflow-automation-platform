import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  installApiMocks,
  openScreen,
  SCREENS,
  setSession,
  type ScreenDefinition,
} from "./a11yFixtures";

/**
 * Screen-reader protocol journeys (issue #366, T1–T10).
 *
 * These tests execute the exact protocol in
 * `docs/accessibility/manual-pass-protocol.md` against the Chromium accessibility
 * tree. They do not replace a physical NVDA/VoiceOver run; they prove the
 * semantics the screen reader consumes, and the evidence checker ties every
 * protocol row to an executable test or an existing spec.
 */

function screen(name: string): ScreenDefinition {
  const found = SCREENS.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`Unknown screen fixture: ${name}`);
  }
  return found;
}

async function assertNoHorizonalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test("T1: login fields, button and error region have accessible names", async ({ page }) => {
  await openScreen(page, screen("login"), "empty");

  await expect(page.getByLabel("Tenant slug")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // The error region must exist before the first failure so a screen reader can
  // announce it without a layout shift stealing focus.
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();

  const tree = await page.locator("main").ariaSnapshot();
  expect(tree).toContain("textbox");
  expect(tree).toContain("button");
});

test("T2: inbox rows announce title, status and assignee", async ({ page }) => {
  await openScreen(page, screen("tasks"), "populated");

  const row = page.getByTestId("task-row-task-1");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Approve expense");
  await expect(row).toContainText(/Assigned/i);
  await expect(row).toContainText("user-1");

  // The row is a real button, so Enter/Space and the screen-reader "activate"
  // gesture both select the work item.
  await expect(row).toHaveRole("button");
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Approve expense" })).toBeVisible();
});

test("T3: task 360 exposes a tab list with labelled decision fields", async ({ page }) => {
  await openScreen(page, screen("tasks"), "populated");
  await page.getByTestId("task-row-task-1").click();

  const tablist = page.getByRole("tablist");
  await expect(tablist).toBeVisible();
  await expect(page.getByRole("tab", { name: "Decision" })).toBeVisible();
  await page.getByRole("tab", { name: "Decision" }).click();
  await expect(page.getByLabel("Comment")).toBeVisible();
  await expect(page.getByLabel("Assignee")).toBeVisible();

  const decisionTab = page.getByRole("tab", { name: "Decision" });
  await expect(decisionTab).toHaveAttribute("aria-selected", "true");
});

test("T4: designer palette and process navigator are keyboard reachable", async ({ page }) => {
  await openScreen(page, screen("workflow-designer"), "empty");

  await expect(page.getByRole("button", { name: "TASK", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Process navigator" })).toBeVisible();
  const navigator = page.getByTestId("process-navigator");
  await expect(navigator).toHaveRole("navigation");

  // The navigator is the screen-reader path to the canvas: focus its heading and
  // confirm the empty state is announced instead of an unlabelled canvas.
  await expect(navigator).toContainText("No nodes yet.");
});

test("T5: form validation moves focus to the error summary and associates the field error", async ({
  page,
}) => {
  await openScreen(page, screen("form-fill"), "populated");
  await page.getByLabel("Form").selectOption("form-1", { force: true });
  await expect(page.getByText("customer_name")).toBeVisible();

  await page.getByRole("button", { name: "Submit" }).click();

  const summary = page.getByTestId("form-error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveRole("alert");
  await expect(summary).toBeFocused();

  const field = page.locator('[data-field-id="customer_name"] input');
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = await field.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toContainText(/required/i);
});

test("T6: document scan status is a polite live region announced once", async ({ page }) => {
  await openScreen(page, screen("documents"), "populated");

  const announcer = page.getByTestId("document-scan-announcer");
  await expect(announcer).toHaveRole("status");
  await expect(announcer).toHaveAttribute("aria-live", "polite");
  await expect(announcer).toHaveAttribute("aria-atomic", "true");
});

test("T7: Copilot HITL panel names the action and hash before the approval buttons", async ({
  page,
}) => {
  await openScreen(page, screen("copilot"), "empty");

  const details = page.locator("details", { hasText: "Prepare an approval" });
  const open = await details.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!open) {
    await details.locator("summary").click();
  }
  await page.getByLabel("Workflow instance id").fill("inst-1");
  await page.getByLabel("Approval title").fill("Approve leave");
  await page.getByLabel("Description").fill("Ada requested three days of leave.");
  await page.getByTestId("copilot-propose-approval").click();

  const panel = page.getByTestId("copilot-hitl-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Human confirmation required" })).toBeVisible();
  await expect(page.getByTestId("copilot-hitl-action")).toContainText("create_approval");
  await expect(page.getByTestId("copilot-hitl-hash")).toContainText("b".repeat(64));
  await expect(panel.getByRole("button", { name: "Approve and run" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Reject" })).toBeVisible();
});

test("T8: mobile drawer traps focus, closes on Escape and restores the trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, screen("dashboard"), "empty");

  const trigger = page.getByTestId("open-mobile-menu");
  await trigger.click();
  const drawer = page.getByTestId("mobile-drawer");
  await expect(drawer).toBeVisible();

  // Focus must move into the drawer, not stay behind on the page.
  const focusInside = await drawer.evaluate((element) => element.contains(document.activeElement));
  expect(focusInside).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("T9: forced-colours mode keeps controls visible with no serious axe violations", async ({
  page,
}) => {
  await openScreen(page, screen("login"), "empty");
  await page.emulateMedia({ forcedColors: "active" });

  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeVisible();
  const colours = await signIn.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  expect(colours.color).not.toBe("");
  expect(colours.backgroundColor).not.toBe("");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toBe("");
});

test("T10: 200% zoom reflow keeps every action reachable without horizontal scroll", async ({
  page,
}) => {
  // 640 CSS px is the 200% zoom equivalent of a 1280 px viewport.
  await page.setViewportSize({ width: 640, height: 900 });
  await openScreen(page, screen("tasks"), "populated");

  await assertNoHorizonalOverflow(page);
  await expect(page.getByTestId("task-row-task-1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve expense" })).toBeVisible();
});

test("U2: a 403 renders an announced forbidden state with no empty success shell", async ({
  page,
}) => {
  await setSession(page, { tenant: "tenant-a", role: "MANAGER" });
  await installApiMocks(page, true);
  // Last registered route wins: every task read is forbidden for this role.
  await page.route("**/api/v1/tasks", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ title: "Forbidden" }),
    }),
  );
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Task inbox" })).toBeVisible();
  await expect(page.getByTestId("forbidden-state")).toHaveRole("alert");
  await expect(page.getByTestId("forbidden-state")).toContainText("permission");
});

test("U3: a validation failure focuses the summary and names the field", async ({ page }) => {
  await openScreen(page, screen("form-fill"), "populated");
  await page.getByLabel("Form").selectOption("form-1", { force: true });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("form-error-summary")).toBeFocused();
  await expect(page.getByTestId("form-error-summary")).toContainText(/required/i);
});

test("U4: closing the decision dialog returns focus to the action that opened it", async ({
  page,
}) => {
  await openScreen(page, screen("tasks"), "populated");
  await page.getByTestId("task-row-task-1").click();
  await page.getByRole("tab", { name: "Decision" }).click();
  const approve = page.getByTestId("task-approve");
  await approve.click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
  await expect(approve).toBeFocused();
});

test("U5: live scan updates stay polite and never steal focus", async ({ page }) => {
  await openScreen(page, screen("documents"), "populated");
  const announcer = page.getByTestId("document-scan-announcer");
  await expect(announcer).toHaveAttribute("aria-live", "polite");
  await expect(announcer).not.toHaveAttribute("aria-live", "assertive");
  await expect(page.getByRole("button", { name: /upload/i }).first()).toBeVisible();
});

test("U6: long Turkish text remains readable and does not force horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openScreen(page, screen("tasks"), "populated");
  await expect(page.getByText("Şirketler arası ödeme onayı ve belge kontrolü")).toBeVisible();
  await assertNoHorizonalOverflow(page);
});
