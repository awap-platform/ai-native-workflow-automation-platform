import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 7 (documents, notifications and templates).
 *
 * EventSource is stubbed in the browser because Playwright route fulfilment cannot hold an SSE
 * response open; every other request (list, presign, PUT, PATCH, preview, versions) runs through the
 * real page and the real API client.
 */
const API = "**/api/v1/**";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const NOW = "2026-01-01T00:00:00Z";

function documentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    fileId: "file-1",
    version: 1,
    size: 2048,
    format: "pdf",
    status: "PENDING",
    createdAt: NOW,
    name: "report.pdf",
    scanStatus: "QUARANTINED",
    scanError: null,
    downloadable: false,
    ...overrides,
  };
}

function scanEvent(status: string, detail = "", occurredAt = NOW) {
  return {
    tenantId: "tenant-a",
    fileId: "file-1",
    name: "report.pdf",
    status,
    detail,
    occurredAt,
  };
}

async function session(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "awap_session", value: "1", url: BASE },
    { name: "awap_tenant", value: "tenant-a", url: BASE },
    // `apiBase()` points at the backend origin. Seeding the CSRF cookie keeps the
    // client from bootstrapping it over the network, which the mocked stack does not serve.
    { name: "XSRF-TOKEN", value: "e2e-csrf", url: "http://localhost:8080" },
  ]);
}

/**
 * Installs a controllable EventSource. `__emit` opens the stream and emits a scan-status event;
 * `__drop` fails the current stream and makes the next reconnect throw, which pushes the hook onto
 * its polling fallback without waiting for five backoff rounds.
 */
async function installFakeStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      EventSource?: unknown;
      __emitDocumentScan?: (payload: unknown) => void;
      __dropDocumentScan?: () => void;
      __documentStreamCount?: () => number;
      __failNextSource?: boolean;
    };
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      private readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();

      constructor(readonly url: string) {
        if (scope.__failNextSource) {
          scope.__failNextSource = false;
          throw new Error("EventSource reconnect blocked for the polling-fallback test");
        }
        FakeEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: (event: { data: string }) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      close(): void {
        /* no-op */
      }

      emit(payload: unknown): void {
        const event = { data: JSON.stringify(payload) };
        (this.listeners.get("scan-status") ?? []).forEach((listener) => listener(event));
      }
    }
    scope.EventSource = FakeEventSource;
    scope.__documentStreamCount = () => FakeEventSource.instances.length;
    scope.__emitDocumentScan = (payload: unknown) => {
      const source = FakeEventSource.instances[0];
      source?.onopen?.(new Event("open"));
      source?.emit(payload);
    };
    scope.__dropDocumentScan = () => {
      const source = FakeEventSource.instances[0];
      source?.onerror?.(new Event("error"));
      scope.__failNextSource = true;
    };
  });
}

async function emit(page: Page, status: string, detail = "", occurredAt = NOW): Promise<void> {
  await page.evaluate(
    (payload) => {
      (window as unknown as { __emitDocumentScan: (value: unknown) => void }).__emitDocumentScan(
        payload,
      );
    },
    scanEvent(status, detail, occurredAt),
  );
}

interface DocumentMockOptions {
  documents: Array<Record<string, unknown>>;
  versions?: Array<Record<string, unknown>>;
  upload?: boolean;
}

async function mockDocuments(
  page: Page,
  options: DocumentMockOptions,
): Promise<{ deleted: string[]; archived: string[]; posts: number; puts: number }> {
  const calls = { deleted: [] as string[], archived: [] as string[], posts: 0, puts: 0 };
  await page.route(`${API}documents/versions/*`, async (route) => {
    const url = new URL(route.request().url());
    const versionId = url.pathname.split("/").pop() ?? "";
    if (route.request().method() === "DELETE") {
      calls.deleted.push(versionId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(documentFixture({ id: versionId, status: "ARCHIVED" })),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });
  await page.route(`${API}documents/versions/*/archive`, async (route) => {
    const versionId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    calls.archived.push(versionId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(documentFixture({ id: versionId, status: "ARCHIVED" })),
    });
  });
  await page.route("**/api/v1/documents/file-1/versions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.versions ?? options.documents),
    });
  });
  await page.route("**/api/v1/documents/file-1/retry-scan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fileId: "file-1", scanStatus: "QUARANTINED", detail: null }),
    });
  });
  await page.route(`${API}documents`, async (route) => {
    if (route.request().method() === "POST") {
      calls.posts += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          fileId: "file-1",
          uploadUrl: `${BASE}/upload/file-1`,
          version: documentFixture(),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.documents),
    });
  });
  if (options.upload !== false) {
    await page.route("**/upload/file-1", async (route) => {
      calls.puts += 1;
      await route.fulfill({ status: 200, contentType: "application/pdf", body: "uploaded" });
    });
  }
  return calls;
}

