import type { Page } from "@playwright/test";

/**
 * Shared accessibility fixtures (issue #184).
 *
 * The suite runs against deterministic API mocks so every screen can be
 * exercised in both empty and populated states without a backend. The same
 * fixture seeds the session cookies the middleware and RouteGuard require.
 */

const API = "http://localhost:8080";

const now = "2026-11-09T10:00:00.000Z";

export const taskFixture = {
  id: "task-1",
  tenantId: "tenant-a",
  workflowInstanceId: "inst-1",
  title: "Approve expense",
  description: "Approve the Q4 expense report.",
  assigneeId: "user-1",
  status: "ASSIGNED",
  version: 1,
  decisionComment: null,
  taskType: "APPROVAL",
  escalated: false,
  escalateAt: "2026-11-20T23:00:00Z",
  createdAt: "2026-11-20T08:00:00Z",
  updatedAt: "2026-11-20T08:30:00Z",
  completedAt: null,
};

/** Issue 360: a realistic multi-row inbox, including a hostile-length and a Turkish title. */
export const longTaskFixture = {
  ...taskFixture,
  id: "task-long",
  title:
    "Approve the international travel and accommodation request for the Q4 finance conference in Amsterdam",
  status: "IN_PROGRESS",
  escalateAt: "2026-11-21T23:00:00Z",
};

export const turkishTaskFixture = {
  ...taskFixture,
  id: "task-tr",
  title: "Şirketler arası ödeme onayı ve belge kontrolü",
  status: "OPEN",
  assigneeId: null,
  escalateAt: null,
};

export const inboxTaskFixtures = [taskFixture, longTaskFixture, turkishTaskFixture];

export const instanceFixture = {
  id: "inst-1",
  tenantId: "tenant-a",
  workflowDefinitionId: "wf-1",
  workflowVersion: 1,
  state: "RUNNING",
  contextJson: "{}",
  idempotencyKey: null,
  createdAt: now,
};

export const workflowFixture = {
  id: "wf-1",
  tenantId: "tenant-a",
  name: "Expense approval",
  description: "Two-step expense approval",
  status: "PUBLISHED",
  currentVersion: 1,
};

export const formFixture = {
  id: "form-1",
  tenantId: "tenant-a",
  name: "Customer intake",
  schemaJson: JSON.stringify({
    fields: [
      { id: "customer_name", type: "TEXT", required: true },
      { id: "tier", type: "SELECT", options: ["Gold", "Silver"] },
      { id: "notes", type: "TEXTAREA" },
    ],
  }),
  version: 1,
  createdAt: now,
};

export const analyticsFixture = [
  {
    day: "2026-11-08",
    eventType: "WORKFLOW_COMPLETED",
    count: 12,
    totalDurationMs: 24000,
    averageDurationMs: 2000,
  },
  {
    day: "2026-11-08",
    eventType: "WORKFLOW_FAILED",
    count: 2,
    totalDurationMs: 4000,
    averageDurationMs: 2000,
  },
  {
    day: "2026-11-08",
    eventType: "TASK_COMPLETED",
    count: 30,
    totalDurationMs: 30000,
    averageDurationMs: 1000,
  },
];

const emptyPercentiles = { p50: null, p90: null, p95: null, p99: null, sampleCount: 0 };

/** Advanced dashboard contract used by the analytics accessibility screen. */
export function analyticsDashboardFixture(populated: boolean) {
  return {
    from: "2026-11-02",
    to: "2026-11-08",
    granularity: "DAY",
    timezone: "UTC",
    dataCompleteness: {
      dailyTotalsAvailable: true,
      rawEventsAvailable: populated,
      sampleCount: populated ? 44 : 0,
    },
    dailyTotals: populated ? analyticsFixture : [],
    timeBuckets: populated
      ? [{ bucket: "2026-11-08", total: 44, counts: { WORKFLOW_COMPLETED: 12 } }]
      : [],
    workflowDuration: populated
      ? { p50: 1800, p90: 2400, p95: 2500, p99: 2600, sampleCount: 12 }
      : emptyPercentiles,
    taskCycleTime: populated
      ? { p50: 900, p90: 1100, p95: 1200, p99: 1300, sampleCount: 30 }
      : emptyPercentiles,
    approvalLatency: populated
      ? { p50: 400, p90: 500, p95: 550, p99: 600, sampleCount: 2 }
      : emptyPercentiles,
    failureRate: populated ? 0.1429 : 0,
    slaBreachRate: populated ? 0.05 : 0,
    bottlenecks: populated
      ? [{ nodeId: "approval", count: 2, averageDurationMs: 400, p95DurationMs: 500 }]
      : [],
    groups: populated
      ? [{ key: "WORKFLOW_COMPLETED", count: 12, averageDurationMs: 2000, p95DurationMs: 2400 }]
      : [],
    trend: {
      currentCount: populated ? 44 : 0,
      previousCount: populated ? 10 : 0,
      delta: populated ? 34 : 0,
    },
  };
}

