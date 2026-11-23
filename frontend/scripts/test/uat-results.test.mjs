import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateUatResults, UAT_TASK_IDS } from "../uat/check-uat-results.mjs";

function participants(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${index + 1}`,
    persona: ["approver", "operations", "tenant-admin", "employee"][index % 4],
    consent: true,
  }));
}

function sessions({ success = true } = {}) {
  return participants().flatMap((participant) =>
    UAT_TASK_IDS.map((taskId) => ({
      participantId: participant.id,
      taskId,
      success,
      durationSeconds: 70,
      errors: 0,
    })),
  );
}

function results(overrides = {}) {
  return {
    releaseTag: "v1.7.0-rc.1",
    environment: "staging",
    participants: participants(),
    sessions: sessions(),
    susScores: participants().map((participant) => ({ participantId: participant.id, score: 88 })),
    findings: [],
    tenantIsolationFailures: 0,
    ...overrides,
  };
}

test("passes when every acceptance threshold is met", () => {
  const evaluation = evaluateUatResults(results());
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.summary.successRate, 1);
  assert.equal(evaluation.summary.susAverage, 88);
});

test("fails when fewer than ten participants consented", () => {
  const rows = results({ participants: participants(9) });
  const evaluation = evaluateUatResults(rows);
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.checks.find((check) => check.id === "participants").ok, false);
});

test("fails when a task was not executed by every participant", () => {
  const rows = results({
    sessions: sessions().filter((session) => session.taskId !== "UAT-07" || session.participantId !== "P10"),
  });
  const evaluation = evaluateUatResults(rows);
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.checks.find((check) => check.id === "task-coverage").ok, false);
});

test("fails below a 90% success rate", () => {
  const all = sessions();
  const failing = all.map((session, index) => (index < 11 ? { ...session, success: false } : session));
  const evaluation = evaluateUatResults(results({ sessions: failing }));
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.checks.find((check) => check.id === "success-rate").ok, false);
});

test("fails when SUS is below 80", () => {
  const evaluation = evaluateUatResults(
    results({
      susScores: participants().map((participant) => ({ participantId: participant.id, score: 70 })),
    }),
  );
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.checks.find((check) => check.id === "sus").ok, false);
});

test("fails on an open P0 finding or a cross-tenant observation", () => {
  const evaluation = evaluateUatResults(
    results({
      findings: [{ id: "F1", severity: "P0", status: "open", issue: "#1", owner: "team" }],
      tenantIsolationFailures: 1,
    }),
  );
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.checks.find((check) => check.id === "open-p0").ok, false);
  assert.equal(evaluation.checks.find((check) => check.id === "tenant-isolation").ok, false);
});
