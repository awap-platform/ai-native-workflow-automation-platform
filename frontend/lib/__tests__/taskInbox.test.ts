import type { TaskDto } from "../api";
import {
  DEFAULT_INBOX_QUERY,
  filterTasks,
  formatSlaRemaining,
  inboxCounts,
  isOverdue,
  matchesFilter,
  nextIndex,
  slaRemainingMs,
  slaState,
  sortTasks,
  taskTimeline,
  taskVariables,
  virtualWindow,
} from "../tasks/inbox";

const NOW = Date.parse("2026-11-20T12:00:00Z");

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "task-1",
    tenantId: "tenant-a",
    workflowInstanceId: null,
    title: "Approve expense",
    description: "Q4 report",
    assigneeId: "user-1",
    status: "ASSIGNED",
    version: 1,
    decisionComment: null,
    taskType: "APPROVAL",
    escalated: false,
    escalateAt: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

describe("SLA boundaries", () => {
  it("returns null without a server deadline", () => {
    expect(slaRemainingMs(task(), NOW)).toBeNull();
    expect(slaState(task(), NOW)).toBe("none");
  });

  it("warns exactly at the fifteen minute boundary and breaches one millisecond later", () => {
    const atBoundary = task({ escalateAt: "2026-11-20T12:15:00Z" });
    expect(slaRemainingMs(atBoundary, NOW)).toBe(15 * 60 * 1000);
    expect(slaState(atBoundary, NOW)).toBe("warning");

    const justInside = task({ escalateAt: "2026-11-20T12:15:00.001Z" });
    expect(slaState(justInside, NOW)).toBe("ok");

    const breached = task({ escalateAt: "2026-11-20T11:59:59.999Z" });
    expect(slaRemainingMs(breached, NOW)).toBe(-1);
    expect(slaState(breached, NOW)).toBe("breached");
    expect(isOverdue(breached, NOW)).toBe(true);
  });

  it("does not call a closed task overdue even with a past deadline", () => {
    const closed = task({ status: "APPROVED", escalateAt: "2026-11-19T12:00:00Z" });
    expect(isOverdue(closed, NOW)).toBe(false);
    expect(slaState(closed, NOW)).toBe("none");
  });

  it("formats remaining and overdue durations", () => {
    expect(formatSlaRemaining(135 * 60 * 1000)).toBe("2h 15m");
    expect(formatSlaRemaining(45 * 1000)).toBe("45s");
    expect(formatSlaRemaining(-3 * 60 * 60 * 1000)).toBe("overdue 3h 0m");
  });
});

describe("filters and search", () => {
  const rows = [
    task({ id: "a", status: "OPEN", assigneeId: null, title: "Unassigned invoice" }),
    task({ id: "b", status: "ASSIGNED", title: "Expense report" }),
    task({ id: "c", status: "APPROVED", title: "Completed contract", completedAt: NOW as unknown as string }),
    task({
      id: "d",
      status: "IN_PROGRESS",
      title: "Overdue onboarding",
      escalateAt: "2026-11-20T09:00:00Z",
    }),
  ];

  it("selects open, closed, mine, unassigned and overdue rows", () => {
    // The default SLA sort puts the breached deadline first and rows without one last.
    expect(filterTasks(rows, { ...DEFAULT_INBOX_QUERY, filter: "open" }, NOW).map((r) => r.id)).toEqual([
      "d",
      "b",
      "a",
    ]);
    expect(filterTasks(rows, { ...DEFAULT_INBOX_QUERY, filter: "completed" }, NOW).map((r) => r.id)).toEqual([
      "c",
    ]);
    expect(
      filterTasks(rows, { ...DEFAULT_INBOX_QUERY, filter: "mine" }, NOW, "user-1").map((r) => r.id),
    ).toEqual(["d", "c", "b"]);
    expect(
      filterTasks(rows, { ...DEFAULT_INBOX_QUERY, filter: "unassigned" }, NOW).map((r) => r.id),
    ).toEqual(["a"]);
    expect(filterTasks(rows, { ...DEFAULT_INBOX_QUERY, filter: "overdue" }, NOW).map((r) => r.id)).toEqual([
      "d",
    ]);
  });

  it("matches the search against title, description and status case-insensitively", () => {
    const result = filterTasks(rows, { ...DEFAULT_INBOX_QUERY, search: "invoice" }, NOW);
    expect(result.map((r) => r.id)).toEqual(["a"]);
    expect(
      filterTasks(rows, { ...DEFAULT_INBOX_QUERY, filter: "completed", search: "approved" }, NOW).map(
        (r) => r.id,
      ),
    ).toEqual(["c"]);
  });

  it("treats an empty mine filter without a user as no match", () => {
    expect(matchesFilter(rows[1]!, "mine", NOW, null)).toBe(false);
    expect(matchesFilter(rows[1]!, "mine", NOW, "user-1")).toBe(true);
  });
});