export const documentFixture = {
  id: "version-1",
  fileId: "file-1",
  version: 1,
  size: 2048,
  format: "pdf",
  status: "PROMOTED",
  createdAt: now,
  name: "contract.pdf",
  scanStatus: "PROMOTED",
  scanError: null,
  downloadable: true,
};

export const notificationFixture = {
  id: "notification-1",
  channel: "EMAIL",
  recipient: "ada@acme.com",
  templateKey: "task.assigned",
  status: "DELIVERED",
  attempts: 1,
  lastError: null,
  createdAt: now,
  read: false,
  readAt: null,
};

export const notificationTemplateFixture = {
  id: "template-1",
  templateKey: "task.assigned",
  locale: "en",
  subject: "Task assigned",
  body: "Hi {{name}}, a task needs your attention.",
  version: 1,
  active: true,
  createdAt: now,
  updatedAt: now,
};

export const adminIdentityFixture = (populated: boolean) => ({
  tenantId: "tenant-a",
  plan: "FREE",
  maxUsers: 10,
  maxWorkflows: 5,
  maxAiCallsPerMonth: 1000,
  usersUsed: populated ? 1 : 0,
  workflowsUsed: populated ? 2 : 0,
  users: populated
    ? [
        {
          id: "user-1",
          email: "ada@acme.com",
          fullName: "Ada Lovelace",
          role: "TENANT_ADMIN",
          deleted: false,
          createdAt: now,
        },
      ]
    : [],
  groups: populated ? [{ id: "team-1", name: "Platform", memberCount: 1 }] : [],
  roles: [
    { name: "SYSTEM_ADMIN", rank: 1, permissions: ["TENANT_MANAGE", "USER_MANAGE"] },
    { name: "TENANT_ADMIN", rank: 2, permissions: ["USER_MANAGE", "INSTANCE_READ"] },
    { name: "MANAGER", rank: 3, permissions: ["INSTANCE_READ"] },
    { name: "OPERATIONS", rank: 4, permissions: ["INSTANCE_READ"] },
    { name: "EMPLOYEE", rank: 5, permissions: ["INSTANCE_READ"] },
  ],
  permissions: [
    { name: "TENANT_MANAGE" },
    { name: "USER_MANAGE" },
    { name: "INSTANCE_READ" },
  ],
  invitations: populated
    ? [
        {
          id: "invitation-1",
          email: "new@acme.com",
          role: "EMPLOYEE",
          consumed: false,
          expiresAt: "2026-11-20T10:00:00Z",
          createdAt: now,
        },
      ]
    : [],
});

export const adminOperateFixture = (populated: boolean) => ({
  tenantId: "tenant-a",
  generatedAt: now,
  workflows: { total: populated ? 3 : 0, published: populated ? 2 : 0, draft: populated ? 1 : 0 },
  instances: {
    total: populated ? 4 : 0,
    running: populated ? 1 : 0,
    failed: populated ? 1 : 0,
    completed: populated ? 2 : 0,
  },
  tasks: { total: populated ? 5 : 0, open: populated ? 2 : 0, completed: populated ? 3 : 0 },
  outbox: { pending: populated ? 1 : 0, exhausted: 0 },
  dlq: { failed: populated ? 1 : 0 },
  jobs: [
    { name: "outbox-relay", status: "UP", detail: "last run: 2026-11-09T10:00:00Z" },
    { name: "notification-retry", status: populated ? "BACKLOG" : "IDLE", detail: "1 retry" },
  ],
});

