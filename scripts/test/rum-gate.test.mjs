import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DEFAULT_MAX_REGRESSION_PERCENT,
  evaluateRumGate,
  renderReport,
} from "../release/rum-gate.mjs";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../release/rum-gate.mjs", import.meta.url));

function cohort(release, samples, LCP, INP, CLS) {
  return { release, samples, p75: { LCP, INP, CLS } };
}

const STABLE = cohort("v1.7.0", 1200, 2.1, 140, 0.06);
const IMPROVED = cohort("v1.8.0", 900, 2.0, 130, 0.05);

test("a canary that improved passes", () => {
  const verdict = evaluateRumGate({ stable: STABLE, canary: IMPROVED });

  assert.equal(verdict.pass, true);
  assert.equal(verdict.status, "pass");
  assert.deepEqual(verdict.regressions, []);
});

test("a 30% LCP regression blocks the gate", () => {
  const verdict = evaluateRumGate({
    stable: STABLE,
    canary: cohort("v1.8.0", 900, 2.73, 140, 0.06),
  });

  assert.equal(verdict.pass, false);
  assert.equal(verdict.status, "regression");
  assert.equal(verdict.regressions[0].metric, "LCP");
  assert.equal(verdict.regressions[0].deltaPercent, 30);
});

test("a regression inside the tolerance still passes", () => {
  const verdict = evaluateRumGate({
    stable: STABLE,
    canary: cohort("v1.8.0", 900, 2.2, 140, 0.06),
  });

  assert.equal(verdict.pass, true);
  assert.equal(DEFAULT_MAX_REGRESSION_PERCENT, 10);
});

test("a small sample cannot prove a regression and is reported as a warning", () => {
  const verdict = evaluateRumGate({
    stable: cohort("v1.7.0", 10, 1.5, 100, 0.02),
    canary: cohort("v1.8.0", 8, 9.9, 900, 0.9),
  });

  assert.equal(verdict.pass, true);
  assert.equal(verdict.status, "insufficient-samples");
  assert.match(verdict.warnings[0], /insufficient samples/);
});

test("a missing release label fails instead of comparing apples to oranges", () => {
  const verdict = evaluateRumGate({
    stable: cohort("unknown", 900, 2.1, 140, 0.06),
    canary: IMPROVED,
  });

  assert.equal(verdict.pass, false);
  assert.equal(verdict.status, "release-drift");
});

test("a missing cohort fails closed", () => {
  const verdict = evaluateRumGate({ stable: STABLE });

  assert.equal(verdict.pass, false);
  assert.equal(verdict.status, "invalid-input");
});

test("a metric missing on one cohort is skipped with a warning", () => {
  const verdict = evaluateRumGate({
    stable: { release: "v1.7.0", samples: 500, p75: { LCP: 2.1 } },
    canary: { release: "v1.8.0", samples: 500, p75: { LCP: 2.0 } },
  });

  assert.equal(verdict.pass, true);
  assert.equal(verdict.warnings.length, 2);
});

test("the report names the regression and the verdict", () => {
  const canary = cohort("v1.8.0", 900, 3.0, 140, 0.06);
  const verdict = evaluateRumGate({ stable: STABLE, canary });
  const report = renderReport({
    verdict,
    stable: STABLE,
    canary,
    maxRegressionPercent: DEFAULT_MAX_REGRESSION_PERCENT,
    minSamples: 50,
    generatedAt: "2026-11-25T00:00:00.000Z",
  });

  assert.match(report, /# Real-user release gate/);
  assert.match(report, /Verdict: \*\*fail\*\* \(regression\)/);
  assert.match(report, /\| LCP \| 2.1 \| 3 \| \+42.86% \|/);
});

test("the CLI exits 0 on a pass and 1 on a regression", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rum-gate-"));
  const stablePath = join(dir, "stable.json");
  const canaryPath = join(dir, "canary.json");
  const reportPath = join(dir, "report.md");
  await writeFile(stablePath, JSON.stringify(STABLE), "utf8");
  await writeFile(canaryPath, JSON.stringify(IMPROVED), "utf8");

  const passing = await run(process.execPath, [
    CLI,
    "--stable",
    stablePath,
    "--canary",
    canaryPath,
    "--report",
    reportPath,
  ]);
  assert.match(passing.stdout, /Verdict: \*\*pass\*\*/);
  assert.match(await readFile(reportPath, "utf8"), /Verdict: \*\*pass\*\*/);

  await writeFile(canaryPath, JSON.stringify(cohort("v1.8.0", 900, 3.0, 140, 0.06)), "utf8");
  await assert.rejects(
    run(process.execPath, [CLI, "--stable", stablePath, "--canary", canaryPath]),
    (error) => error.code === 1,
  );
});

test("the CLI prints usage without arguments", async () => {
  const output = await run(process.execPath, [CLI]);
  assert.match(output.stdout, /usage: rum-gate\.mjs/);
});
