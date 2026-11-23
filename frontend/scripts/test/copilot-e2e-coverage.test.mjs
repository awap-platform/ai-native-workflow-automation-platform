import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Issue 284 coverage guard.
 *
 * The full Copilot journey already runs in the live-stack E2E job. This guard keeps the pieces
 * wired together: the deterministic spec must keep its key assertions, the helper must keep both
 * LLM modes, and CI must keep the AI node enabled and the nightly provider switch.
 */

const root = join(import.meta.dirname, "..", "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("the deterministic Copilot journey asserts the whole Phase 2 flow", () => {
  const spec = read("e2e/copilot-journey.spec.ts");
  for (const marker of [
    "confirm_high_risk",
    "create_workflow_instance",
    "AI_HITL_REQUIRED",
    "waitForState",
    "COMPLETED",
    "decisionComment",
    "copilot.requests",
  ]) {
    assert.ok(spec.includes(marker), `copilot-journey.spec.ts must keep "${marker}"`);
  }
});

test("the helper keeps the deterministic and live-provider definitions", () => {
  const helper = read("e2e/copilotJourney.ts");
  for (const marker of ["lowConfidenceDefinition", "highConfidenceDefinition", "correlationId", "waitForTaskForInstance"]) {
    assert.ok(helper.includes(marker), `copilotJourney.ts must keep "${marker}"`);
  }
});

test("CI keeps the AI node and the nightly live-provider variant wired", () => {
  const ci = read("../.github/workflows/ci.yml");
  assert.match(ci, /AI_NODE_ENABLED:\s*"true"/);

  const nightly = read("../.github/workflows/copilot-nightly.yml");
  assert.match(nightly, /E2E_AI_LIVE_PROVIDER:\s*"1"/);
  assert.match(nightly, /AI_OPENAI_API_KEY/);
  assert.match(nightly, /copilot-live-provider\.spec\.ts/);

  const live = read("e2e/copilot-live-provider.spec.ts");
  assert.ok(live.includes("highConfidenceDefinition"));
});