export const adminAuditFixture = (populated: boolean) => ({
  items: populated
    ? [
        {
          id: "audit-1",
          entityType: "USER",
          entityId: "user-1",
          action: "ROLE_CHANGED",
          oldValue: "EMPLOYEE",
          newValue: "MANAGER",
          actorId: "user-1",
          createdAt: now,
        },
      ]
    : [],
  nextCursor: null,
  hasMore: false,
});

export const adminDlqFixture = (populated: boolean) =>
  populated
    ? [
        {
          id: "delivery-1",
          channel: "EMAIL",
          recipient: "ada@acme.com",
          templateKey: "task.assigned",
          attempts: 3,
          lastError: "smtp timeout",
          createdAt: now,
        },
      ]
    : [];

export const breakGlassFixture = {
  available: true,
  log: {
    incident: 257,
    owner: "koraysrn",
    opened_at: "2026-11-11T15:00:00Z",
    expiry: "2026-11-13T23:59:59Z",
    reason: "Single maintainer.",
    scope: "Only the approval count was lowered for one merge at a time.",
    merges: [
      {
        issue: 197,
        pr: 256,
        merge_sha: "d8560f5dc8dc4d7a3fa8b87f91086b0e12f3846c",
        merged_at: "2026-11-11T16:35:03Z",
        checks_green: true,
        restore_apply: "updated",
        restore_verify: "matches",
      },
    ],
  },
};

export const tenantUsageFixture = (populated: boolean) => ({
  tenantId: "tenant-a",
  from: "2026-11-02",
  to: "2026-11-08",
  metrics: [
    {
      key: "ai_calls",
      unit: "COUNT",
      total: populated ? 12 : 0,
      limit: 1000,
      remaining: populated ? 988 : 1000,
      days: [],
    },
  ],
});

/** Phase 8 analytics overview fixture; totals are server-computed in production. */
export function analyticsOverviewFixture(populated: boolean) {
  return {
    dashboard: analyticsDashboardFixture(populated),
    eventTotals: populated
      ? [
          { eventType: "TASK_COMPLETED", count: 30, totalDurationMs: 30000, averageDurationMs: 1000 },
          {
            eventType: "WORKFLOW_COMPLETED",
            count: 12,
            totalDurationMs: 24000,
            averageDurationMs: 2000,
          },
          { eventType: "WORKFLOW_FAILED", count: 2, totalDurationMs: 4000, averageDurationMs: 2000 },
        ]
      : [],
    totalEvents: populated ? 44 : 0,
  };
}

export const analyticsDrilldownFixture = (populated: boolean) => ({
  from: "2026-11-02",
  to: "2026-11-08",
  eventType: "WORKFLOW_COMPLETED",
  page: 0,
  size: 20,
  totalElements: populated ? 1 : 0,
  totalPages: populated ? 1 : 0,
  partial: false,
  detail: null,
  rows: populated
    ? [
        {
          id: "sample-1",
          eventType: "WORKFLOW_COMPLETED",
          workflowInstanceId: "inst-1",
          taskId: null,
          nodeId: "approval",
          durationMs: 1200,
          occurredAt: now,
        },
      ]
    : [],
});

export const organizationTreeFixture = [
  {
    id: "company-1",
    name: "Acme Inc",
    departments: [
      {
        id: "department-1",
        name: "Engineering",
        teams: [
          {
            id: "team-1",
            name: "Platform",
            users: [{ id: "user-1", email: "ada@acme.com", fullName: "Ada Lovelace" }],
          },
        ],
      },
    ],
  },
];

const memberships = [
  { tenantId: "tenant-a", role: "TENANT_ADMIN" },
  { tenantId: "tenant-b", role: "EMPLOYEE" },
];

export type CopilotFixtureKind = "success" | "injection" | "no-answer" | "proposal" | "confirmed";

