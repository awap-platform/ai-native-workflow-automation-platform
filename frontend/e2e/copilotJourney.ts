import { expect, type APIRequestContext } from "@playwright/test";
import { seedPlan, type SeedPlan } from "../lib/e2eSeed";

/**
 * Shared helpers for the full Copilot journey (issue #284). Everything runs against the real
 * Compose stack: real login, real workflow engine, real AI layer, real AI_TASK HITL and real task
 * approval. No route interception or API mock is used.
 */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8080";

export interface Me {
  id: string;
  tenantId: string;
}

export interface WorkflowDefinitionDto {
  id: string;
  name: string;
  status: string;
}

export interface WorkflowInstanceDto {
  id: string;
  workflowDefinitionId: string;
  state: string;
  idempotencyKey: string | null;
}

export interface TaskDto {
  id: string;
  workflowInstanceId: string | null;
  title: string;
  description: string | null;
  status: string;
  decisionComment: string | null;
}

export interface LogDto {
  nodeId: string | null;
  nodeType: string | null;
  action: string;
  payload: string | null;
}

export interface CopilotToolCallDto {
  name: string;
  ok: boolean;
  result?: unknown;
}

export interface CopilotDataDto {
  id?: string;
  workflowId?: string;
  state?: string;
  [key: string]: unknown;
}

export interface CopilotResponseDto {
  answer: string;
  action: string;
  confidence: number;
  requires_human_approval: boolean;
  tool_calls: CopilotToolCallDto[];
  data: CopilotDataDto | null;
  model: string | null;
  model_tier: string | null;
  prompt_version: string;
  correlation_id: string;
  idempotency_key: string | null;
}

export interface CopilotChatPayload {
  message: string;
  confirm_high_risk: boolean;
  idempotency_key: string;
}

export interface MetricsDto {
  counters: Record<string, number>;
  prompt_version: string;
}

/** Bootstraps the XSRF-TOKEN cookie through the dedicated endpoint and returns its value. */
export async function csrfToken(ctx: APIRequestContext): Promise<string> {
  const state = await ctx.storageState();
  const cookie = state.cookies.find((entry) => entry.name === "XSRF-TOKEN");
  if (cookie?.value) {
    return decodeURIComponent(cookie.value);
  }
  const response = await ctx.get(`${API_URL}/api/v1/auth/csrf`);
  expect(
    response.ok(),
    `the backend must issue an XSRF token (status ${response.status()})`,
  ).toBeTruthy();
  return ((await response.json()) as { token: string }).token;
}

export async function headers(
  ctx: APIRequestContext,
  tenantId: string,
): Promise<Record<string, string>> {
  return { "X-Tenant-Id": tenantId, "X-XSRF-TOKEN": await csrfToken(ctx) };
}

