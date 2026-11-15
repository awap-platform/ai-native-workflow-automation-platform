/**
 * SLO isolation proof for AI latency (issue #290).
 *
 * The platform P95 must stay inside its own budget even when AI calls are slow, because AI latency
 * is measured and alerted separately. This module turns two k6 summaries (a baseline without AI
 * traffic and a run with slow AI traffic) plus the AI summary into explicit, testable checks.
 */

export const PLATFORM_P95_BUDGET_MS = 2000;
export const PLATFORM_P99_BUDGET_MS = 4000;
export const PLATFORM_ERROR_RATE_BUDGET = 0.01;
export const AI_P95_BUDGET_MS = 5000;
export const MAX_PLATFORM_P95_DELTA_MS = 500;

/** k6 writes stats either under `values` (`--summary-export`) or inline. Accept both. */
function valuesOf(summary, metric) {
  const entry = summary?.metrics?.[metric];
  return entry?.values ?? entry ?? {};
}

function numeric(...candidates) {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return Number.NaN;
}

export function extractPlatformLatency(summary, metric = "http_req_duration") {
  const values = valuesOf(summary, metric);
  return {
    p95: numeric(values["p(95)"]),
    p99: numeric(values["p(99)"]),
    errorRate: numeric(
      valuesOf(summary, "http_req_failed").rate,
      0,
    ),
  };
}

export function extractAiLatency(summary, metric = "http_req_duration{scenario:ai_chat}") {
  const values = valuesOf(summary, metric);
  return { p95: numeric(values["p(95)"]), p99: numeric(values["p(99)"]) };
}

function check(id, label, actual, target, comparator) {
  const pass = comparator === "<=" ? actual <= target : actual >= target;
  return { id, label, actual, target, comparator, pass };
}

/**
 * Returns every isolation check and the overall verdict. A run is isolated only when the platform
 * budgets hold, the platform P95 delta versus the no-AI baseline is bounded, and the AI P95 itself
 * is inside the separate AI budget.
 */
export function evaluateIsolation({ platformWithoutAi, platformWithAi, ai }) {
  const delta = platformWithAi.p95 - platformWithoutAi.p95;
  const checks = [
    check(
      "platform_p95",
      "Platform p95 stays inside its own 2s budget",
      platformWithAi.p95,
      PLATFORM_P95_BUDGET_MS,
      "<=",
    ),
    check(
      "platform_p99",
      "Platform p99 stays inside its own 4s budget",
      platformWithAi.p99,
      PLATFORM_P99_BUDGET_MS,
      "<=",
    ),
    check(
      "platform_error_rate",
      "Platform error rate stays under 1%",
      platformWithAi.errorRate,
      PLATFORM_ERROR_RATE_BUDGET,
      "<=",
    ),
    check(
      "platform_p95_delta",
      "Slow AI traffic moves the platform p95 by at most 500ms",
      delta,
      MAX_PLATFORM_P95_DELTA_MS,
      "<=",
    ),
    check(
      "ai_p95",
      "AI p95 is measured against the separate 5s budget",
      ai.p95,
      AI_P95_BUDGET_MS,
      "<=",
    ),
    check(
      "ai_measured",
      "AI latency is reported by its own scenario",
      ai.p95,
      Number.NaN,
      ">=",
    ),
  ];
  // `ai_measured` is a presence check: a missing AI summary must fail the proof.
  const measured = checks[checks.length - 1];
  measured.pass = Number.isFinite(ai.p95);
  return { isolated: checks.every((entry) => entry.pass), delta, checks };
}

export function renderReport(result) {
  const lines = [
    `AI latency isolation: ${result.isolated ? "PASS" : "FAIL"}`,
    `Platform p95 delta: ${result.delta.toFixed(3)}ms`,
    ...result.checks.map(
      (entry) =>
        `${entry.pass ? "PASS" : "FAIL"} ${entry.id}: ${entry.actual} ${entry.comparator} ${entry.target}`,
    ),
  ];
  return lines.join("\n");
}