/** Deterministic Copilot response used by the accessibility and Phase 9 E2E specs. */
export function copilotResponseFixture(kind: CopilotFixtureKind = "success") {
  const baseAudit = {
    request_id: "copilot-request-1",
    action: "knowledge_search",
    outcome: "SUCCESS",
    confidence: 0.91,
    requires_human_approval: false,
    tool_calls: [],
    idempotency_key: "copilot-request-1",
    correlation_id: "corr-copilot",
    prompt_key: "knowledge_search",
    prompt_version: "v1",
    prompt_hash: "a".repeat(64),
    model: "gpt-4o-mini",
    model_tier: "standard",
    routing_reason: "moderate complexity",
    proposal_id: null,
    proposal_hash: null,
    decision: null,
    retrieved_document_ids: ["file-1"],
  };
  const budget = {
    remaining_tokens: 900,
    monthly_budget_tokens: 1000,
    used_tokens: 100,
    estimated_cost_micros: 20,
  };
  const guardrail = {
    policy: null,
    decision: "allow",
    score: 0,
    version: "v1",
    unavailable: false,
  };
  if (kind === "injection") {
    return {
      answer:
        "I cannot process this request because it violates the configured safety policy (prompt-injection or guardrail block). No tool was called.",
      action: "chat",
      confidence: 0,
      requires_human_approval: true,
      tool_calls: [],
      data: { errorCode: "GUARDRAIL_BLOCKED", policy: "prompt_injection" },
      model: null,
      model_tier: null,
      prompt_version: "v1",
      correlation_id: "corr-copilot",
      idempotency_key: "copilot-request-injection",
      outcome: "GUARDRAIL_BLOCKED",
      citations: [],
      budget,
      warnings: [
        {
          code: "GUARDRAIL_PROMPT_INJECTION_BLOCKED",
          message: "The request was blocked by the safety policy and no tool was called.",
          severity: "error",
        },
      ],
      guardrail: { ...guardrail, policy: "prompt_injection", decision: "block", score: 0.95 },
      audit: {
        ...baseAudit,
        action: "chat",
        outcome: "GUARDRAIL_BLOCKED",
        requires_human_approval: true,
        retrieved_document_ids: [],
        idempotency_key: "copilot-request-injection",
      },
    };
  }
  if (kind === "no-answer") {
    return {
      answer:
        "I don't know. I could not find a tenant document that answers this question, so I will not guess.",
      action: "knowledge_search",
      confidence: 0,
      requires_human_approval: true,
      tool_calls: [
        {
          name: "search_documents",
          arguments: { query: "sabbatical", note: "ada@acme.com" },
          result: [],
          ok: true,
          error: null,
        },
      ],
      data: [],
      model: "gpt-4o-mini",
      model_tier: "cheap",
      prompt_version: "v1",
      correlation_id: "corr-copilot",
      idempotency_key: "copilot-request-no-answer",
      outcome: "NO_ANSWER",
      citations: [],
      budget,
      warnings: [
        {
          code: "NO_ANSWER",
          message: "No tenant document matched the question; the Copilot did not guess.",
          severity: "warning",
        },
      ],
      guardrail,
      audit: {
        ...baseAudit,
        outcome: "NO_ANSWER",
        confidence: 0,
        requires_human_approval: true,
        retrieved_document_ids: [],
        idempotency_key: "copilot-request-no-answer",
      },
    };
  }
  if (kind === "proposal" || kind === "confirmed") {
    const confirmed = kind === "confirmed";
    return {
      answer: confirmed
        ? "The approval task was created after explicit confirmation."
        : "Review the title, description and assignee, then confirm with the proposal id and hash below. Nothing has been created yet.",
      action: "approval_assistance",
      confidence: confirmed ? 0.95 : 0.82,
      requires_human_approval: !confirmed,
      tool_calls: confirmed
        ? [
            {
              name: "create_approval",
              arguments: { title: "Approve leave", token: "secret" },
              result: { id: "approval-1" },
              ok: true,
              error: null,
            },
          ]
        : [],
      data: confirmed
        ? { id: "approval-1", status: "OPEN" }
        : {
            workflowInstanceId: "inst-1",
            proposedAction: "create_approval",
            proposalId: "proposal-1",
            proposalHash: "b".repeat(64),
            expiresAt: 1_800_000_000,
          },
      model: "gpt-4o-mini",
      model_tier: "standard",
      prompt_version: "v1",
      correlation_id: "corr-copilot",
      idempotency_key: "approval-request-1",
      outcome: confirmed ? "CONFIRMED" : "PROPOSED",
      citations: [],
      budget,
      warnings: [],
      guardrail,
      audit: {
        ...baseAudit,
        action: "approval_assistance",
        outcome: confirmed ? "CONFIRMED" : "PROPOSED",
        requires_human_approval: !confirmed,
        proposal_id: "proposal-1",
        proposal_hash: "b".repeat(64),
        decision: confirmed ? "CONFIRMED" : "PROPOSED",
        retrieved_document_ids: [],
        idempotency_key: "approval-request-1",
      },
    };
  }
  const toolCall = {
    name: "search_documents",
    arguments: { query: "leave policy", note: "ada@acme.com", token: "secret" },
    result: [{ fileId: "file-1" }],
    ok: true,
    error: null,
  };
  return {
    answer:
      "Grounded summary from your tenant documents:\n- Leave policy.pdf: Employees may request annual leave.\nSources:\n[1] Leave policy.pdf (file-1, chunk 2)",
    action: "knowledge_search",
    confidence: 0.91,
    requires_human_approval: false,
    tool_calls: [toolCall],
    data: [],
    model: "gpt-4o-mini",
    model_tier: "standard",
    prompt_version: "v1",
    correlation_id: "corr-copilot",
    idempotency_key: "copilot-request-1",
    outcome: "SUCCESS",
    citations: [
      { index: 1, title: "Leave policy.pdf", document_id: "file-1", chunk_index: 2, score: 0.91 },
    ],
    budget,
    warnings: [
      {
        code: "PII_REDACTED",
        message: "Personal data in the request was redacted before it reached the model.",
        severity: "warning",
      },
    ],
    guardrail,
    audit: { ...baseAudit, tool_calls: [toolCall] },
  };
}

