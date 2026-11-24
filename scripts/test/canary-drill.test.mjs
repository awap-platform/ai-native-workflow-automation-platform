import assert from "node:assert/strict";
import test from "node:test";

import {
  allChecksPass,
  decidePromotion,
  evaluateWindow,
  percentile,
  runDrill,
  windowMetrics,
} from "../canary/drill.mjs";

const policy = {
  stages: [5, 25, 100],
  observationWindowMinutes: 30,
  automaticRollback: true,
  thresholds: {
    errorRate: 0.01,
    p95LatencyMs: 1500,
    lcpMs: 2500,
    cls: 0.1,
    tbtMs: 200,
    inpMs: 200,
  },
};

test("percentile uses nearest-rank without mutating the input", () => {
  const values = [30, 10, 20, 40];
  assert.equal(percentile(values, 50), 20);
  assert.equal(percentile(values, 95), 40);
  assert.equal(percentile([], 95), 0);
  assert.deepEqual(values, [30, 10, 20, 40]);
});

test("windowMetrics computes error rate and p95", () => {
  const metrics = windowMetrics([
    { status: 200, durationMs: 10 },
    { status: 200, durationMs: 20 },
    { status: 500, durationMs: 30 },
    { status: 503, durationMs: 40 },
  ]);
  assert.equal(metrics.total, 4);
  assert.equal(metrics.errors, 2);
  assert.equal(metrics.errorRate, 0.5);
  assert.equal(metrics.p95Ms, 40);
});

test("evaluateWindow fails on error-rate or latency breach and promotion follows it", () => {
  const clean = evaluateWindow({ total: 10, errors: 0, errorRate: 0, p95Ms: 100 }, policy.thresholds);
  assert.equal(clean.withinSlo, true);
  assert.equal(decidePromotion(clean), true);

  const slow = evaluateWindow(
    { total: 10, errors: 0, errorRate: 0, p95Ms: 2_000 },
    policy.thresholds,
  );
  assert.equal(slow.withinSlo, false);
  assert.equal(decidePromotion(slow), false);
  assert.ok(slow.failures.some((failure) => failure.includes("p95Latency")));

  const noisy = evaluateWindow(
    { total: 10, errors: 1, errorRate: 0.1, p95Ms: 100 },
    policy.thresholds,
  );
  assert.equal(noisy.withinSlo, false);
  assert.ok(noisy.failures.some((failure) => failure.includes("errorRate")));
});

test("the drill promotes 5 -> 25 -> 100, rolls back and measures RTO", async () => {
  const evidence = await runDrill({
    policy,
    requestsPerStage: 20,
    detectionRequests: 10,
    seed: 7,
  });

  assert.deepEqual(
    evidence.stages.map((stage) => stage.percent),
    [5, 25, 100],
  );
  assert.equal(evidence.promotion.completed, true);
  assert.equal(evidence.rollback.previousVersionServing, true);
  assert.equal(evidence.rollback.alertFired, true);
  assert.ok(evidence.rollback.rtoSeconds >= 0);
  assert.ok(evidence.rollback.rtoSeconds < 300);
  assert.equal(evidence.tenantIsolation.crossTenant, 0);
  assert.equal(evidence.checks.U2.promoted, false);
  assert.equal(evidence.checks.U6.healthyTenantErrors, 0);
  assert.equal(evidence.checks.U6.failedTenantErrors, 20);
  assert.equal(evidence.journeys.length, 10);
  assert.equal(evidence.unhappyPaths.length, 6);
  assert.equal(allChecksPass(evidence), true);
});

test("allChecksPass rejects a red journey or a missing rollback", () => {
  const evidence = {
    stages: [{ withinSlo: true }],
    rollback: { previousVersionServing: true, alertFired: true },
    tenantIsolation: { crossTenant: 0 },
    journeys: [{ id: "T1", status: "FAIL" }],
    unhappyPaths: [],
  };
  assert.equal(allChecksPass(evidence), false);
});
