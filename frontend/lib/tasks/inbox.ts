/**
 * Pure work-item inbox logic (UI/UX phase 3).
 *
 * Everything the inbox needs to decide what to show lives here: filter predicates, search,
 * deterministic sorting, SLA boundaries against server time, the virtual window and the keyboard
 * cursor. Keeping it free of React lets the boundary cases (T3-11, U3-09) be unit tested exactly.
 */

import type { TaskDto } from "../api";

export type TaskFilter = "open" | "completed" | "mine" | "unassigned" | "overdue";
export type TaskSort = "sla" | "created" | "title" | "status";

export const TASK_FILTERS: readonly TaskFilter[] = [
  "open",
  "completed",
  "mine",
  "unassigned",
  "overdue",
];

export const TASK_SORTS: readonly TaskSort[] = ["sla", "created", "title", "status"];

/** Statuses a user can still act on. */
export const OPEN_STATUSES: readonly string[] = ["OPEN", "ASSIGNED", "IN_PROGRESS"];
export const CLOSED_STATUSES: readonly string[] = [
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
];

/** A task inside the last quarter hour of its SLA is shown as a warning. */
export const SLA_WARNING_MS = 15 * 60 * 1000;

export interface InboxQuery {
  filter: TaskFilter;
  search: string;
  sort: TaskSort;
}

export const DEFAULT_INBOX_QUERY: InboxQuery = { filter: "open", search: "", sort: "sla" };

export type SlaState = "none" | "breached" | "warning" | "ok";

export function isOpenTask(task: TaskDto): boolean {
  return OPEN_STATUSES.includes(task.status);
}

export function isClosedTask(task: TaskDto): boolean {
  return CLOSED_STATUSES.includes(task.status);
}

/** Milliseconds until the server deadline; negative once breached; null when no SLA is set. */
export function slaRemainingMs(task: TaskDto, now: number): number | null {
  if (!task.escalateAt) {
    return null;
  }
  const deadline = Date.parse(task.escalateAt);
  if (Number.isNaN(deadline)) {
    return null;
  }
  return deadline - now;
}

export function isOverdue(task: TaskDto, now: number): boolean {
  const remaining = slaRemainingMs(task, now);
  return remaining !== null && remaining < 0 && isOpenTask(task);
}

export function slaState(task: TaskDto, now: number): SlaState {
  if (!isOpenTask(task)) {
    return "none";
  }
  const remaining = slaRemainingMs(task, now);
  if (remaining === null) {
    return "none";
  }
  if (remaining < 0) {
    return "breached";
  }
  return remaining <= SLA_WARNING_MS ? "warning" : "ok";
}

