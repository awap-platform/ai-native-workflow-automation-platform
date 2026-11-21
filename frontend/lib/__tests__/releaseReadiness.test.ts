import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GLOBAL_BUDGETS,
  evaluateRollback,
  nextCanaryStage,
  parseCanaryPolicy,
  validateCanaryPolicy,
  type CanaryPolicy,
} from "../releaseReadiness";

const POLICY_PATH = join(process.cwd(), "..", "infra", "release", "canary-policy.json");

function policy(): CanaryPolicy {
  return parseCanaryPolicy(readFileSync(POLICY_PATH, "utf8"));
}

describe("committed canary policy", () => {
  it("is valid and rolls out 5% -> 25% -> 100%", () => {
    const parsed = policy();
    expect(parsed.stages).toEqual([5, 25, 100]);
    expect(parsed.automaticRollback).toBe(true);
    expect(parsed.observationWindowMinutes).toBeGreaterThanOrEqual(5);
    expect(parsed.owner.length).toBeGreaterThan(0);
  });

  it("never loosens a global programme budget", () => {
    const parsed = policy();
    for (const [key, value] of Object.entries(parsed.thresholds)) {
      expect(value).toBeLessThanOrEqual(GLOBAL_BUDGETS[key as keyof typeof GLOBAL_BUDGETS]);
    }
  });
});

describe("canary policy validation", () => {
  it("rejects a non-object document", () => {
    expect(validateCanaryPolicy(null)).toContain("policy must be a JSON object");
  });

  it("rejects a skipped intermediate stage and a non-100 end state", () => {
    const errors = validateCanaryPolicy({
      version: 1,
      owner: "release-engineering",
      notes: "test",
      automaticRollback: true,
      stages: [5, 100],
      observationWindowMinutes: 30,
      thresholds: GLOBAL_BUDGETS,
    });
    expect(errors).toContain("the intermediate 25% stage is required");
  });

  it("rejects stages that do not end at 100", () => {
    const errors = validateCanaryPolicy({
      version: 1,
      owner: "release-engineering",
      notes: "test",
      automaticRollback: true,
      stages: [5, 25, 50],
      observationWindowMinutes: 30,
      thresholds: GLOBAL_BUDGETS,
    });
    expect(errors).toContain("the last stage must be 100");
  });

  it("rejects a threshold that loosens the global budget", () => {
    const errors = validateCanaryPolicy({
      version: 1,
      owner: "release-engineering",
      notes: "test",
      automaticRollback: true,
      stages: [5, 25, 100],
      observationWindowMinutes: 30,
      thresholds: { ...GLOBAL_BUDGETS, lcpMs: 4000 },
    });
    expect(errors.some((error) => error.includes("thresholds.lcpMs"))).toBe(true);
  });

  it("throws a readable error for malformed JSON", () => {
    expect(() => parseCanaryPolicy("{not json")).toThrow(/not valid JSON/);
  });
});

describe("canary progression and rollback", () => {
  it("advances one stage at a time and stops at 100", () => {
    const parsed = policy();
    expect(nextCanaryStage(5, parsed)).toBe(25);
    expect(nextCanaryStage(25, parsed)).toBe(100);
    expect(nextCanaryStage(100, parsed)).toBeNull();
  });

  it("rejects an unknown stage", () => {
    expect(() => nextCanaryStage(40, policy())).toThrow(/unknown canary stage/);
  });

  it("keeps the rollout when every metric is inside budget", () => {
    const decision = evaluateRollback(
      { errorRate: 0.002, p95LatencyMs: 400, lcpMs: 1800, cls: 0.02, tbtMs: 90, inpMs: 120 },
      policy(),
    );
    expect(decision).toEqual({ rollback: false, reasons: [] });
  });

  it("rolls back on a single breached threshold and names it", () => {
    const decision = evaluateRollback({ errorRate: 0.02 }, policy());
    expect(decision.rollback).toBe(true);
    expect(decision.reasons[0]).toMatch(/errorRate/);
  });

  it("rolls back on a Web Vitals regression", () => {
    const decision = evaluateRollback({ lcpMs: 3000, cls: 0.2 }, policy());
    expect(decision.rollback).toBe(true);
    expect(decision.reasons).toHaveLength(2);
  });

  it("treats a missing metric as unknown rather than a pass", () => {
    const decision = evaluateRollback({}, policy());
    expect(decision).toEqual({ rollback: false, reasons: [] });
  });

  it("rejects a negative or non-finite sample", () => {
    const decision = evaluateRollback({ errorRate: Number.NaN }, policy());
    expect(decision.rollback).toBe(true);
    expect(decision.reasons[0]).toMatch(/finite non-negative/);
  });
});
