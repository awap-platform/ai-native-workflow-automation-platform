import { expect, test } from "@playwright/test";

/**
 * CSP collector contract (UI/UX phase 0, T0-09 / U0-01).
 *
 * A valid report is recorded and answered with 204; malformed JSON and an
 * unrecognized body are rejected with 400 so a broken client is visible in
 * dashboards instead of being silently accepted.
 */
test("a valid report is recorded and listed in the summary", async ({ request }) => {
  const before = await request.get("/api/csp-report");
  expect(before.ok()).toBe(true);

  const response = await request.post("/api/csp-report", {
    data: {
      "csp-report": {
        "document-uri": `http://localhost:3000/tasks?token=secret&run=${Date.now()}`,
        "blocked-uri": "inline",
        "violated-directive": "style-src-attr",
      },
    },
  });
  expect(response.status()).toBe(204);

  const summary = await request.get("/api/csp-report");
  expect(summary.ok()).toBe(true);
  const body = (await summary.json()) as {
    total: number;
    byDirective: Record<string, number>;
    byRoute: Array<{ route: string; count: number }>;
  };
  expect(body.total).toBeGreaterThan(0);
  expect(body.byDirective["style-src-attr"]).toBeGreaterThan(0);
  expect(body.byRoute.some((row) => row.route === "/tasks")).toBe(true);
});

test("malformed JSON is rejected with 400", async ({ request }) => {
  const response = await request.post("/api/csp-report", {
    headers: { "content-type": "application/json" },
    data: "{not-json",
  });
  expect(response.status()).toBe(400);
});

test("an unrecognized body is rejected with 400", async ({ request }) => {
  const response = await request.post("/api/csp-report", {
    data: { hello: "world" },
  });
  expect(response.status()).toBe(400);
});
