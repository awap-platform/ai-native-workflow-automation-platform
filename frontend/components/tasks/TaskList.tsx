"use client";

import type { TaskDto } from "../../lib/api";
import { useI18n } from "../../lib/locale";
import { SlaChip, TaskStatusBadge } from "./TaskBadges";
import { Checkbox } from "../ui/form-controls";

interface TaskListProps {
  rows: TaskDto[];
  now: number;
  selectedId: string | null;
  checkedIds: ReadonlySet<string>;
  onSelect: (task: TaskDto) => void;
  onToggleCheck: (id: string) => void;
  onToggleAll: () => void;
}

/**
 * Inbox list. Rows carry `content-visibility: auto` (`.awap-task-row`), so the browser skips
 * layout and paint for offscreen rows; a 1000-row tenant stays interactive without a hand-rolled
 * virtual scroller or inline spacer heights (risk R3-04).
 */
export default function TaskList({
  rows,
  now,
  selectedId,
  checkedIds,
  onSelect,
  onToggleCheck,
  onToggleAll,
}: TaskListProps) {
  const { t } = useI18n();
  const allChecked = rows.length > 0 && rows.every((row) => checkedIds.has(row.id));

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Checkbox
          label={t("tasks.list.selectAll")}
          checked={allChecked}
          onChange={onToggleAll}
          disabled={rows.length === 0}
          data-testid="task-select-all"
        />
        <span className="text-xs awap-muted" data-testid="task-result-count">
          {t("tasks.list.count", { count: String(rows.length) })}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="awap-card text-sm awap-muted" data-testid="task-list-empty">
          {t("tasks.list.empty")}
        </p>
      ) : (
        <ul
          className="max-h-[min(64vh,720px)] overflow-y-auto pr-1"
          aria-label={t("tasks.list.label")}
          data-testid="task-list"
        >
          {rows.map((task) => {
            const selected = task.id === selectedId;
            const checked = checkedIds.has(task.id);
            return (
              <li
                key={task.id}
                className={`awap-task-row flex items-start gap-2 border-b border-border p-2 ${selected ? "bg-muted" : ""}`}
              >
                <Checkbox
                  label={t("tasks.list.selectRow", { title: task.title })}
                  checked={checked}
                  onChange={() => onToggleCheck(task.id)}
                  data-testid={`task-check-${task.id}`}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(task)}
                  data-testid={`task-row-${task.id}`}
                >
                  <span className="block truncate text-sm font-semibold">{task.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <TaskStatusBadge status={task.status} />
                    <SlaChip task={task} now={now} />
                  </span>
                  <span className="mt-1 block truncate text-xs awap-muted">
                    {task.assigneeId
                      ? t("tasks.list.assignedTo", { assignee: task.assigneeId })
                      : t("tasks.list.unassigned")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
