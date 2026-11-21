/**
 * Canary and rollback policy (UI/UX phase 10).
 *
 * The policy file [`infra/release/canary-policy.json`](../../infra/release/canary-policy.json)
 * is the single source of truth for the rollout stages (5% → 25% → 100%), the
 * observation window and the automatic-rollback thresholds. This module parses
 * and validates that file and evaluates a live metric sample against it. It does
 * not deploy anything: the release workflow and the on-call runbook consume the
 * same values, so a documented threshold cannot drift from the code.
 */

export interface RollbackThresholds {
  /** Fraction of failed requests (0.01 = 1%). */
  errorRate: number;
  /** p95 server response latency in milliseconds. */
  p95LatencyMs: number;
  /** Largest Contentful Paint budget in milliseconds. */
  lcpMs: number;
  /** Cumulative Layout Shift budget. */
  cls: number;
  /** Total Blocking Time budget in milliseconds. */
  tbtMs: number;
  /** Interaction to Next Paint target in milliseconds. */
  inpMs: number;
}

export interface CanaryPolicy {
  version: number;
  owner: string;
  /** Traffic percentages in ascending order; the last stage must be 100. */
  stages: number[];
  observationWindowMinutes: number;
  automaticRollback: boolean;
  thresholds: RollbackThresholds;
  notes: string;
}

export interface ReleaseMetricSample {
  errorRate?: number;
  p95LatencyMs?: number;
  lcpMs?: number;
  cls?: number;
  tbtMs?: number;
  inpMs?: number;
}

export interface RollbackDecision {
  rollback: boolean;
  reasons: string[];
}

const REQUIRED_THRESHOLD_KEYS: Array<keyof RollbackThresholds> = [
  "errorRate",
  "p95LatencyMs",
  "lcpMs",
  "cls",
  "tbtMs",
  "inpMs",
];

/** Global programme budgets that the canary policy may tighten but never loosen. */
export const GLOBAL_BUDGETS: Readonly<RollbackThresholds> = {
  errorRate: 0.01,
  p95LatencyMs: 2000,
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 200,
  inpMs: 200,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns every validation error in a candidate policy (empty means valid). */
export function validateCanaryPolicy(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["policy must be a JSON object"];
  }

  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    errors.push("version must be a positive integer");
  }
  if (typeof value.owner !== "string" || value.owner.trim().length === 0) {
    errors.push("owner is required");
  }
  if (typeof value.notes !== "string" || value.notes.trim().length === 0) {
    errors.push("notes are required");
  }
  if (typeof value.automaticRollback !== "boolean") {
    errors.push("automaticRollback must be a boolean");
  }

  const stages = value.stages;
  if (!Array.isArray(stages) || stages.length < 2) {
    errors.push("stages must list at least two traffic percentages");
  } else {
    const numeric = stages.filter(
      (stage): stage is number => typeof stage === "number" && Number.isFinite(stage),
    );
    if (numeric.length !== stages.length) {
      errors.push("every stage must be a number");
    }
    if (numeric[0] !== 5) {
      errors.push("the first stage must be 5");
    }
    if (numeric[numeric.length - 1] !== 100) {
      errors.push("the last stage must be 100");
    }
    for (let index = 1; index < numeric.length; index += 1) {
      if (numeric[index]! <= numeric[index - 1]!) {
        errors.push("stages must be strictly ascending");
        break;
      }
    }
    if (!numeric.includes(25)) {
      errors.push("the intermediate 25% stage is required");
    }
  }

  if (
    typeof value.observationWindowMinutes !== "number" ||
    !Number.isFinite(value.observationWindowMinutes) ||
    value.observationWindowMinutes < 5
  ) {
    errors.push("observationWindowMinutes must be at least 5");
  }

  if (!isRecord(value.thresholds)) {
    errors.push("thresholds are required");
  } else {
    for (const key of REQUIRED_THRESHOLD_KEYS) {
      const threshold = value.thresholds[key];
      if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
        errors.push(`thresholds.${key} must be a positive number`);
        continue;
      }
      if (threshold > GLOBAL_BUDGETS[key]) {
        errors.push(
          `thresholds.${key} (${threshold}) must not exceed the global budget (${GLOBAL_BUDGETS[key]})`,
        );
      }
    }
  }

  return errors;
}

/** Parses and validates a policy document; throws on any problem. */
export function parseCanaryPolicy(json: string): CanaryPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("canary policy is not valid JSON");
  }
  const errors = validateCanaryPolicy(parsed);
  if (errors.length > 0) {
    throw new Error(`invalid canary policy: ${errors.join("; ")}`);
  }
  return parsed as CanaryPolicy;
}

/** The next traffic stage, or null when 100% has been reached. */
export function nextCanaryStage(
  current: number,
  policy: Pick<CanaryPolicy, "stages">,
): number | null {
  const index = policy.stages.indexOf(current);
  if (index < 0) {
    throw new Error(`unknown canary stage: ${current}`);
  }
  return policy.stages[index + 1] ?? null;
}

/**
 * Evaluates a live metric sample. Every provided metric is compared against the
 * policy threshold; one breach is enough to recommend an automatic rollback.
 */
export function evaluateRollback(
  sample: ReleaseMetricSample,
  policy: Pick<CanaryPolicy, "thresholds"> = { thresholds: GLOBAL_BUDGETS },
): RollbackDecision {
  const reasons: string[] = [];
  const thresholds = policy.thresholds;

  for (const key of REQUIRED_THRESHOLD_KEYS) {
    const value = sample[key];
    if (value === undefined) {
      continue;
    }
    if (!Number.isFinite(value) || value < 0) {
      reasons.push(`${key} is not a finite non-negative number`);
      continue;
    }
    if (value > thresholds[key]) {
      reasons.push(`${key} ${value} exceeds ${thresholds[key]}`);
    }
  }

  return { rollback: reasons.length > 0, reasons };
}