test.describe("phase 7 documents", () => {
  test("T7-01 uploads a document, walks the scan timeline and only then enables download", async ({
    page,
  }) => {
    await session(page);
    await installFakeStream(page);
    await mockDocuments(page, { documents: [documentFixture()] });
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 phase-7"),
    });
    await expect(
      page.getByText("Uploaded. Scan status updates live as soon as the antivirus run completes."),
    ).toBeVisible();

    for (const status of ["SCANNING", "CLEAN", "PROMOTED"]) {
      await emit(page, status);
    }

    await expect(page.getByTestId("scan-status-file-1")).toHaveText("Ready to download");
    const timeline = page.getByTestId("scan-timeline-file-1");
    await expect(timeline).toContainText("Scanning");
    await expect(timeline).toContainText("Clean");
    await expect(timeline).toContainText("Ready to download");
    await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  test("cancels an interrupted upload and removes the pending version", async ({ page }) => {
    await session(page);
    await installFakeStream(page);
    let release: (() => void) | undefined;
    const calls = await mockDocuments(page, {
      documents: [],
      upload: false,
    });
    await page.route("**/upload/file-1", async (route) => {
      calls.puts += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.abort();
    });
    await page.goto("/documents");

    await page.locator('input[type="file"]').setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 cancel-me"),
    });

    await expect(page.getByTestId("upload-progress")).toBeVisible();
    await page.getByRole("button", { name: "Cancel upload" }).click();

    await expect(page.getByTestId("upload-cleanup")).toContainText(
      "The pending document version was removed.",
    );
    expect(calls.deleted).toContain("version-1");
    release?.();
  });

  test("T7-02 alerts on INFECTED, blocks download and has no serious axe violations (T7-08)", async ({
    page,
  }) => {
    await session(page);
    await installFakeStream(page);
    await mockDocuments(page, {
      documents: [documentFixture({ scanStatus: "SCANNING" })],
    });
    await page.goto("/documents");
    await expect(page.getByTestId("scan-status-file-1")).toHaveText("Scanning");

    await emit(page, "INFECTED", "Antivirus scanning rejected the file.");

    const alert = page.getByTestId("document-infected-alert");
    await expect(alert).toContainText("Infected file blocked.");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(page.getByRole("button", { name: "Download" })).toBeDisabled();
    await expect(page.getByTestId("scan-status-file-1")).toHaveText("Infected");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .include('[data-testid="document-infected-alert"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("T7-03 rejects an unsupported format locally and surfaces a server 413", async ({ page }) => {
    await session(page);
    await installFakeStream(page);
    await mockDocuments(page, { documents: [] });
    await page.goto("/documents");

    await page.locator('input[type="file"]').setInputFiles({
      name: "malware.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ"),
    });
    await expect(page.getByTestId("upload-error")).toContainText("format is not supported");

    await page.route(`${API}documents`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 413,
          contentType: "application/problem+json",
          body: JSON.stringify({ detail: "File exceeds the 500 MB limit." }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "huge.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
    await expect(page.getByTestId("upload-error")).toContainText("500 MB");
  });

  test("T7-04 lists versions and archives one", async ({ page }) => {
    await session(page);
    await installFakeStream(page);
    const calls = await mockDocuments(page, {
      documents: [documentFixture({ scanStatus: "PROMOTED", downloadable: true })],
      versions: [
        documentFixture({ id: "version-0", version: 0, status: "ARCHIVED" }),
        documentFixture({ id: "version-1", version: 1, status: "AVAILABLE" }),
      ],
    });
    await page.goto("/documents");

    await page.getByRole("button", { name: "Show versions" }).click();
    await expect(page.getByTestId("version-row-version-0")).toContainText("v0");
    await expect(page.getByTestId("version-row-version-1")).toContainText("v1");

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Version archived.")).toBeVisible();
    expect(calls.archived).toContain("version-1");
  });

  test("re-queues a SCAN_FAILED scan", async ({ page }) => {
    await session(page);
    await installFakeStream(page);
    await mockDocuments(page, {
      documents: [documentFixture({ scanStatus: "SCAN_FAILED", scanError: "clamd timeout" })],
    });
    await page.goto("/documents");

    await expect(page.getByText("clamd timeout").first()).toBeVisible();
    await page.getByRole("button", { name: "Retry scan for report.pdf" }).click();
    await expect(page.getByText(/Retry queued for report.pdf/)).toBeVisible();
  });

  test("T7-09 falls back to polling after the SSE stream drops", async ({ page }) => {
    await session(page);
    await installFakeStream(page);
    await mockDocuments(page, {
      documents: [documentFixture({ scanStatus: "PROMOTED", downloadable: true })],
    });
    await page.goto("/documents");
    // Opening the stream is what flips the transport to connected; emit one snapshot event first.
    await page.waitForFunction(
      () =>
        (window as unknown as { __documentStreamCount: () => number }).__documentStreamCount() > 0,
    );
    await emit(page, "SCANNING");
    await expect(page.getByTestId("document-stream-state")).toContainText(
      "Live scan status updates are connected.",
    );

    await page.evaluate(() => {
      (window as unknown as { __dropDocumentScan: () => void }).__dropDocumentScan();
    });

    await expect(page.getByTestId("document-stream-state")).toContainText(
      "refreshing status by polling",
      { timeout: 10_000 },
    );
  });
});

function notificationFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    channel: "WEB",
    recipient: "ada@example.com",
    templateKey: "welcome",
    status: "SENT",
    attempts: 1,
    lastError: null,
    nextAttemptAt: null,
    createdAt: NOW,
    read: false,
    readAt: null,
    ...overrides,
  };
}

test.describe("phase 7 notifications and templates", () => {
  test("T7-05 marks a notification read and decrements the unread badge", async ({ page }) => {
    await session(page);
    const read = new Set<string>();
    const items = [
      notificationFixture({ id: "n1", templateKey: "welcome" }),
      notificationFixture({ id: "n2", templateKey: "digest", channel: "EMAIL" }),
    ];
    await page.route("**/api/v1/notifications/unread-count", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: items.length - read.size }),
      });
    });
    await page.route("**/api/v1/notifications/suppressions", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/v1/notifications/n1/read", async (route) => {
      read.add("n1");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationFixture({ id: "n1", read: true, readAt: NOW })),
      });
    });
    await page.route(`${API}notifications`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          items.map((item) =>
            read.has(item.id) ? { ...item, read: true, readAt: NOW } : item,
          ),
        ),
      });
    });

    await page.goto("/notifications");
    await expect(page.getByTestId("unread-badge")).toHaveAttribute(
      "aria-label",
      "Unread notifications: 2",
    );

    await page.getByRole("button", { name: 'Mark notification "welcome" as read' }).click();

    await expect(page.getByTestId("unread-badge")).toHaveAttribute(
      "aria-label",
      "Unread notifications: 1",
    );
    await expect(page.getByTestId("state-n1")).toHaveText("Read");
  });

  test("filters notifications and performs a bulk read", async ({ page }) => {
    await session(page);
    await page.route("**/api/v1/notifications/unread-count", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"count":2}' });
    });
    await page.route("**/api/v1/notifications/suppressions", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/v1/notifications/*/read", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationFixture({ read: true, readAt: NOW })),
      });
    });
    await page.route(`${API}notifications`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          notificationFixture({ id: "n1", templateKey: "welcome" }),
          notificationFixture({ id: "n2", templateKey: "digest", channel: "EMAIL" }),
        ]),
      });
    });

    await page.goto("/notifications");
    await page.getByTestId("notification-search").fill("digest");
    await expect(page.getByTestId("notification-n2")).toBeVisible();
    await expect(page.getByTestId("notification-n1")).toHaveCount(0);
    await page.getByTestId("notification-search").fill("");

    await page.getByRole("checkbox", { name: 'Select notification "welcome"' }).check();
    await page.getByRole("checkbox", { name: 'Select notification "digest"' }).check();
    await page.getByRole("button", { name: "Mark selected as read" }).click();
    await expect(page.getByTestId("bulk-result")).toContainText("2 updated");
  });

  test("T7-06 previews a template with variables and warnings", async ({ page }) => {
    await session(page);
    await page.route(`${API}notification-templates`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    });
    const previews: string[] = [];
    await page.route(`${API}notification-templates/preview`, async (route) => {
      previews.push(String(route.request().postData()));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          subject: "Welcome",
          body: "Hello Ada",
          placeholders: ["name"],
        }),
      });
    });

    await page.goto("/notification-templates");
    await page.locator("#template-key").fill("welcome");
    await page.locator("#template-subject").fill("Welcome");
    await page.locator("#template-body").fill("Hello {{name}}");
    await page.locator("#template-variables").fill('{"name":"Ada"}');

    await expect(page.getByTestId("template-placeholders")).toContainText("{{name}}");
    await page.getByRole("button", { name: "Preview template" }).click();

    await expect(page.getByTestId("preview-body")).toHaveText("Hello Ada");
    await expect(page.getByText("Placeholders: name")).toBeVisible();
    const payloads = previews.map(
      (body) => JSON.parse(body) as { variablesJson?: string; body?: string },
    );
    expect(payloads.some((payload) => payload.variablesJson === '{"name":"Ada"}')).toBe(true);
    expect(payloads.some((payload) => payload.body === "Hello {{name}}")).toBe(true);
  });

  test("warns about an empty variable without blocking preview", async ({ page }) => {
    await session(page);
    await page.route(`${API}notification-templates`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route(`${API}notification-templates/preview`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subject: "Hi", body: "Hello ", placeholders: ["name"] }),
      });
    });
    await page.goto("/notification-templates");
    await page.locator("#template-key").fill("welcome");
    await page.locator("#template-subject").fill("Hi");
    await page.locator("#template-body").fill("Hello {{name}}");
    await page.locator("#template-variables").fill('{"name":""}');

    await expect(page.getByTestId("template-warnings")).toContainText('Variable "name" is empty');
    await page.getByRole("button", { name: "Preview template" }).click();
    await expect(page.getByTestId("preview-body")).toBeVisible();
  });
});