/** `2h 15m`, `45s` or `overdue 3h` — compact enough for a list row. */
export function formatSlaRemaining(remainingMs: number): string {
  const overdue = remainingMs < 0;
  const totalSeconds = Math.floor(Math.abs(remainingMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const body =
    hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return overdue ? `overdue ${body}` : body;
}

function matchesSearch(task: TaskDto, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [task.title, task.description ?? "", task.status, task.assigneeId ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function matchesFilter(
  task: TaskDto,
  filter: TaskFilter,
  now: number,
  currentUserId?: string | null,
): boolean {
  switch (filter) {
    case "open":
      return isOpenTask(task);
    case "completed":
      return isClosedTask(task);
    case "mine":
      return Boolean(currentUserId) && task.assigneeId === currentUserId;
    case "unassigned":
      return task.assigneeId === null || task.assigneeId === undefined;
    case "overdue":
      return isOverdue(task, now);
  }
}

/** Filter, search, then sort. Sorting is stable and never mutates the input array. */
export function filterTasks(
  tasks: readonly TaskDto[],
  query: InboxQuery,
  now: number,
  currentUserId?: string | null,
): TaskDto[] {
  const filtered = tasks.filter(
    (task) => matchesFilter(task, query.filter, now, currentUserId) && matchesSearch(task, query.search),
  );
  return sortTasks(filtered, query.sort);
}

export function sortTasks(tasks: readonly TaskDto[], sort: TaskSort): TaskDto[] {
  const rows = [...tasks];
  switch (sort) {
    case "title":
      return rows.sort((a, b) => a.title.localeCompare(b.title));
    case "status":
      return rows.sort(
        (a, b) => a.status.localeCompare(b.status) || a.title.localeCompare(b.title),
      );
    case "created":
      return rows.sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
    case "sla":
      // Tasks without a deadline sort last; breached deadlines come first.
      return rows.sort((a, b) => {
        const left = deadlineValue(a);
        const right = deadlineValue(b);
        if (left === right) {
          return a.title.localeCompare(b.title);
        }
        return left - right;
      });
  }
}

function timestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function deadlineValue(task: TaskDto): number {
  const parsed = timestamp(task.escalateAt);
  return parsed === 0 ? Number.MAX_SAFE_INTEGER : parsed;
}

export interface InboxCounts {
  total: number;
  open: number;
  completed: number;
  mine: number;
  unassigned: number;
  overdue: number;
}

export function inboxCounts(
  tasks: readonly TaskDto[],
  now: number,
  currentUserId?: string | null,
): InboxCounts {
  return {
    total: tasks.length,
    open: tasks.filter((task) => isOpenTask(task)).length,
    completed: tasks.filter((task) => isClosedTask(task)).length,
    mine: currentUserId ? tasks.filter((task) => task.assigneeId === currentUserId).length : 0,
    unassigned: tasks.filter((task) => !task.assigneeId).length,
    overdue: tasks.filter((task) => isOverdue(task, now)).length,
  };
}

/* ------------------------------------------------------------------ keyboard */

/** J/K cursor movement; clamps instead of wrapping so the list never jumps unexpectedly. */
export function nextIndex(current: number, delta: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  const candidate = current + delta;
  if (candidate < 0) {
    return 0;
  }
  if (candidate > length - 1) {
    return length - 1;
  }
  return candidate;
}

/* -------------------------------------------------------------- virtual list */

export interface VirtualWindow {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
}

/**
 * Fixed-height windowing: renders `overscan` extra rows above and below the viewport so a
 * 1000-row inbox stays under a millisecond of DOM work (risk R3-04).
 */
export function virtualWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): VirtualWindow {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, topPadding: 0, bottomPadding: 0 };
  }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return {
    start,
    end,
    topPadding: start * rowHeight,
    bottomPadding: Math.max(0, (total - end) * rowHeight),
  };
}

/* -------------------------------------------------------------------- derived */

export function isDecidable(task: TaskDto): boolean {
  return task.status === "ASSIGNED" || task.status === "IN_PROGRESS";
}

export function isCompletable(task: TaskDto): boolean {
  return task.status === "ASSIGNED" || task.status === "IN_PROGRESS";
}

export function isClaimable(task: TaskDto): boolean {
  return !task.assigneeId && isOpenTask(task);
}

export function isEscalatable(task: TaskDto): boolean {
  return task.status !== "COMPLETED" && task.status !== "CANCELLED";
}

export interface TaskTimelineItem {
  id: string;
  title: string;
  time: string;
  description?: string;
}

/**
 * Timeline from the recorded server fields. The API has no separate audit stream, so this only
 * states facts the task carries — it never fabricates intermediate transitions.
 */
export function taskTimeline(task: TaskDto): TaskTimelineItem[] {
  const items: TaskTimelineItem[] = [];
  if (task.createdAt) {
    items.push({ id: "created", title: "Created", time: task.createdAt });
  }
  if (task.assigneeId && task.updatedAt) {
    items.push({
      id: "assigned",
      title: task.escalated ? "Reassigned by escalation" : "Assigned",
      time: task.updatedAt,
      description: `Assignee ${task.assigneeId}`,
    });
  }
  if (task.escalated && task.escalateAt) {
    items.push({ id: "escalated", title: "Escalated", time: task.escalateAt });
  }
  if (task.completedAt) {
    const label =
      task.status === "APPROVED"
        ? "Approved"
        : task.status === "REJECTED"
          ? "Rejected"
          : task.status === "CANCELLED"
            ? "Cancelled"
            : "Completed";
    items.push({
      id: "completed",
      title: label,
      time: task.completedAt,
      ...(task.decisionComment ? { description: task.decisionComment } : {}),
    });
  }
  return items;
}

/** Variables a reviewer can see; the task contract has no free-form variable bag. */
export function taskVariables(task: TaskDto): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = [
    { name: "Task ID", value: task.id },
    { name: "Tenant", value: task.tenantId },
    { name: "Type", value: task.taskType ?? "GENERIC" },
    { name: "Status", value: task.status },
    { name: "Version", value: String(task.version) },
  ];
  if (task.workflowInstanceId) {
    entries.push({ name: "Workflow instance", value: task.workflowInstanceId });
  }
  if (task.assigneeId) {
    entries.push({ name: "Assignee", value: task.assigneeId });
  }
  return entries;
}
