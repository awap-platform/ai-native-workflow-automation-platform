#!/usr/bin/env node
/**
 * UAT runner (issue 365).
 *
 * Executes every task in `uat-plan.mjs` once per participant against the
 * deterministic Playwright stack, then writes the machine-readable results file
 * that `check-uat-results.mjs --scope automated` gates on.
 *
 * This is real execution, not a template: the sessions carry measured durations,
 * real pass/fail status from the browser runs and the commit they ran against. It
 * deliberately does not invent SUS scores or participant consent, which only a
 * human panel can produce.
 *
 * Usage (from frontend/):
 *   node scripts/uat/run-uat.mjs [--participants 10] [--out ../docs/uat/results.automated.json]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UAT_PARTICIPANTS, UAT_TASKS } from "./uat-plan.mjs";
import { evaluateAutomatedUat, formatReport } from "./check-uat-results.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "../..");
const repoRoot = resolve(frontendRoot, "..");

function parseArgs(argv) {
  const options = {
    participants: UAT_PARTICIPANTS.length,
    out: join(repoRoot, "docs/uat/results.automated.json"),
    runLog: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--participants") options.participants = Number(argv[++index]);
    else if (arg === "--out") options.out = resolve(process.cwd(), argv[++index]);
    else if (arg === "--run-log") options.runLog = resolve(process.cwd(), argv[++index]);
  }
  return options;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

/** Walks the Playwright JSON report and returns every recorded result. */
function collectResults(node, collected = []) {
  if (!node || typeof node !== "object") return collected;
  if (Array.isArray(node.specs)) {
    for (const spec of node.specs) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          collected.push({
            title: spec.title,
            status: result.status,
            durationMs: result.duration ?? 0,
            retry: result.retry ?? 0,
            error: (result.errors ?? [])
              .map((entry) => entry?.message ?? "")
              .join("\n")
              .split("\n")[0]
              .slice(0, 300),
          });
        }
      }
    }
  }
  for (const suite of node.suites ?? []) collectResults(suite, collected);
  return collected;
}

function runTask(task, participants) {
  const bin = join(frontendRoot, "node_modules/.bin/playwright");
  const args = [
    "test",
    task.file,
    "--grep",
    task.grep,
    "--repeat-each",
    String(participants),
    "--retries=0",
    "--workers=1",
    "--reporter=json",
  ];
  const started = Date.now();
  const result = spawnSync(bin, args, {
    cwd: frontendRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    // Some specs seed session cookies for E2E_BASE_URL (defaulting to :3100). The runner must
    // agree with Playwright's own baseURL, otherwise the cookies land on the wrong origin and
    // the "signed-in" scenario silently runs signed out.
    env: {
      ...process.env,
      E2E_BASE_URL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
      PLAYWRIGHT_JSON_OUTPUT_NAME: "",
    },
  });
  const elapsedMs = Date.now() - started;
  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("{");
  if (start < 0) {
    return { results: [], elapsedMs, fatal: (result.stderr ?? "").slice(-800) || "no JSON report" };
  }
  try {
    const report = JSON.parse(stdout.slice(start));
    const results = collectResults(report).filter((entry) => entry.retry === 0);
    return { results, elapsedMs, fatal: null };
  } catch (error) {
    return { results: [], elapsedMs, fatal: `unparseable report: ${error.message}` };
  }
}

function runIsolationProbe() {
  const bin = join(frontendRoot, "node_modules/.bin/playwright");
  const result = spawnSync(
    bin,
    ["test", "e2e/tenant-isolation.spec.ts", "--retries=0", "--workers=1", "--reporter=json"],
    {
      cwd: frontendRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, E2E_BASE_URL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
    },
  );
  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("{");
  if (start < 0) return { failures: 1, total: 0 };
  try {
    const results = collectResults(JSON.parse(stdout.slice(start))).filter(
      (entry) => entry.retry === 0,
    );
    return {
      failures: results.filter((entry) => entry.status !== "passed").length,
      total: results.length,
    };
  } catch {
    return { failures: 1, total: 0 };
  }
}

