import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GLOBAL_BUDGETS,
  checkOverlay,
  checkRunbooks,
  parseFlagRegistry,
  staleFlags,
  validatePolicy,
} from "../check-release-policy.mjs";

const NOW = new Date("2026-11-21T00:00:00.000Z");

function validPolicy(overrides = {}) {
  return {
    version: 1,
    owner: "release-engineering",
    notes: "test policy",
    automaticRollback: true,
    stages: [5, 25, 100],
    observationWindowMinutes: 30,
    thresholds: { ...GLOBAL_BUDGETS },
    ...overrides,
  };
}

test("accepts the committed canary shape", () => {
  assert.deepEqual(validatePolicy(validPolicy()), []);
});

test("rejects stages that skip the canary step or end early", () => {
  assert.ok(validatePolicy(validPolicy({ stages: [5, 100] })).includes("the intermediate 25% stage is required"));
  assert.ok(validatePolicy(validPolicy({ stages: [5, 25, 50] })).includes("the last stage must be 100"));
  assert.ok(validatePolicy(validPolicy({ stages: [5, 5, 100] })).includes("stages must be strictly ascending"));
});

test("rejects thresholds that loosen the global budgets", () => {
  const errors = validatePolicy(
    validPolicy({ thresholds: { ...GLOBAL_BUDGETS, inpMs: 500 } }),
  );
  assert.ok(errors.some((error) => error.includes("thresholds.inpMs")));
});

test("requires an owner, notes, an observation window and automatic rollback", () => {
  const errors = validatePolicy(
    validPolicy({ owner: " ", notes: "", observationWindowMinutes: 1, automaticRollback: "yes" }),
  );
  assert.ok(errors.includes("owner is required"));
  assert.ok(errors.includes("notes are required"));
  assert.ok(errors.includes("observationWindowMinutes must be at least 5"));
  assert.ok(errors.includes("automaticRollback must be a boolean"));
});

test("parses owners and expiries out of the registry source", () => {
  const source = `
  { id: "in_app_tour", envVar: "FEATURE_IN_APP_TOUR", owner: "design-experience", expiresAt: "2027-03-31T00:00:00.000Z", ... },
  { id: "rum_vitals", envVar: "FEATURE_RUM", owner: "site-reliability", expiresAt: "2027-03-31T00:00:00.000Z", ... }`;
  const flags = parseFlagRegistry(source);
  assert.equal(flags.length, 2);
  assert.deepEqual(flags[0], {
    id: "in_app_tour",
    envVar: "FEATURE_IN_APP_TOUR",
    owner: "design-experience",
    expiresAt: "2027-03-31T00:00:00.000Z",
  });
});

test("flags an expired or owner-less flag as stale", () => {
  const errors = staleFlags(
    [
      { id: "expired", envVar: "FEATURE_EXPIRED", owner: "team", expiresAt: "2026-01-01T00:00:00.000Z" },
      { id: "no-owner", envVar: "FEATURE_NO_OWNER", owner: " ", expiresAt: "2027-01-01T00:00:00.000Z" },
      { id: "bad-env", envVar: "NEXT_PUBLIC_FLAG", owner: "team", expiresAt: "2027-01-01T00:00:00.000Z" },
    ],
    NOW,
  );
  assert.ok(errors.some((error) => error.includes("expired")));
  assert.ok(errors.some((error) => error.includes("no-owner has no owner")));
  assert.ok(errors.some((error) => error.includes("bad-env env var must start with FEATURE_")));
});

test("reports a registry that cannot be parsed instead of passing silently", () => {
  assert.deepEqual(staleFlags([], NOW), ["no feature flags were parsed from the registry"]);
});

test("every overlay must expose the phase-10 flags", () => {
  const complete = `
    literals:
      - FEATURE_AI_COPILOT=true
      - FEATURE_IN_APP_TOUR=true
      - FEATURE_RUM=false`;
  assert.deepEqual(checkOverlay(complete, "dev"), []);
  const missing = checkOverlay("    literals:\n      - FEATURE_RUM=false", "prod");
  assert.equal(missing.length, 2);
  assert.ok(missing[0].includes("prod overlay is missing"));
});

test("runbooks must document the rollback section, canary, drill and RTO", () => {
  const complete = checkRunbooks({
    operationsRunbook: "## O35 — Release guard and rollback\nrollback steps",
    releaseRunbook: "## Canary\nRTO < 30 minutes\ndrill procedure",
  });
  assert.deepEqual(complete, []);
  const empty = checkRunbooks({ operationsRunbook: "", releaseRunbook: "" });
  assert.equal(empty.length, 5);
});
