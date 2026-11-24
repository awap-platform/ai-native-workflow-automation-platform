#!/usr/bin/env node
/**
 * Release gate for the canary/rollback drill evidence (issue #367).
 *
 * The checker is intentionally independent of the drill runner: it only reads
 * the committed evidence and the policy, so a hand-edited or partial drill
 * record cannot pass.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DEFAULT_EVIDENCE = join(ROOT, "docs/release/evidence/canary-drill.json");
const POLICY = join(ROOT, "infra/release/canary-policy.json");

const JOURNEYS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
const UNHAPPY = ["U1", "U2", "U3", "U4", "U5", "U6"];
const RTO_LIMIT_SECONDS = 30 * 60;
const AUTO_ROLLBACK_LIMIT_SECONDS = 5 * 60;

function ids(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((row) => row?.id));
}

export function validateCanaryEvidence(evidence, policy) {
  const errors = [];
  if (evidence?.issue !== 367) {
    errors.push("issue must be 367");
  }
  if (typeof evidence?.executedAt !== "string" || Number.isNaN(Date.parse(evidence.executedAt))) {
    errors.push("executedAt must be a timestamp");
  }
  if (evidence?.liveProduction === false) {
    if (!evidence?.riskAcceptance || evidence.riskAcceptance.required !== true) {
      errors.push("a non-production drill must carry riskAcceptance.required=true");
    }
  }
  if (evidence?.riskAcceptance?.required === true) {
    for (const key of ["owner", "reason"]) {
      if (
        typeof evidence.riskAcceptance[key] !== "string" ||
        evidence.riskAcceptance[key].trim() === ""
      ) {
        errors.push(`riskAcceptance is missing ${key}`);
      }
    }
  }

  const expectedStages = policy?.stages ?? [];
  const stages = Array.isArray(evidence?.stages) ? evidence.stages : [];
  if (JSON.stringify(stages.map((stage) => stage.percent)) !== JSON.stringify(expectedStages)) {
    errors.push(`stages must follow the policy: ${expectedStages.join(" -> ")}`);
  }
  for (const stage of stages) {
    if (stage.withinSlo !== true) {
      errors.push(`stage ${stage.percent}% breached its SLO: ${(stage.failures ?? []).join("; ")}`);
    }
    if (!(stage.requests > 0)) {
      errors.push(`stage ${stage.percent}% has no observed requests`);
    }
  }
  if (evidence?.promotion?.completed !== true) {
    errors.push("promotion did not complete all policy stages");
  }

  const rollback = evidence?.rollback ?? {};
  if (rollback.auto !== true) {
    errors.push("rollback.auto must be true");
  }
  if (rollback.alertFired !== true) {
    errors.push("the rollback alert did not fire");
  }
  if (rollback.previousVersionServing !== true) {
    errors.push("the previous version was not serving after rollback");
  }
  if (!(rollback.rtoSeconds >= 0 && rollback.rtoSeconds < RTO_LIMIT_SECONDS)) {
    errors.push(`RTO must be under ${RTO_LIMIT_SECONDS}s (received ${rollback.rtoSeconds})`);
  }
  if (!(rollback.detectedAfterMs >= 0 && rollback.detectedAfterMs < AUTO_ROLLBACK_LIMIT_SECONDS * 1000)) {
    errors.push(`automatic detection must be under ${AUTO_ROLLBACK_LIMIT_SECONDS}s`);
  }

  if (evidence?.tenantIsolation?.crossTenant !== 0) {
    errors.push("cross-tenant responses were observed");
  }
  if (evidence?.migration?.forwardSafe !== true || evidence?.migration?.backwardSafe !== true) {
    errors.push("the migration must be forward and backward safe");
  }
  if (evidence?.featureFlagKill?.immediate !== true) {
    errors.push("the feature-flag kill switch was not immediate");
  }

  const journeyIds = ids(evidence?.journeys);
  for (const id of JOURNEYS) {
    const row = (evidence?.journeys ?? []).find((entry) => entry?.id === id);
    if (!journeyIds.has(id) || row?.status !== "PASS") {
      errors.push(`${id} is missing or not PASS`);
    }
  }
  const unhappyIds = ids(evidence?.unhappyPaths);
  for (const id of UNHAPPY) {
    const row = (evidence?.unhappyPaths ?? []).find((entry) => entry?.id === id);
    if (!unhappyIds.has(id) || row?.status !== "PASS") {
      errors.push(`${id} is missing or not PASS`);
    }
  }

  if (!Array.isArray(evidence?.findings) || evidence.findings.length > 0) {
    errors.push("findings must be an empty array");
  }

  const thresholds = policy?.thresholds ?? {};
  const recorded = evidence?.policy?.thresholds ?? {};
  for (const key of ["errorRate", "p95LatencyMs"]) {
    if (recorded[key] !== thresholds[key]) {
      errors.push(`policy threshold ${key} does not match infra/release/canary-policy.json`);
    }
  }
  return errors;
}

export function runCheck(evidencePath = DEFAULT_EVIDENCE) {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const policy = JSON.parse(readFileSync(POLICY, "utf8"));
  return { evidencePath, errors: validateCanaryEvidence(evidence, policy) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { evidencePath, errors } = runCheck(process.argv[2]);
    if (errors.length > 0) {
      console.error(`Canary drill evidence failed (${evidencePath}):`);
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
    console.log(`Canary drill evidence is complete and releasable: ${evidencePath}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
