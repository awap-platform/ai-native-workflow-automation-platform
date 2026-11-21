#!/usr/bin/env node
/**
 * Release-readiness configuration gate (UI/UX phase 10).
 *
 * Validates the machine-readable pieces that the release process depends on:
 *
 * - `infra/release/canary-policy.json` (5% -> 25% -> 100%, thresholds within the
 *   global programme budgets, owner and notes present);
 * - the feature-flag registry in `frontend/lib/featureFlags.ts` (owner, expiry,
 *   no expired flag on the day the gate runs);
 * - every Kubernetes overlay exposing the phase-10 flags;
 * - the runbook anchors the policy and Prometheus alerts link to.
 *
 * Usage: node scripts/check-release-policy.mjs [--now <iso>]
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const GLOBAL_BUDGETS = {
  errorRate: 0.01,
  p95LatencyMs: 2000,
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 200,
  inpMs: 200,
};

const THRESHOLD_KEYS = Object.keys(GLOBAL_BUDGETS);

const REQUIRED_FLAGS = ["FEATURE_AI_COPILOT", "FEATURE_IN_APP_TOUR", "FEATURE_RUM"];

const OVERLAYS = ["dev", "staging", "prod"];

/** Validates the canary policy document; returns human-readable errors. */
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["policy must be a JSON object"];
  }
  if (!Number.isInteger(policy.version) || policy.version < 1) {
    errors.push("version must be a positive integer");
  }
  if (typeof policy.owner !== "string" || policy.owner.trim() === "") {
    errors.push("owner is required");
  }
  if (typeof policy.notes !== "string" || policy.notes.trim() === "") {
    errors.push("notes are required");
  }
  if (typeof policy.automaticRollback !== "boolean") {
    errors.push("automaticRollback must be a boolean");
  }
  if (!Array.isArray(policy.stages) || policy.stages.length < 2) {
    errors.push("stages must list at least two traffic percentages");
  } else {
    const stages = policy.stages;
    if (stages[0] !== 5) {
      errors.push("the first stage must be 5");
    }
    if (stages[stages.length - 1] !== 100) {
      errors.push("the last stage must be 100");
    }
    if (!stages.includes(25)) {
      errors.push("the intermediate 25% stage is required");
    }
    for (let index = 1; index < stages.length; index += 1) {
      if (!(stages[index] > stages[index - 1])) {
        errors.push("stages must be strictly ascending");
        break;
      }
    }
  }
  if (!Number.isFinite(policy.observationWindowMinutes) || policy.observationWindowMinutes < 5) {
    errors.push("observationWindowMinutes must be at least 5");
  }
  if (!policy.thresholds || typeof policy.thresholds !== "object") {
    errors.push("thresholds are required");
  } else {
    for (const key of THRESHOLD_KEYS) {
      const value = policy.thresholds[key];
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`thresholds.${key} must be a positive number`);
      } else if (value > GLOBAL_BUDGETS[key]) {
        errors.push(
          `thresholds.${key} (${value}) must not exceed the global budget (${GLOBAL_BUDGETS[key]})`,
        );
      }
    }
  }
  return errors;
}

/**
 * Extracts flag metadata from the TypeScript registry with a narrow, ordered
 * pattern (id -> envVar -> owner -> expiresAt). The registry is the source of
 * truth; this mirror only lets a plain Node gate see it without a TS runtime.
 */
export function parseFlagRegistry(source) {
  const pattern =
    /id:\s*"([^"]+)",\s*envVar:\s*"([^"]+)",\s*owner:\s*"([^"]+)",\s*expiresAt:\s*"([^"]+)"/g;
  const flags = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    flags.push({ id: match[1], envVar: match[2], owner: match[3], expiresAt: match[4] });
  }
  return flags;
}

/** Flags that are expired at `now`, or malformed. */
export function staleFlags(flags, now) {
  const errors = [];
  if (flags.length === 0) {
    errors.push("no feature flags were parsed from the registry");
    return errors;
  }
  for (const flag of flags) {
    if (!flag.owner.trim()) {
      errors.push(`${flag.id} has no owner`);
    }
    if (!flag.envVar.startsWith("FEATURE_")) {
      errors.push(`${flag.id} env var must start with FEATURE_`);
    }
    const expiry = new Date(flag.expiresAt).getTime();
    if (Number.isNaN(expiry)) {
      errors.push(`${flag.id} has an invalid expiry`);
    } else if (expiry <= now.getTime()) {
      errors.push(`${flag.id} expired at ${flag.expiresAt}; remove it or renew the registry entry`);
    }
  }
  return errors;
}

/** Each overlay must expose the phase-10 flags the documentation refers to. */
export function checkOverlay(text, environment) {
  const errors = [];
  for (const flag of REQUIRED_FLAGS) {
    if (!new RegExp(`^\\s*-\\s*${flag}=`, "m").test(text)) {
      errors.push(`${environment} overlay is missing ${flag}`);
    }
  }
  return errors;
}

/** The rollback procedure and its RTO must be documented where alerts point. */
export function checkRunbooks({ operationsRunbook, releaseRunbook }) {
  const errors = [];
  if (!operationsRunbook.includes("## O35 — Release guard and rollback")) {
    errors.push("operations runbook is missing the O12 release-guard section");
  }
  if (!operationsRunbook.includes("rollback")) {
    errors.push("operations runbook does not describe the rollback path");
  }
  if (!releaseRunbook.includes("Canary")) {
    errors.push("release runbook is missing the canary section");
  }
  if (!releaseRunbook.includes("RTO")) {
    errors.push("release runbook does not state the recovery time objective");
  }
  if (!releaseRunbook.includes("drill")) {
    errors.push("release runbook is missing the rollback drill");
  }
  return errors;
}

/** Reads every input and returns the complete error list. */
export function runChecks({ now = new Date() } = {}) {
  const errors = [];
  let policy;
  try {
    policy = JSON.parse(readFileSync(join(ROOT, "infra/release/canary-policy.json"), "utf8"));
  } catch (error) {
    return [`cannot read infra/release/canary-policy.json: ${error.message}`];
  }
  errors.push(...validatePolicy(policy).map((error) => `canary-policy: ${error}`));

  const registry = readFileSync(join(ROOT, "frontend/lib/featureFlags.ts"), "utf8");
  errors.push(...staleFlags(parseFlagRegistry(registry), now));

  for (const environment of OVERLAYS) {
    const overlay = readFileSync(
      join(ROOT, `infra/k8s/overlays/${environment}/kustomization.yaml`),
      "utf8",
    );
    errors.push(...checkOverlay(overlay, environment));
  }

  errors.push(
    ...checkRunbooks({
      operationsRunbook: readFileSync(join(ROOT, "docs/operations-runbook.md"), "utf8"),
      releaseRunbook: readFileSync(join(ROOT, "docs/release-runbook.md"), "utf8"),
    }),
  );

  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const nowArgument = process.argv.indexOf("--now");
  const now = nowArgument > -1 ? new Date(process.argv[nowArgument + 1]) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error("check-release-policy: --now must be an ISO date");
    process.exit(1);
  }
  const errors = runChecks({ now });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`release-policy: ${error}`);
    }
    process.exit(1);
  }
  console.log("release-policy: canary stages, thresholds, feature flags and runbooks are consistent");
}
