"use client";

import { Badge } from "../ui/surface";
import { useI18n } from "../../lib/locale";
import { formatSlaRemaining, slaRemainingMs, slaState } from "../../lib/tasks/inbox";
import type { TaskDto } from "../../lib/api";
import { cn } from "cn";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "muted";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  OPEN: "muted",
  ASSIGNED: "primary",
  IN_PROGRESS: "primary",
  APPROVED: "success",
  COMPLETED: "success",
  REJECTED: "danger",
  CANCELLED: "default",
};

export function TaskStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const key = `tasks.status.${status}`;
  const label = t(key);
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "default"} data-testid={`task-status-${status}`}>
      {label === key ? status.replaceAll("_", " ").toLowerCase() : label}
    </Badge>
  );
}

/**
 * SLA chip. The deadline is server-provided; `now` comes from the shared server clock so a skewed
 * workstation cannot turn a fresh task red (risk R3-05, U3-09).
 */
export function SlaChip({ task, now }: { task: TaskDto; now: number }) {
  const { t } = useI18n();
  const state = slaState(task, now);
  const remaining = slaRemainingMs(task, now);

  if (state === "none" || remaining === null) {
    return (
      <span className="text-xs awap-muted" data-testid="task-sla-none">
        {t("tasks.sla.none")}
      </span>
    );
  }

  const label =
    state === "breached"
      ? t("tasks.sla.overdue", { duration: formatSlaRemaining(remaining).replace("overdue ", "") })
      : t("tasks.sla.due", { duration: formatSlaRemaining(remaining) });

  return (
    <span
      className={cn(
        "text-xs font-semibold",
        state === "breached" ? "text-[var(--awap-danger)]" : state === "warning" ? "text-[var(--awap-warning)]" : "awap-muted",
      )}
      data-testid={`task-sla-${state}`}
    >
      {label}
    </span>
  );
}
