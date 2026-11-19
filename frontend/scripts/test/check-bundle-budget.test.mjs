import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_BUDGET_KB,
  evaluateBudget,
  manifestEntries,
  routeFromManifestKey,
} from "../check-bundle-budget.mjs";

test("normalizes manifest keys to routes", () => {
  assert.equal(routeFromManifestKey("/dashboard/page"), "/dashboard");
  assert.equal(routeFromManifestKey("/(app)/dashboard/page"), "/dashboard");
  assert.equal(routeFromManifestKey("/workflows/designer/page"), "/workflows/designer");
  assert.equal(routeFromManifestKey("/page"), "/");
});

test("reads the Turbopack manifest shape", () => {
  const entries = manifestEntries({
    rootMainFiles: ["static/chunks/root.js"],
    pagesChunkGroupBootstrapParams: {
      "/(app)/dashboard/page": { otherChunks: ["static/chunks/dashboard.js"] },
    },
  });
  assert.deepEqual(entries, [
    {
      key: "/(app)/dashboard/page",
      files: ["static/chunks/root.js", "static/chunks/dashboard.js"],
    },
  ]);
});

test("reads the webpack app-build manifest shape", () => {
  const entries = manifestEntries({
    rootMainFiles: ["static/chunks/root.js"],
    pages: { "/tasks/page": ["static/chunks/tasks.js"] },
  });
  assert.deepEqual(entries, [
    { key: "/tasks/page", files: ["static/chunks/root.js", "static/chunks/tasks.js"] },
  ]);
});

test("passes when every route is within budget", () => {
  const result = evaluateBudget(
    [
      { route: "/dashboard", gzipBytes: 120 * 1024 },
      { route: "/tasks", gzipBytes: 200 * 1024 },
    ],
    DEFAULT_BUDGET_KB * 1024,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("fails and explains which route exceeds the budget", () => {
  const result = evaluateBudget(
    [{ route: "/designer", gzipBytes: 300 * 1024 }],
    DEFAULT_BUDGET_KB * 1024,
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].route, "/designer");
  assert.equal(result.violations[0].excessBytes, 50 * 1024);
});
