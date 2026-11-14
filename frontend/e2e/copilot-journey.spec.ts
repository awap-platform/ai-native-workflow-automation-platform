import { expect, test } from "@playwright/test";

import {
  copilotChat,
  getJson,
  instancesFor,
  login,
  logsFor,
  lowConfidenceDefinition,
  postJson,
  publishWorkflow,
  seedPlan,
  tasksFor,
  waitForLog,
  waitForState,
  waitForTaskForInstance,
  type MetricsDto,
} from "./copilotJourney";

/**
 * Full Phase 2 acceptance journey (issue #284), deterministic local-heuristic mode.
 *
 * Natural language -> workflow discovery -> confirmed start -> AI_TASK low-confidence HITL ->
 * human approval -> workflow completion. Every assertion reads real backend state; nothing is
 * intercepted or mocked.
 */
test("runs the Copilot journey from natural language to AI_TASK HITL approval", async ({
  context,
}) => {
  test.setTimeout(360_000);
  const plan = seedPlan(process.env.E2E_SEED_SUFFIX ?? "local");
  const me = await login(context.request, plan);

  // A unique run id in both the workflow name and the request guarantees the Copilot discovery
  // step cannot pick an unrelated workflow left by another spec in the shared seeded tenant.
  const suffix = `${Date.now()}`;
  const workflowName = `Copilot HITL ${suffix}`;
  const definition = await publishWorkflow(
    context.request,
    me,
    workflowName,
    lowConfidenceDefinition(),
  );
  expect(definition.status).toBe("PUBLISHED");

  const metricsBefore = await getJson<MetricsDto>(
    context.request,
    me.tenantId,
    "/api/v1/copilot/metrics",
  );

  // 1. Natural-language preview: the Copilot discovers the workflow and asks for confirmation.
  const preview = await copilotChat(
    context.request,
    me.tenantId,
    {
      message: `start ${workflowName}`,
      confirm_high_risk: false,
      idempotency_key: `preview-${suffix}`,
    },
    `corr-preview-${suffix}`,
  );
  expect(preview.body.action).toBe("start_workflow");
  expect(preview.body.requires_human_approval).toBe(true);
  expect(preview.body.data?.workflowId).toBe(definition.id);
  expect(await instancesFor(context.request, me.tenantId, definition.id)).toHaveLength(0);

  // 2. Confirmed start creates exactly one instance and the AI_TASK HITL task.
  const confirmKey = `confirm-${suffix}`;
  const confirmed = await copilotChat(
    context.request,
    me.tenantId,
    {
      message: `start ${workflowName}`,
      confirm_high_risk: true,
      idempotency_key: confirmKey,
    },
    `corr-confirm-${suffix}`,
  );
  const instanceId = String(confirmed.body.data?.id);
  expect(instanceId).toBeTruthy();
  expect(
    confirmed.body.tool_calls.some((call) => call.name === "create_workflow_instance" && call.ok),
  ).toBe(true);

  // 3. The same logical request replayed with the same key returns the same instance and does not
  //    create a second process.
  const duplicate = await copilotChat(
    context.request,
    me.tenantId,
    {
      message: `start ${workflowName}`,
      confirm_high_risk: true,
      idempotency_key: confirmKey,
    },
    `corr-confirm-${suffix}`,
  );
  expect(String(duplicate.body.data?.id)).toBe(instanceId);
  expect(await instancesFor(context.request, me.tenantId, definition.id)).toHaveLength(1);

  // 4. The AI_TASK is waiting for a human; exactly one approval task exists.
  await waitForState(context.request, me, instanceId, "WAITING");
  const task = await waitForTaskForInstance(context.request, me, instanceId);
  expect(task.title).toContain("AI approval required");
  expect(task.description ?? "").toContain("below the configured threshold");
  expect((await tasksFor(context.request, me.tenantId)).filter(
    (entry) => entry.workflowInstanceId === instanceId,
  )).toHaveLength(1);

  // 5. The AI node audit trail shows the HITL handover before anyone approves it.
  await waitForLog(context.request, me, instanceId, "ai", "AI_HITL_REQUIRED");
  const beforeApproval = await logsFor(context.request, me.tenantId, instanceId);
  expect(
    beforeApproval.filter((entry) => entry.nodeId === "ai" && entry.action === "AI_HITL_REQUIRED"),
  ).toHaveLength(1);

  // 6. Approving through the real API resumes the node and completes the workflow.
  const comment = `Approved by the Copilot E2E journey ${suffix}`;
  await postJson(context.request, me.tenantId, `/api/v1/tasks/${task.id}/approve`, { comment });
  await waitForState(context.request, me, instanceId, "COMPLETED");
  await waitForLog(context.request, me, instanceId, "ai", "NODE_COMPLETED");

  // 7. The decision comment and audit trail persist; no duplicate instance or task exists.
  const finalTask = (await tasksFor(context.request, me.tenantId)).find(
    (entry) => entry.id === task.id,
  );
  expect(finalTask?.status).toBe("APPROVED");
  expect(finalTask?.decisionComment).toBe(comment);
  expect((await tasksFor(context.request, me.tenantId)).filter(
    (entry) => entry.workflowInstanceId === instanceId,
  )).toHaveLength(1);
  expect(await instancesFor(context.request, me.tenantId, definition.id)).toHaveLength(1);
  const logs = await logsFor(context.request, me.tenantId, instanceId);
  expect(logs.filter((entry) => entry.action === "NODE_COMPLETED" && entry.nodeId === "ai"))
    .toHaveLength(1);

  // 8. The Copilot metrics counted the two logical calls; the duplicate was replayed upstream.
  const metricsAfter = await getJson<MetricsDto>(
    context.request,
    me.tenantId,
    "/api/v1/copilot/metrics",
  );
  expect(metricsAfter.counters["copilot.requests"] ?? 0).toBeGreaterThanOrEqual(
    (metricsBefore.counters["copilot.requests"] ?? 0) + 2,
  );
  expect(metricsAfter.counters["copilot.intent.start_workflow"] ?? 0).toBeGreaterThanOrEqual(
    (metricsBefore.counters["copilot.intent.start_workflow"] ?? 0) + 2,
  );
});
