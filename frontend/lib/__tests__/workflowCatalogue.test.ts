import type { ExecutionLogDto, SagaDto, WorkflowDefinitionDto, WorkflowInstanceDto } from "../api";
import {
  buildTimeline,
  CONTEXT_MAX_LENGTH,
  filterInstances,
  filterWorkflows,
  instanceStats,
  newIdempotencyKey,
  paginate,
  parseContextJson,
  redactPayload,
  sortInstances,
  sortWorkflows,
  summarizeSaga,
  toCsv,
} from "../workflows/catalogue";

function definition(overrides: Partial<WorkflowDefinitionDto> = {}): WorkflowDefinitionDto {
  return {
    id: "wf-1",
    tenantId: "tenant-a",
    name: "Expense approval",
    description: "Two-step approval",
    status: "PUBLISHED",
    currentVersion: 2,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    createdBy: "user-1",
    ...overrides,
  };
}

function instance(overrides: Partial<WorkflowInstanceDto> = {}): WorkflowInstanceDto {
  return {
    id: "inst-1",
    tenantId: "tenant-a",
    workflowDefinitionId: "wf-1",
    workflowVersion: 2,
    state: "RUNNING",
    contextJson: "{}",
    idempotencyKey: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:05:00Z",
    parentInstanceId: null,
    ...overrides,
  };
}

