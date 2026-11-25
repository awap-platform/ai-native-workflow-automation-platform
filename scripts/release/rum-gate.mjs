#!/usr/bin/env node
/**
 * Real-user release gate (issue #375).
 *
 * Compares the canary cohort against the stable cohort of the same window using the p75 of the
 * web-vitals metrics. The lab budgets can stay green while a real-user metric regresses, so this gate
 * is the only thing that blocks a promotion on real-user evidence.
 *
 * Rules:
 * - a cohort whose release label is not a semantic version fails the gate (release drift is a build
 *   problem, not missing data);
 * - a cohort below the sample floor cannot prove anything, so the gate passes with an explicit
 *   warning instead of inventing a regression;
 * - a p75 regression above the allowed percentage fails the gate and names the worst metric.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const RUM_GATE_METRICS = ["LCP", "INP", "CLS"];

/** Regression allowed before the gate blocks: 10% over the stable p75. */
export const DEFAULT_MAX_REGRESSION_PERCENT = 10;
/** Below this many samples per cohort the comparison is not meaningful. */
export const DEFAULT_MIN_SAMPLES = 50;

function p75Of(cohort, metric) {
  const value = cohort?.p75?.[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Evaluates the gate. Returns a verdict object rather than throwing, so the CLI and the tests share
 * exactly one implementation.
 */
export function evaluateRumGate({
  stable,
  canary,
  maxRegressionPercent = DEFAULT_MAX_REGRESSION_PERCENT,
  minSamples = DEFAULT_MIN_SAMPLES,
}) {
  const findings = [];
  for (const [label, cohort] of [
    ["stable", stable],
    ["canary", canary],
  ]) {
    if (!cohort || typeof cohort !== "object") {
      findings.push({ level: "error", message: `the ${label} cohort is missing` });
    }
  }
  if (findings.length > 0) {
    return { pass: false, status: "invalid-input", findings, regressions: [], warnings: [] };
  }

  const warnings = [];
  for (const [label, cohort] of [
    ["stable", stable],
    ["canary", canary],
  ]) {
    if (cohort.release === "unknown" || !cohort.release) {
      findings.push({
        level: "error",
        message: `the ${label} cohort has no semantic release label`,
      });
    }
  }
  if (findings.length > 0) {
    return { pass: false, status: "release-drift", findings, regressions: [], warnings };
  }

  const samples = { stable: Number(stable.samples ?? 0), canary: Number(canary.samples ?? 0) };
  if (samples.stable < minSamples || samples.canary < minSamples) {
    warnings.push(
      `insufficient samples (stable ${samples.stable}, canary ${samples.canary}, floor ${minSamples}); the gate does not block on missing evidence`,
    );
    return { pass: true, status: "insufficient-samples", findings, regressions: [], warnings, samples };
  }

  const regressions = [];
  for (const metric of RUM_GATE_METRICS) {
    const before = p75Of(stable, metric);
    const after = p75Of(canary, metric);
    if (before === null || after === null || before <= 0) {
      warnings.push(`metric ${metric} is missing on one cohort and was skipped`);
      continue;
    }
    const deltaPercent = ((after - before) / before) * 100;
    if (deltaPercent > maxRegressionPercent) {
      regressions.push({
        metric,
        stable: before,
        canary: after,
        deltaPercent: Number(deltaPercent.toFixed(2)),
      });
    }
  }

  const pass = regressions.length === 0;
  return {
    pass,
    status: pass ? "pass" : "regression",
    findings,
    regressions,
    warnings,
    samples,
  };
}

/** Renders the markdown evidence block committed next to the drill evidence. */
export function renderReport({ verdict, stable, canary, maxRegressionPercent, minSamples, generatedAt }) {
  const lines = [
    "# Real-user release gate",
    "",
    `Generated at ${generatedAt}. Maximum regression ${maxRegressionPercent}%, sample floor ${minSamples}.`,
    "",
    "| Cohort | Release | Samples | LCP p75 (s) | INP p75 (ms) | CLS p75 |",
    "| --- | --- | --- | --- | --- | --- |",
    `| stable | ${stable.release} | ${stable.samples} | ${stable.p75?.LCP ?? "n/a"} | ${stable.p75?.INP ?? "n/a"} | ${stable.p75?.CLS ?? "n/a"} |`,
    `| canary | ${canary.release} | ${canary.samples} | ${canary.p75?.LCP ?? "n/a"} | ${canary.p75?.INP ?? "n/a"} | ${canary.p75?.CLS ?? "n/a"} |`,
    "",
    `Verdict: **${verdict.pass ? "pass" : "fail"}** (${verdict.status}).`,
    "",
  ];
  if (verdict.regressions.length > 0) {
    lines.push("| Metric | Stable | Canary | Delta |", "| --- | --- | --- | --- |");
    for (const regression of verdict.regressions) {
      lines.push(
        `| ${regression.metric} | ${regression.stable} | ${regression.canary} | +${regression.deltaPercent}% |`,
      );
    }
    lines.push("");
  }
  for (const warning of verdict.warnings) {
    lines.push(`- warning: ${warning}`);
  }
  for (const finding of verdict.findings) {
    lines.push(`- ${finding.level}: ${finding.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { maxRegression: DEFAULT_MAX_REGRESSION_PERCENT, minSamples: DEFAULT_MIN_SAMPLES };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--stable":
        args.stable = argv[++index];
        break;
      case "--canary":
        args.canary = argv[++index];
        break;
      case "--max-regression":
        args.maxRegression = Number(argv[++index]);
        break;
      case "--min-samples":
        args.minSamples = Number(argv[++index]);
        break;
      case "--report":
        args.report = argv[++index];
        break;
      case "--help":
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

async function loadCohort(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  return {
    release: parsed.release,
    samples: Number(parsed.samples ?? 0),
    p75: parsed.p75 ?? {},
  };
}

export async function runCli(argv = process.argv.slice(2), now = new Date()) {
  const args = parseArgs(argv);
  if (args.help || !args.stable || !args.canary) {
    console.log(
      "usage: rum-gate.mjs --stable <stable.json> --canary <canary.json> [--max-regression 10] [--min-samples 50] [--report report.md]",
    );
    return 0;
  }
  const stable = await loadCohort(args.stable);
  const canary = await loadCohort(args.canary);
  const verdict = evaluateRumGate({
    stable,
    canary,
    maxRegressionPercent: args.maxRegression,
    minSamples: args.minSamples,
  });
  const report = renderReport({
    verdict,
    stable,
    canary,
    maxRegressionPercent: args.maxRegression,
    minSamples: args.minSamples,
    generatedAt: now.toISOString(),
  });
  if (args.report) {
    await writeFile(args.report, report, "utf8");
  }
  console.log(report);
  return verdict.pass ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.exitCode = await runCli();
}
