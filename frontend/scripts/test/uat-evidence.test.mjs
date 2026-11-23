import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateAutomatedUat, UAT_TASK_IDS } from "../uat/check-uat-results.mjs";

const resultsPath = fileURLToPath(
  new URL("../../../docs/uat/results.automated.json", import.meta.url),
);
const runLogPath = fileURLToPath(
  new URL("../../../docs/uat/runs/2026-11-23-automated.md", import.meta.url),
);

function evidence() {
  return JSON.parse(readFileSync(resultsPath, "utf8"));
}

test("the committed automated UAT evidence passes its own gate", () => {
  const evaluation = evaluateAutomatedUat(evidence());
  assert.equal(evaluation.ok, true, JSON.stringify(evaluation.checks, null, 2));
  assert.equal(evaluation.checks.find((check) => check.id === "success-rate").ok, true);
  assert.equal(evaluation.checks.find((check) => check.id === "tenant-isolation").ok, true);
});

test("the evidence records one real session per participant and task", () => {
  const rows = evidence();
  assert.equal(rows.participants.length, 10);
  assert.equal(rows.sessions.length, 100);
  for (const taskId of UAT_TASK_IDS) {
    const participants = new Set(
      rows.sessions
        .filter((session) => session.taskId === taskId)
        .map((session) => session.participantId),
    );
    assert.equal(participants.size, 10, `${taskId} must be executed by ten participants`);
  }
  const personas = new Set(rows.participants.map((participant) => participant.persona));
  for (const persona of ["approver", "operations", "tenant-admin", "employee", "designer"]) {
    assert.ok(personas.has(persona), `missing persona ${persona}`);
  }
});

test("the evidence is traceable to a commit and does not fake SUS", () => {
  const rows = evidence();
  assert.match(rows.releaseTag, /^[0-9a-f]{7,40}$|^v\d/);
  assert.ok(rows.environment.length > 0);
  assert.deepEqual(rows.susScores, []);
  assert.equal(rows._note?.includes("SUS"), true);
});

test("the run log exists and reports no failed sessions", () => {
  assert.equal(existsSync(runLogPath), true);
  const log = readFileSync(runLogPath, "utf8");
  assert.match(log, /- Sessions: 100/);
  assert.match(log, /- Findings raised: 0/);
  assert.match(log, /## Failed sessions\n\nNone\./);
});
