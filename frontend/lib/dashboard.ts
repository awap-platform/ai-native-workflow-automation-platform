import type { AnalyticsAggregateDto, TaskDto, WorkflowInstanceDto } from "./api";

/**
 * Pure dashboard selectors (issue 364). The page renders exactly what these functions return, so
 * "what needs attention" and the SLA counters can be unit-tested without a browser.
 */

const TERMINAL_TASK_STATES = new Set(["APPROVED", "COMPLETED", "REJECTED", "CANCELLED"]);

const DUE_SOON_MS = 24 * 60 * 60 * 1000;

function dueAt(task: TaskDto): number {
  const raw = task.escalateAt;
  if (!raw) {
    return Number.POSITIVE_INFINITY;
  }
  const value = Date.parse(raw);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** Open tasks ordered by the server-provided SLA, then title. */
export function needsAttention(tasks: readonly TaskDto[], limit = 5): TaskDto[] {
  return tasks
    .filter((task) => !TERMINAL_TASK_STATES.has(task.status))
    .slice()
    .sort((left, right) => {
      const byDue = dueAt(left) - dueAt(right);
      return byDue !== 0 ? byDue : left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

export interface SlaRisk {
  overdue: number;
  dueSoon: number;
  unassigned: number;
}

/** Counts the three SLA risks the dashboard surfaces. */
export function slaRisk(tasks: readonly TaskDto[], now: number): SlaRisk {
  const risk: SlaRisk = { overdue: 0, dueSoon: 0, unassigned: 0 };
  for (const task of tasks) {
    if (TERMINAL_TASK_STATES.has(task.status)) {
      continue;
    }
    if (!task.assigneeId) {
      risk.unassigned += 1;
    }
    const due = dueAt(task);
    if (due === Number.POSITIVE_INFINITY) {
      continue;
    }
    if (due < now) {
      risk.overdue += 1;
    } else if (due - now <= DUE_SOON_MS) {
      risk.dueSoon += 1;
    }
  }
  return risk;
}

export interface TrendPoint {
  day: string;
  count: number;
}

/** Aggregates event totals per day and keeps the most recent `days` buckets. */
export function trendSeries(totals: readonly AnalyticsAggregateDto[], days = 7): TrendPoint[] {
  const byDay = new Map<string, number>();
  for (const row of totals) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
  }
  return Array.from(byDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-days)
    .map(([day, count]) => ({ day, count }));
}

/** Most recently created instances first. */
export function recentActivity(
  instances: readonly WorkflowInstanceDto[],
  limit = 5,
): WorkflowInstanceDto[] {
  return instances
    .slice()
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    .slice(0, limit);
}
