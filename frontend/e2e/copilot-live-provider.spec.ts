import { expect, test } from "@playwright/test";

import {
  copilotChat,
  highConfidenceDefinition,
  instancesFor,
  login,
  logsFor,
  publishWorkflow,
  seedPlan,
  waitForLog,
  waitForState,
} from "./copilotJourney";

/**
 * Nightly live-provider variant of the Copilot journey (issue #284).
 *
 * Gated by `E2E_AI_LIVE_PROVIDER=1` in `playwright.config.ts`: PR CI uses the deterministic local
 * heuristic (`copilot-journey.spec.ts`). The nightly run points the backend at a real
 * OpenAI-compatible provider (`awap.ai.provider=openai`) and records the configured model version
 * in the scheduler/CI log before running this spec.
 */
test("runs the Copilot journey against the configured live AI provider", async ({ context }) => {
  test.setTimeout(360_000);
  const plan = seedPlan(process.env.E2E_SEED_SUFFIX ?? "local");
  const me = await login(context.request, plan);

  const suffix = `${Date.now()}`;
  const workflowName = `Copilot HITL ${suffix}`;
  const definition = await publishWorkflow(
    context.request,
    me,
    workflowName,
    highConfidenceDefinition(),
  );
  expect(definition.status).toBe("PUBLISHED");

  const confirmed = await copilotChat(
    context.request,
    me.tenantId,
    {
      message: `start ${workflowName}`,
      confirm_high_risk: true,
      idempotency_key: `live-${suffix}`,
    },
    `corr-live-${suffix}`,
  );
  const instanceId = String(confirmed.body.data?.id);
  expect(instanceId).toBeTruthy();
  expect(confirmed.body.correlation_id).toContain("corr-live-");

  await waitForState(context.request, me, instanceId, "COMPLETED");
  await waitForLog(context.request, me, instanceId, "ai", "NODE_COMPLETED");
  expect(await instancesFor(context.request, me.tenantId, definition.id)).toHaveLength(1);

  const logs = await logsFor(context.request, me.tenantId, instanceId);
  const completed = logs.find((entry) => entry.nodeId === "ai" && entry.action === "NODE_COMPLETED");
  expect(completed?.payload?.length ?? 0).toBeGreaterThan(0);
});
