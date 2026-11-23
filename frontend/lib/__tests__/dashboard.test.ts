import type { AnalyticsAggregateDto, TaskDto, WorkflowInstanceDto } from "../api";
import { needsAttention, recentActivity, slaRisk, trendSeries } from "../dashboard";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");

function task(overrides: Partial<TaskDto> & { id: string; title: string }): TaskDto {
  return {
    tenantId: "tenant-a",
    workflowInstanceId: "inst-1",
    description: null,
    assigneeId: "user-1",
    status: "ASSIGNED",
    version: 1,
    decisionComment: null,
    taskType: "APPROVAL",
    escalated: false,
    escalateAt: null,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("dashboard selectors", () => {
  it("orders open work by SLA and drops terminal tasks", () => {
    const rows = [
      task({ id: "later", title: "Later", escalateAt: "2026-11-23T12:00:00.000Z" }),
      task({ id: "done", title: "Done", status: "COMPLETED", escalateAt: "2026-11-01T12:00:00.000Z" }),
      task({ id: "soon", title: "Soon", escalateAt: "2026-11-22T13:00:00.000Z" }),
      task({ id: "none", title: "No SLA" }),
    ];

    expect(needsAttention(rows).map((row) => row.id)).toEqual(["soon", "later", "none"]);
    expect(needsAttention(rows, 2)).toHaveLength(2);
  });

  it("counts overdue, due-soon and unassigned work exactly once", () => {
    const rows = [
      task({ id: "a", title: "Overdue", escalateAt: "2026-11-22T11:00:00.000Z" }),
      task({ id: "b", title: "Due soon", escalateAt: "2026-11-23T11:00:00.000Z" }),
      task({ id: "c", title: "Unassigned", assigneeId: null }),
      task({ id: "d", title: "Done", status: "REJECTED", escalateAt: "2026-11-01T12:00:00.000Z" }),
    ];

    expect(slaRisk(rows, NOW)).toEqual({ overdue: 1, dueSoon: 1, unassigned: 1 });
  });

  it("aggregates the trend per day and keeps the last seven buckets", () => {
    const totals: AnalyticsAggregateDto[] = [
      { day: "2026-11-01", eventType: "A", count: 1, totalDurationMs: 0, averageDurationMs: 0 },
      { day: "2026-11-02", eventType: "A", count: 2, totalDurationMs: 0, averageDurationMs: 0 },
      { day: "2026-11-02", eventType: "B", count: 3, totalDurationMs: 0, averageDurationMs: 0 },
      ...Array.from({ length: 8 }, (_, index) => ({
        day: `2026-11-${String(index + 10).padStart(2, "0")}`,
        eventType: "A",
        count: 1,
        totalDurationMs: 0,
        averageDurationMs: 0,
      })),
    ];

    const points = trendSeries(totals);
    expect(points).toHaveLength(7);
    expect(points.at(-1)?.day).toBe("2026-11-17");
    expect(trendSeries(totals, 1)[0]).toEqual({ day: "2026-11-17", count: 1 });
    expect(trendSeries([], 7)).toEqual([]);
  });

  it("orders recent activity newest first", () => {
    const instances: WorkflowInstanceDto[] = [
      {
        id: "old",
        tenantId: "tenant-a",
        workflowDefinitionId: "wf-1",
        workflowVersion: 1,
        state: "COMPLETED",
        contextJson: "{}",
        idempotencyKey: null,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "new",
        tenantId: "tenant-a",
        workflowDefinitionId: "wf-1",
        workflowVersion: 1,
        state: "RUNNING",
        contextJson: "{}",
        idempotencyKey: null,
        createdAt: "2026-11-22T00:00:00.000Z",
      },
    ];

    expect(recentActivity(instances).map((row) => row.id)).toEqual(["new", "old"]);
  });
});
