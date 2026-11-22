#!/usr/bin/env node
/**
 * UAT results gate (issue 365).
 *
 * The 10-task UAT requires real participants, so this script cannot run the sessions.
 * It makes the acceptance criteria executable and impossible to claim accidentally:
 * a results file must show at least ten consented participants, every task executed ten
 * times, a >= 90% success rate, a SUS average >= 80, no open P0 finding and zero
 * cross-tenant observations.
 *
 * Usage: node scripts/uat/check-uat-results.mjs <results.json>
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const UAT_TASK_IDS = Array.from({ length: 10 }, (_, index) => `UAT-${String(index + 1).padStart(2, "0")}`);
export const REQUIRED_PARTICIPANTS = 10;
export const REQUIRED_SUCCESS_RATE = 0.9;
export const REQUIRED_SUS = 80;

function isConsented(participant) {
  return participant?.consent === true;
}

/**
 * Evaluates a parsed UAT results document. Returns every check with its measured value so the
 * report is explicitly evidence-based rather than a pass/fail guess.
 */
export function evaluateUatResults(results) {
  const participants = Array.isArray(results?.participants) ? results.participants : [];
  const sessions = Array.isArray(results?.sessions) ? results.sessions : [];
  const susScores = Array.isArray(results?.susScores) ? results.susScores : [];
  const findings = Array.isArray(results?.findings) ? results.findings : [];

  const consented = participants.filter(isConsented);
  const attemptsByTask = Object.fromEntries(
    UAT_TASK_IDS.map((taskId) => [
      taskId,
      new Set(
        sessions
          .filter((session) => session?.taskId === taskId)
          .map((session) => session?.participantId)
          .filter(Boolean),
      ).size,
    ]),
  );
  const executedSessions = sessions.filter((session) => session?.success === true || session?.success === false);
  const successes = executedSessions.filter((session) => session?.success === true).length;
  const successRate = executedSessions.length === 0 ? 0 : successes / executedSessions.length;
  const susAverage =
    susScores.length === 0
      ? 0
      : susScores.reduce((sum, entry) => sum + Number(entry?.score ?? 0), 0) / susScores.length;
  const openP0 = findings.filter(
    (finding) => finding?.severity === "P0" && finding?.status !== "closed",
  );

  const checks = [
    {
      id: "participants",
      description: `>= ${REQUIRED_PARTICIPANTS} consented participants`,
      actual: consented.length,
      ok: consented.length >= REQUIRED_PARTICIPANTS,
    },
    {
      id: "task-coverage",
      description: "every task executed by at least ten distinct participants",
      actual: attemptsByTask,
      ok: UAT_TASK_IDS.every((taskId) => attemptsByTask[taskId] >= REQUIRED_PARTICIPANTS),
    },
    {
      id: "success-rate",
      description: `>= ${Math.round(REQUIRED_SUCCESS_RATE * 100)}% task success`,
      actual: Number(successRate.toFixed(4)),
      ok: successRate >= REQUIRED_SUCCESS_RATE,
    },
    {
      id: "sus",
      description: `SUS average >= ${REQUIRED_SUS}`,
      actual: Number(susAverage.toFixed(2)),
      ok: susAverage >= REQUIRED_SUS,
    },
    {
      id: "open-p0",
      description: "no open P0 finding",
      actual: openP0.map((finding) => finding.id ?? "unnamed"),
      ok: openP0.length === 0,
    },
    {
      id: "tenant-isolation",
      description: "zero cross-tenant observations",
      actual: Number(results?.tenantIsolationFailures ?? 0),
      ok: Number(results?.tenantIsolationFailures ?? 0) === 0,
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
    summary: {
      participants: participants.length,
      consentedParticipants: consented.length,
      sessions: executedSessions.length,
      successes,
      successRate: Number(successRate.toFixed(4)),
      susAverage: Number(susAverage.toFixed(2)),
      openP0: openP0.length,
    },
  };
}

export function formatReport(result) {
  const lines = ["UAT results gate:"];
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.description} -> ${JSON.stringify(check.actual)}`);
  }
  lines.push(`Summary: ${JSON.stringify(result.summary)}`);
  return lines.join("\n");
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/uat/check-uat-results.mjs <results.json>");
    process.exitCode = 2;
    return;
  }
  const resolved = target.startsWith("/") ? target : join(process.cwd(), target);
  const result = evaluateUatResults(JSON.parse(readFileSync(resolved, "utf8")));
  console.log(formatReport(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
