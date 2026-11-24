import assert from "node:assert/strict";
import test from "node:test";

import { validateCanaryEvidence } from "../check-canary-evidence.mjs";

const policy = {
  stages: [5, 25, 100],
  thresholds: { errorRate: 0.01, p95LatencyMs: 1500 },
};

function evidence() {
  return {
    issue: 367,
    executedAt: "2026-11-24T15:00:00.000Z",
    liveProduction: false,
    policy: { stages: [5, 25, 100], thresholds: { errorRate: 0.01, p95LatencyMs: 1500 } },
    stages: [
      { percent: 5, requests: 100, withinSlo: true, failures: [] },
      { percent: 25, requests: 100, withinSlo: true, failures: [] },
      { percent: 100, requests: 100, withinSlo: true, failures: [] },
    ],
    promotion: { completed: true },
    rollback: {
      auto: true,
      alertFired: true,
      previousVersionServing: true,
      rtoSeconds: 12,
      detectedAfterMs: 30_000,
    },
    tenantIsolation: { crossTenant: 0 },
    migration: { forwardSafe: true, backwardSafe: true },
    featureFlagKill: { immediate: true },
    journeys: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"].map((id) => ({
      id,
      status: "PASS",
    })),
    unhappyPaths: ["U1", "U2", "U3", "U4", "U5", "U6"].map((id) => ({
      id,
      status: "PASS",
    })),
    findings: [],
    riskAcceptance: { required: true, owner: "release-engineering", reason: "staging only" },
  };
}

test("accepts a complete canary drill record", () => {
  assert.deepEqual(validateCanaryEvidence(evidence(), policy), []);
});

test("rejects a breached stage and a missing unhappy path", () => {
  const record = evidence();
  record.stages[1].withinSlo = false;
  record.stages[1].failures = ["errorRate 0.2 > 0.01"];
  record.unhappyPaths = record.unhappyPaths.filter((row) => row.id !== "U4");
  const errors = validateCanaryEvidence(record, policy);
  assert.ok(errors.some((error) => error.includes("stage 25% breached")));
  assert.ok(errors.some((error) => error.includes("U4 is missing")));
});

test("rejects a failed rollback and an excessive RTO", () => {
  const record = evidence();
  record.rollback.previousVersionServing = false;
  record.rollback.rtoSeconds = 1800;
  record.rollback.alertFired = false;
  const errors = validateCanaryEvidence(record, policy);
  assert.ok(errors.some((error) => error.includes("previous version")));
  assert.ok(errors.some((error) => error.includes("RTO must be under")));
  assert.ok(errors.some((error) => error.includes("alert did not fire")));
});

test("rejects a non-production drill without risk acceptance", () => {
  const record = evidence();
  record.riskAcceptance = { required: false };
  const errors = validateCanaryEvidence(record, policy);
  assert.ok(errors.some((error) => error.includes("riskAcceptance.required=true")));
});

test("rejects a policy drift and tenant leakage", () => {
  const record = evidence();
  record.policy.thresholds.p95LatencyMs = 9999;
  record.tenantIsolation.crossTenant = 1;
  const errors = validateCanaryEvidence(record, policy);
  assert.ok(errors.some((error) => error.includes("does not match")));
  assert.ok(errors.some((error) => error.includes("cross-tenant")));
});