export async function login(ctx: APIRequestContext, plan: SeedPlan): Promise<Me> {
  const response = await ctx.post(`${API_URL}/api/v1/auth/login`, {
    headers: { "Content-Type": "application/json" },
    data: { tenantSlug: plan.slug, email: plan.adminEmail, password: plan.adminPassword },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const me = await ctx.get(`${API_URL}/api/v1/auth/me`);
  expect(me.ok(), await me.text()).toBeTruthy();
  return (await me.json()) as Me;
}

export async function getJson<T>(
  ctx: APIRequestContext,
  tenantId: string,
  path: string,
): Promise<T> {
  const response = await ctx.get(`${API_URL}${path}`, { headers: await headers(ctx, tenantId) });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}

export async function postJson<T>(
  ctx: APIRequestContext,
  tenantId: string,
  path: string,
  data: unknown = {},
): Promise<T> {
  const response = await ctx.post(`${API_URL}${path}`, {
    headers: { ...(await headers(ctx, tenantId)), "Content-Type": "application/json" },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}

/**
 * Sends a Copilot turn with a known correlation ID and the same Idempotency-Key header the SPA
 * sends. The response header and body correlation IDs must agree, which proves the context travels
 * through the backend proxy and the AI layer.
 */
export async function copilotChat(
  ctx: APIRequestContext,
  tenantId: string,
  payload: CopilotChatPayload,
  correlationId: string,
): Promise<{ body: CopilotResponseDto; status: number }> {
  const response = await ctx.post(`${API_URL}/api/v1/copilot/chat`, {
    headers: {
      ...(await headers(ctx, tenantId)),
      "Content-Type": "application/json",
      "Idempotency-Key": payload.idempotency_key,
      "X-Correlation-Id": correlationId,
    },
    data: payload,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()["x-correlation-id"]).toBe(correlationId);
  const body = (await response.json()) as CopilotResponseDto;
  expect(body.correlation_id).toBe(correlationId);
  return { body, status: response.status() };
}

export async function publishWorkflow(
  ctx: APIRequestContext,
  me: Me,
  name: string,
  definition: unknown,
): Promise<WorkflowDefinitionDto> {
  const created = await postJson<WorkflowDefinitionDto>(
    ctx,
    me.tenantId,
    "/api/v1/workflow-definitions",
    {
      name,
      description: "Copilot HITL journey (issue #284).",
      definitionJson: JSON.stringify(definition),
    },
  );
  return postJson<WorkflowDefinitionDto>(
    ctx,
    me.tenantId,
    `/api/v1/workflow-definitions/${created.id}/publish`,
  );
}

export async function instancesFor(
  ctx: APIRequestContext,
  tenantId: string,
  definitionId: string,
): Promise<WorkflowInstanceDto[]> {
  const instances = await getJson<WorkflowInstanceDto[]>(
    ctx,
    tenantId,
    "/api/v1/workflow-instances",
  );
  return instances.filter((instance) => instance.workflowDefinitionId === definitionId);
}

export async function tasksFor(ctx: APIRequestContext, tenantId: string): Promise<TaskDto[]> {
  return getJson<TaskDto[]>(ctx, tenantId, "/api/v1/tasks");
}

export async function logsFor(
  ctx: APIRequestContext,
  tenantId: string,
  instanceId: string,
): Promise<LogDto[]> {
  return getJson<LogDto[]>(ctx, tenantId, `/api/v1/workflow-instances/${instanceId}/logs`);
}

export async function waitForState(
  ctx: APIRequestContext,
  me: Me,
  instanceId: string,
  state: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await getJson<WorkflowInstanceDto>(
          ctx,
          me.tenantId,
          `/api/v1/workflow-instances/${instanceId}`,
        )).state,
      { timeout: 180_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(state);
}

export async function waitForTaskForInstance(
  ctx: APIRequestContext,
  me: Me,
  instanceId: string,
): Promise<TaskDto> {
  await expect
    .poll(
      async () =>
        (await tasksFor(ctx, me.tenantId)).find(
          (task) => task.workflowInstanceId === instanceId,
        )?.id,
      { timeout: 60_000, intervals: [1_000, 2_000] },
    )
    .toBeTruthy();
  const task = (await tasksFor(ctx, me.tenantId)).find(
    (entry) => entry.workflowInstanceId === instanceId,
  );
  expect(task, `instance ${instanceId} must create an approval task`).toBeTruthy();
  return task!;
}

export async function waitForLog(
  ctx: APIRequestContext,
  me: Me,
  instanceId: string,
  nodeId: string,
  action: string,
): Promise<LogDto> {
  await expect
    .poll(
      async () =>
        (await logsFor(ctx, me.tenantId, instanceId)).filter(
          (entry) => entry.nodeId === nodeId && entry.action === action,
        ).length,
      { timeout: 60_000, intervals: [1_000, 2_000] },
    )
    .toBeGreaterThanOrEqual(1);
  const entries = await logsFor(ctx, me.tenantId, instanceId);
  return entries.find((entry) => entry.nodeId === nodeId && entry.action === action)!;
}

/**
 * START -> AI_TASK -> END. The prompt contains hedging words so the deterministic local heuristic
 * provider produces a low-confidence completion, which forces the AI_TASK HITL handover.
 */
export function lowConfidenceDefinition(): unknown {
  return definitionWithPrompt(
    "maybe the request is unclear and I cannot determine the category",
  );
}

/** START -> AI_TASK -> END with a substantive prompt for the nightly live-provider variant. */
export function highConfidenceDefinition(): unknown {
  return definitionWithPrompt(
    "Summarize the accessible leave policy for the requesting employee in one clear sentence.",
  );
}

function definitionWithPrompt(prompt: string): unknown {
  return {
    nodes: [
      { id: "start", type: "START", name: "Start" },
      {
        id: "ai",
        type: "AI_TASK",
        name: "Copilot AI decision",
        config: { action: "SUMMARIZE", prompt, approvers: ["role:TENANT_ADMIN"] },
      },
      { id: "end", type: "END", name: "End" },
    ],
    transitions: [
      { from: "start", to: "ai" },
      { from: "ai", to: "end" },
    ],
  };
}

export { seedPlan, type SeedPlan };