/** Chooses the response body for a mocked API request. */
export function responseFor(pathname: string, populated: boolean): unknown {
  if (pathname.endsWith("/actuator/health")) {
    return { status: "UP" };
  }
  if (pathname.endsWith("/api/v1/admin/identity")) {
    return adminIdentityFixture(populated);
  }
  if (pathname.endsWith("/api/v1/admin/operate")) {
    return adminOperateFixture(populated);
  }
  if (pathname.endsWith("/api/v1/admin/audit")) {
    return adminAuditFixture(populated);
  }
  if (pathname.endsWith("/api/v1/admin/dlq")) {
    return adminDlqFixture(populated);
  }
  if (pathname.endsWith("/api/v1/admin/break-glass")) {
    return breakGlassFixture;
  }
  if (/\/api\/v1\/tenants\/[^/]+\/usage$/.test(pathname)) {
    return tenantUsageFixture(populated);
  }
  if (pathname.endsWith("/api/v1/analytics/overview")) {
    return analyticsOverviewFixture(populated);
  }
  if (pathname.endsWith("/api/v1/analytics/drilldown")) {
    return analyticsDrilldownFixture(populated);
  }
  if (pathname.endsWith("/api/v1/auth/tenants")) {
    return memberships;
  }
  if (pathname.endsWith("/api/v1/auth/csrf")) {
    return {};
  }
  if (pathname.endsWith("/api/v1/tasks/mine")) {
    return populated ? inboxTaskFixtures : [];
  }
  if (pathname.endsWith("/api/v1/tasks")) {
    return populated ? inboxTaskFixtures : [];
  }
  if (pathname.endsWith("/api/v1/workflow-instances")) {
    return populated ? [instanceFixture] : [];
  }
  if (pathname.endsWith("/api/v1/workflow-instances/inst-1/logs")) {
    return populated
      ? [
          {
            id: "log-1",
            workflowInstanceId: "inst-1",
            nodeId: "start",
            nodeType: "START",
            action: "NODE_STARTED",
            payload: "{}",
            createdAt: now,
          },
          {
            id: "log-2",
            workflowInstanceId: "inst-1",
            nodeId: "end",
            nodeType: "END",
            action: "NODE_COMPLETED",
            payload: '{"result":"ok"}',
            createdAt: now,
          },
        ]
      : [];
  }
  if (pathname.endsWith("/api/v1/workflow-instances/inst-1/saga")) {
    return populated
      ? {
          id: "saga-1",
          tenantId: "tenant-a",
          workflowInstanceId: "inst-1",
          sagaKey: "saga-key",
          status: "COMPLETED",
          failureReason: null,
          compensationStartedAt: null,
          compensationCompletedAt: null,
          createdAt: now,
          updatedAt: now,
          steps: [],
        }
      : [];
  }
  if (pathname.endsWith("/api/v1/workflow-instances/inst-1")) {
    return instanceFixture;
  }
  if (pathname.endsWith("/api/v1/workflow-definitions")) {
    return populated ? [workflowFixture] : [];
  }
  if (pathname.endsWith("/api/v1/forms/form-1")) {
    return formFixture;
  }
  if (pathname.endsWith("/api/v1/forms")) {
    return populated ? [formFixture] : [];
  }
  if (pathname.endsWith("/api/v1/analytics/dashboard")) {
    return analyticsDashboardFixture(populated);
  }
  if (pathname.endsWith("/api/v1/analytics/summary")) {
    return populated ? analyticsFixture : [];
  }
  if (pathname.endsWith("/api/v1/documents/file-1/versions")) {
    return populated
      ? [
          documentFixture,
          {
            ...documentFixture,
            id: "version-0",
            version: 0,
            status: "ARCHIVED",
            scanStatus: "PROMOTED",
          },
        ]
      : [];
  }
  if (pathname.endsWith("/api/v1/documents")) {
    return populated ? [documentFixture] : [];
  }
  if (pathname.endsWith("/api/v1/notifications/suppressions")) {
    return populated
      ? [
          {
            id: "suppression-1",
            channel: "EMAIL",
            recipient: "bounce@example.com",
            reason: "SMTP_BOUNCE",
            createdAt: now,
          },
        ]
      : [];
  }
  if (pathname.endsWith("/api/v1/organizations/companies")) {
    return populated ? [{ id: "company-1", name: "Acme Inc" }] : [];
  }
  if (pathname.endsWith("/api/v1/organizations/tree")) {
    return populated ? organizationTreeFixture : [];
  }
  if (pathname.endsWith("/api/v1/notifications/unread-count")) {
    return { count: populated ? 1 : 0 };
  }
  if (pathname.endsWith("/api/v1/notifications")) {
    return populated ? [notificationFixture] : [];
  }
  if (pathname.endsWith("/api/v1/notification-templates")) {
    return populated ? [notificationTemplateFixture] : [];
  }
  return [];
}