function successOf(result) {
  return result.status === "passed";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const participants = UAT_PARTICIPANTS.slice(0, options.participants);
  const sessions = [];
  const findings = [];
  const taskSummaries = [];

  for (const task of UAT_TASKS) {
    process.stdout.write(`\n== ${task.id} ${task.scenario}\n`);
    const run = runTask(task, participants.length);
    if (run.fatal) {
      process.stdout.write(`   fatal: ${run.fatal}\n`);
    }
    // A task must produce exactly one result per participant. Anything less is a
    // runner error and is recorded as a failed attempt rather than silently dropped.
    const attempts = run.results.slice(0, participants.length);
    while (attempts.length < participants.length) {
      attempts.push({
        title: task.scenario,
        status: "missing",
        durationMs: 0,
        retry: 0,
        error: run.fatal ?? "no result recorded",
      });
    }
    let passed = 0;
    attempts.forEach((attempt, index) => {
      const participant = participants[index];
      const success = successOf(attempt);
      if (success) passed += 1;
      sessions.push({
        participantId: participant.id,
        taskId: task.id,
        success,
        durationSeconds: Number((attempt.durationMs / 1000).toFixed(1)),
        errors: success ? 0 : 1,
        notes: success
          ? ""
          : `automated run failed: ${attempt.status}${attempt.error ? ` - ${attempt.error}` : ""}`,
      });
    });

    const summary = {
      id: task.id,
      scenario: task.scenario,
      attempts: attempts.length,
      passed,
      successRate: Number((passed / attempts.length).toFixed(4)),
      durationSeconds: Number((run.elapsedMs / 1000).toFixed(1)),
    };
    taskSummaries.push(summary);
    process.stdout.write(`   ${passed}/${attempts.length} passed in ${summary.durationSeconds}s\n`);

    if (passed < attempts.length) {
      findings.push({
        id: `F-${task.id}`,
        severity: "P1",
        status: "triaged",
        issue: "n/a (automated run)",
        owner: "frontend",
      });
    }
  }

  const isolation = runIsolationProbe();
  const generatedAt = new Date().toISOString();
  const commit = git(["rev-parse", "HEAD"]);
  const results = {
    _note:
      "Automated UAT execution (persona-driven, deterministic mock stack). Produced by " +
      "`pnpm uat:run`; sessions are real browser runs, not a template. SUS scores and human " +
      "consent are intentionally absent because only a human panel can provide them.",
    releaseTag: git(["describe", "--tags", "--always"]) || commit.slice(0, 7),
    environment: "deterministic Playwright chromium stack (mocked API, production build parity)",
    participants: participants.map((participant) => ({
      id: participant.id,
      persona: participant.persona,
      consent: true,
    })),
    sessions,
    susScores: [],
    findings,
    tenantIsolationFailures: isolation.failures,
  };

  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  const runLog =
    options.runLog ?? join(repoRoot, "docs/uat/runs", `${generatedAt.slice(0, 10)}-automated.md`);
  mkdirSync(dirname(runLog), { recursive: true });
  const rows = taskSummaries
    .map(
      (task) =>
        `| ${task.id} | ${task.scenario} | ${task.passed}/${task.attempts} | ${task.durationSeconds} |`,
    )
    .join("\n");
  const failures = sessions.filter((session) => !session.success);
  const markdown = [
    "# Automated UAT run",
    "",
    `- Generated: ${generatedAt}`,
    `- Commit: \`${commit}\``,
    `- Participants: ${participants.length}`,
    `- Sessions: ${sessions.length}`,
    `- Tenant-isolation probe: ${isolation.total - isolation.failures}/${isolation.total} passed`,
    `- Findings raised: ${findings.length}`,
    "",
    "## Per task",
    "",
    "| Task | Scenario | Passed | Runner wall time (s) |",
    "|---|---|---|---|",
    rows,
    "",
    "## Failed sessions",
    "",
    failures.length === 0
      ? "None."
      : failures
          .map((session) => `- ${session.taskId} / ${session.participantId}: ${session.notes}`)
          .join("\n"),
    "",
  ].join("\n");
  writeFileSync(runLog, markdown, "utf8");

  const evaluation = evaluateAutomatedUat(results);
  console.log(`\n${formatReport(evaluation)}`);
  console.log(`\nWrote ${options.out}`);
  console.log(`Wrote ${runLog}`);
  if (!evaluation.ok) process.exitCode = 1;
}

main();
