import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateIsolation,
  extractAiLatency,
  extractPlatformLatency,
  MAX_PLATFORM_P95_DELTA_MS,
  PLATFORM_P95_BUDGET_MS,
  renderReport,
} from "../lib/ai-latency-isolation.mjs";

function platform(p95, p99 = p95 * 2, errorRate = 0) {
  return { p95, p99, errorRate };
}

test("a slow AI path does not move a healthy platform p95", () => {
  const result = evaluateIsolation({
    platformWithoutAi: platform(300, 600),
    platformWithAi: platform(350, 700),
    ai: { p95: 9000, p99: 12000 },
  });

  assert.equal(result.delta, 50);
  // The platform checks pass, but the AI budget itself fails: AI is still measured separately.
  assert.equal(result.checks.find((check) => check.id === "platform_p95").pass, true);
  assert.equal(result.checks.find((check) => check.id === "platform_p95_delta").pass, true);
  assert.equal(result.checks.find((check) => check.id === "ai_p95").pass, false);
  assert.equal(result.isolated, false);
});

test("isolation passes only when every budget and the AI budget hold", () => {
  const result = evaluateIsolation({
    platformWithoutAi: platform(300, 600),
    platformWithAi: platform(340, 700),
    ai: { p95: 1200, p99: 2000 },
  });

  assert.equal(result.isolated, true);
  assert.ok(result.checks.every((check) => check.pass));
});

test("a platform p95 regression fails even when the AI budget is fine", () => {
  const result = evaluateIsolation({
    platformWithoutAi: platform(300),
    platformWithAi: platform(PLATFORM_P95_BUDGET_MS + 1),
    ai: { p95: 100 },
  });

  assert.equal(result.checks.find((check) => check.id === "platform_p95").pass, false);
  assert.equal(result.isolated, false);
});

test("a p99 regression is independent of p95", () => {
  const result = evaluateIsolation({
    platformWithoutAi: platform(300, 600),
    platformWithAi: platform(340, 4500),
    ai: { p95: 100 },
  });

  assert.equal(result.checks.find((check) => check.id === "platform_p95").pass, true);
  assert.equal(result.checks.find((check) => check.id === "platform_p99").pass, false);
  assert.equal(result.isolated, false);
});

test("a platform error rate above the budget fails the proof", () => {
  const result = evaluateIsolation({
    platformWithoutAi: platform(300),
    platformWithAi: platform(340, 680, 0.02),
    ai: { p95: 100 },
  });

  assert.equal(result.checks.find((check) => check.id === "platform_error_rate").pass, false);
  assert.equal(result.isolated, false);
});

test("a large p95 delta fails even below the absolute budget", () => {
  const delta = MAX_PLATFORM_P95_DELTA_MS + 1;
  const result = evaluateIsolation({
    platformWithoutAi: platform(200),
    platformWithAi: platform(200 + delta, 900),
    ai: { p95: 100 },
  });

  assert.equal(result.checks.find((check) => check.id === "platform_p95_delta").pass, false);
  assert.equal(result.isolated, false);
});

test("a missing AI summary cannot prove isolation", () => {
  const result = evaluateIsolation({
    platformWithoutAi: platform(300),
    platformWithAi: platform(340),
    ai: { p95: Number.NaN },
  });

  assert.equal(result.checks.find((check) => check.id === "ai_measured").pass, false);
  assert.equal(result.isolated, false);
});

test("k6 summary shapes are read from values or inline stats", () => {
  const exported = {
    metrics: {
      "http_req_duration{scenario:ai_chat}": { values: { "p(95)": 1200, "p(99)": 2400 } },
      http_req_duration: { values: { "p(95)": 300, "p(99)": 600 } },
      http_req_failed: { values: { rate: 0.001 } },
    },
  };

  assert.deepEqual(extractAiLatency(exported), { p95: 1200, p99: 2400 });
  assert.deepEqual(extractPlatformLatency(exported), { p95: 300, p99: 600, errorRate: 0.001 });

  const inline = {
    metrics: {
      "http_req_duration{scenario:ai_chat}": { "p(95)": 800 },
      http_req_duration: { "p(95)": 250, "p(99)": 500 },
      http_req_failed: { rate: 0 },
    },
  };

  assert.deepEqual(extractAiLatency(inline), { p95: 800, p99: Number.NaN });
  assert.deepEqual(extractPlatformLatency(inline), { p95: 250, p99: 500, errorRate: 0 });
});

test("the report names the verdict and the delta", () => {
  const report = renderReport(
    evaluateIsolation({
      platformWithoutAi: platform(300),
      platformWithAi: platform(340),
      ai: { p95: 100 },
    }),
  );

  assert.match(report, /AI latency isolation: PASS/);
  assert.match(report, /Platform p95 delta: 40\.000ms/);
  assert.match(report, /PASS ai_p95: 100 <= 5000/);
});