function log(overrides: Partial<ExecutionLogDto> = {}): ExecutionLogDto {
  return {
    id: "log-1",
    workflowInstanceId: "inst-1",
    nodeId: "approval",
    nodeType: "TASK",
    action: "NODE_STARTED",
    payload: "{}",
    createdAt: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

describe("workflow catalogue", () => {
  const rows = [
    definition({ id: "a", name: "Beta", status: "DRAFT", updatedAt: "2026-11-10T10:00:00Z" }),
    definition({ id: "b", name: "Alpha", status: "PUBLISHED", updatedAt: "2026-11-20T10:00:00Z" }),
    definition({ id: "c", name: "Gamma", status: "PUBLISHED", currentVersion: 5 }),
  ];

  it("searches name/description/status and filters by status", () => {
    expect(filterWorkflows(rows, { search: "alpha", status: "ALL", sort: "name" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterWorkflows(rows, { search: "", status: "DRAFT", sort: "name" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterWorkflows(rows, { search: "approval", status: "ALL", sort: "name" })).toHaveLength(3);
  });

  it("sorts by updated, name and version without mutating the input", () => {
    const snapshot = [...rows];
    expect(sortWorkflows(rows, "updated").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortWorkflows(rows, "name").map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortWorkflows(rows, "version").map((r) => r.currentVersion)).toEqual([5, 2, 2]);
    expect(rows).toEqual(snapshot);
  });

  it("counts running instances per definition", () => {
    const stats = instanceStats([
      instance({ id: "1", workflowDefinitionId: "wf-1", state: "RUNNING" }),
      instance({ id: "2", workflowDefinitionId: "wf-1", state: "COMPLETED" }),
      instance({ id: "3", workflowDefinitionId: "wf-1", state: "PAUSED" }),
      instance({ id: "4", workflowDefinitionId: "wf-2", state: "WAITING" }),
    ]);
    expect(stats.get("wf-1")).toEqual({ total: 3, running: 2 });
    expect(stats.get("wf-2")).toEqual({ total: 1, running: 1 });
  });
});

describe("instance monitor", () => {
  it("filters by state and searches id/definition/state", () => {
    const rows = [
      instance({ id: "alpha", state: "FAILED" }),
      instance({ id: "beta", state: "RUNNING" }),
    ];
    expect(filterInstances(rows, "FAILED", "", "newest").map((r) => r.id)).toEqual(["alpha"]);
    expect(filterInstances(rows, "ALL", "beta", "newest").map((r) => r.id)).toEqual(["beta"]);
  });

  it("sorts newest, oldest and state", () => {
    const rows = [
      instance({ id: "old", createdAt: "2026-11-01T00:00:00Z", state: "COMPLETED" }),
      instance({ id: "new", createdAt: "2026-11-20T00:00:00Z", state: "FAILED" }),
    ];
    expect(sortInstances(rows, "newest").map((r) => r.id)).toEqual(["new", "old"]);
    expect(sortInstances(rows, "oldest").map((r) => r.id)).toEqual(["old", "new"]);
    expect(sortInstances(rows, "state").map((r) => r.id)).toEqual(["old", "new"]);
  });

  it("paginates and clamps the requested page", () => {
    const rows = Array.from({ length: 60 }, (_, index) => instance({ id: `i-${index}` }));
    const first = paginate(rows, 1);
    expect(first.items).toHaveLength(25);
    expect(first.totalPages).toBe(3);
    expect(first.total).toBe(60);
    const last = paginate(rows, 99);
    expect(last.page).toBe(3);
    expect(last.items).toHaveLength(10);
    expect(paginate([], 1).totalPages).toBe(1);
  });

  it("filters, sorts and paginates 10k instances well under the 500ms budget", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      instance({
        id: `perf-${index}`,
        state: index % 3 === 0 ? "FAILED" : "RUNNING",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }),
    );
    const started = performance.now();
    const filtered = filterInstances(rows, "FAILED", "", "newest");
    const page = paginate(filtered, 1);
    const elapsed = performance.now() - started;
    expect(page.total).toBe(3334);
    expect(page.items).toHaveLength(25);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("timeline, saga and safety helpers", () => {
  it("groups log rows into node cards preserving order", () => {
    const timeline = buildTimeline([
      log({ id: "1", nodeId: "start", action: "NODE_STARTED" }),
      log({ id: "2", nodeId: "approval", action: "NODE_STARTED" }),
      log({ id: "3", nodeId: "approval", action: "NODE_COMPLETED" }),
    ]);
    expect(timeline.map((node) => node.nodeId)).toEqual(["start", "approval"]);
    expect(timeline[1]?.events.map((event) => event.action)).toEqual([
      "NODE_STARTED",
      "NODE_COMPLETED",
    ]);
  });

  it("summarizes saga health", () => {
    const saga = {
      status: "FAILED",
      steps: [
        { status: "DEAD_LETTERED" },
        { status: "COMPENSATED" },
        { status: "COMPLETED" },
      ],
    } as SagaDto;
    expect(summarizeSaga(saga)).toEqual({
      status: "FAILED",
      steps: 3,
      deadLettered: 1,
      compensated: 1,
    });
    expect(summarizeSaga(null)).toBeNull();
    // A misconfigured proxy that answers [] must degrade to "no saga", not crash the view.
    expect(summarizeSaga([] as unknown as SagaDto)).toBeNull();
  });

  it("redacts emails and long digit sequences from log payloads", () => {
    const payload = '{"email":"ada@acme.com","card":"4111111111111111"}';
    const redacted = redactPayload(payload);
    expect(redacted).not.toContain("ada@acme.com");
    expect(redacted).not.toContain("4111111111111111");
    expect(redacted).toContain("[redacted-email]");
    expect(redacted).toContain("[redacted-number]");
    expect(redactPayload(null)).toBe("");
  });

  it("validates context JSON before any request", () => {
    expect(parseContextJson("")).toEqual({ ok: true, value: {} });
    expect(parseContextJson('{"amount":10}')).toEqual({ ok: true, value: { amount: 10 } });
    expect(parseContextJson("{bad").ok).toBe(false);
    expect(parseContextJson("[1,2]").error).toBe("not-object");
    expect(parseContextJson("null").error).toBe("not-object");
    expect(parseContextJson("x".repeat(CONTEXT_MAX_LENGTH + 1)).error).toBe("too-long");
  });

  it("issues unique idempotency keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });

  it("exports one CSV row per instance and escapes quotes", () => {
    const csv = toCsv(
      [instance({ id: 'a"b' }), instance({ id: "c" })],
      () => 'Expense "approval"',
    );
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("id,workflow,version,state,createdAt,updatedAt");
    expect(lines[1]).toContain('""approval""');
    expect(lines[1]).toContain('"a""b"');
  });
});