describe("sorting", () => {
  const rows = [
    task({ id: "b", title: "Beta", createdAt: "2026-11-20T09:00:00Z" }),
    task({ id: "a", title: "Alpha", createdAt: "2026-11-20T11:00:00Z" }),
    task({ id: "c", title: "Gamma", escalateAt: "2026-11-20T10:00:00Z" }),
  ];

  it("sorts by newest created first without mutating the input", () => {
    const snapshot = [...rows];
    expect(sortTasks(rows, "created").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(rows).toEqual(snapshot);
  });

  it("puts the nearest deadline first and rows without a deadline last", () => {
    expect(sortTasks(rows, "sla").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by title and status deterministically", () => {
    expect(sortTasks(rows, "title").map((r) => r.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortTasks(rows, "status").length).toBe(3);
  });
});

describe("counters, cursor and virtual window", () => {
  const rows = [
    task({ id: "a", status: "OPEN", assigneeId: null }),
    task({ id: "b", status: "APPROVED", assigneeId: "user-1" }),
    task({ id: "c", status: "IN_PROGRESS", escalateAt: "2026-11-20T09:00:00Z" }),
  ];

  it("counts each inbox bucket", () => {
    expect(inboxCounts(rows, NOW, "user-1")).toEqual({
      total: 3,
      open: 2,
      completed: 1,
      mine: 2,
      unassigned: 1,
      overdue: 1,
    });
  });

  it("clamps the keyboard cursor", () => {
    expect(nextIndex(-1, 1, 3)).toBe(0);
    expect(nextIndex(0, 1, 3)).toBe(1);
    expect(nextIndex(2, 1, 3)).toBe(2);
    expect(nextIndex(0, -1, 3)).toBe(0);
    expect(nextIndex(0, 1, 0)).toBe(0);
  });

  it("renders only the visible slice of a large inbox", () => {
    const window = virtualWindow(1000, 0, 600, 48);
    expect(window.start).toBe(0);
    expect(window.end).toBeLessThan(30);
    expect(window.bottomPadding).toBeGreaterThan(40000);

    const middle = virtualWindow(1000, 2400, 600, 48);
    expect(middle.start).toBe(44);
    expect(middle.topPadding).toBe(44 * 48);
    expect(middle.end).toBeGreaterThan(56);
  });
});

describe("task detail derivations", () => {
  it("builds a timeline only from recorded server fields", () => {
    const item = task({
      status: "REJECTED",
      escalated: true,
      escalateAt: "2026-11-20T11:00:00Z",
      completedAt: "2026-11-20T11:30:00Z",
      decisionComment: "Missing receipt",
    });
    const timeline = taskTimeline(item);
    expect(timeline.map((entry) => entry.id)).toEqual(["created", "assigned", "escalated", "completed"]);
    expect(timeline.at(-1)?.description).toBe("Missing receipt");
  });

  it("lists the variables the contract actually carries", () => {
    const names = taskVariables(task({ workflowInstanceId: "inst-1" })).map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining(["Task ID", "Tenant", "Type", "Status", "Version", "Workflow instance"]),
    );
  });
});