/** Installs deterministic API mocks for the current page. */
export async function installApiMocks(page: Page, populated: boolean): Promise<void> {
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    // The document scan view opens an EventSource. Answering it with JSON makes
    // the browser log a MIME mismatch, so serve a valid (immediately closing)
    // event stream instead.
    if (pathname.endsWith("/api/v1/documents/events")) {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
        body: ": connected\n\n",
      });
      return;
    }

    if (pathname.endsWith("/api/v1/copilot/chat")) {
      const body = (request.postDataJSON() ?? {}) as { message?: string };
      const message = body.message ?? "";
      const kind = /ignore previous|system prompt|jailbreak/i.test(message)
        ? "injection"
        : /sabbatical|no answer|unavailable policy/i.test(message)
          ? "no-answer"
          : "success";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(copilotResponseFixture(kind)),
      });
      return;
    }
    if (pathname.endsWith("/api/v1/copilot/approvals")) {
      const body = (request.postDataJSON() ?? {}) as { confirm?: boolean };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(copilotResponseFixture(body.confirm ? "confirmed" : "proposal")),
      });
      return;
    }
    if (request.method() !== "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseFor(pathname, populated)),
    });
  });
}

/** The suite runs against the dev server or a production preview port; cookies follow it. */
const SESSION_ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Admin destinations require an admin role; every other protected screen uses MANAGER. */
const ADMIN_SCREENS = new Set(["admin", "operate", "audit", "admin-csp", "design-system"]);

/** Seeds the cookies the middleware, RouteGuard and shell rely on. */
export async function setSession(
  page: Page,
  options: { tenant?: string | null; role?: string | null; locale?: string | null } = {},
): Promise<void> {
  const cookies = [
    { name: "awap_session", value: "1", url: SESSION_ORIGIN, sameSite: "Lax" as const },
  ];
  if (options.tenant !== null && options.tenant !== undefined) {
    cookies.push({
      name: "awap_tenant",
      value: options.tenant,
      url: SESSION_ORIGIN,
      sameSite: "Lax" as const,
    });
  }
  if (options.role !== null && options.role !== undefined) {
    cookies.push({
      name: "awap_role",
      value: options.role,
      url: SESSION_ORIGIN,
      sameSite: "Lax" as const,
    });
  }
  if (options.locale !== null && options.locale !== undefined) {
    cookies.push({
      name: "awap_locale",
      value: options.locale,
      url: SESSION_ORIGIN,
      sameSite: "Lax" as const,
    });
  }
  await page.context().addCookies(cookies);
}

export interface ScreenDefinition {
  name: string;
  path: string;
  heading: string;
  /** Protected application screen; seeds `awap_session` and `awap_tenant`. */
  protected?: boolean;
  /** Seeds only `awap_session` (the tenant picker). */
  sessionOnly?: boolean;
  states: Array<"empty" | "populated">;
}

export const SCREENS: ScreenDefinition[] = [
  { name: "login", path: "/", heading: "Sign in", states: ["empty"] },
  { name: "register", path: "/register", heading: "Create tenant", states: ["empty"] },
  {
    name: "invitation",
    path: "/invitations/accept?token=demo-token",
    heading: "Accept invitation",
    states: ["empty"],
  },
  {
    name: "select-tenant",
    path: "/select-tenant",
    heading: "Select tenant",
    sessionOnly: true,
    states: ["populated"],
  },
  {
    name: "dashboard",
    path: "/dashboard",
    heading: "Dashboard",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "copilot",
    path: "/copilot",
    heading: "AI Copilot",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "tasks",
    path: "/tasks",
    heading: "Task inbox",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "task-detail",
    path: "/tasks?task=task-1",
    heading: "Task inbox",
    protected: true,
    states: ["populated"],
  },
  {
    name: "workflows",
    path: "/workflows",
    heading: "Workflows",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "workflow-designer",
    path: "/workflows/designer",
    heading: "Workflow Designer",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "form-builder",
    path: "/forms/builder",
    heading: "Form Builder",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "form-fill",
    path: "/forms/fill",
    heading: "Fill Form",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "documents",
    path: "/documents",
    heading: "Documents",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "notifications",
    path: "/notifications",
    heading: "Notifications",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "notification-templates",
    path: "/notification-templates",
    heading: "Notification templates",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "analytics",
    // Fixed range keeps the visual baseline deterministic across calendar days.
    path: "/analytics?from=2026-11-02&to=2026-11-08",
    heading: "Analytics",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "admin",
    path: "/admin",
    heading: "Identity console",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "operate",
    path: "/admin/operate",
    heading: "Operate console",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "audit",
    // Fixed range keeps the export inputs deterministic across calendar days.
    path: "/admin/audit?from=2026-11-02&to=2026-11-08",
    heading: "Audit log",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "instances",
    path: "/instances",
    heading: "Workflow Instances",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "instance-detail",
    path: "/instances/inst-1",
    heading: "Instance detail",
    protected: true,
    states: ["populated"],
  },
  {
    name: "organizations",
    path: "/organizations",
    heading: "Organizations",
    protected: true,
    states: ["empty", "populated"],
  },
  {
    name: "admin-csp",
    path: "/admin/csp",
    heading: "CSP reports",
    protected: true,
    states: ["empty"],
  },
  {
    name: "design-system",
    path: "/design-system",
    heading: "Design system",
    protected: true,
    states: ["empty"],
  },
];

/** Navigates to a screen and waits for its stable heading. */
export async function openScreen(
  page: Page,
  screen: ScreenDefinition,
  state: "empty" | "populated",
): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (screen.protected) {
    // Issue 360: realistic role and locale so baselines never contain "Role: Unknown". Admin
    // destinations keep their required role instead of rendering ForbiddenState.
    const admin = ADMIN_SCREENS.has(screen.name);
    await setSession(page, {
      tenant: "tenant-a",
      role: admin ? "TENANT_ADMIN" : "MANAGER",
      locale: "en",
    });
  } else if (screen.sessionOnly) {
    await setSession(page, { tenant: null });
  }
  await installApiMocks(page, state === "populated");
  await page.goto(screen.path);
  await page.getByRole("heading", { name: screen.heading }).waitFor({ state: "visible" });
  await page.waitForTimeout(250);
}
