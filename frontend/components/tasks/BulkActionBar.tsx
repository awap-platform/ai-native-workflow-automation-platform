"use client";

import { useState } from "react";
import { useI18n } from "../../lib/locale";
import { Input } from "../ui/form-controls";

export type BulkActionKind = "approve" | "complete" | "claim" | "assign";

interface BulkActionBarProps {
  count: number;
  busy: boolean;
  onClear: () => void;
  onAction: (kind: BulkActionKind, assigneeId?: string) => void;
}

/**
 * Bulk toolbar. Individual actions still go through the per-task API in order, so one failing row
 * produces a partial report instead of a silently "successful" batch (U3-10).
 */
export default function BulkActionBar({ count, busy, onClear, onAction }: BulkActionBarProps) {
  const { t } = useI18n();
  const [assignee, setAssignee] = useState("");

  if (count === 0) {
    return null;
  }

  return (
    <div className="awap-card grid gap-2" role="region" aria-label={t("tasks.bulk.label")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" data-testid="task-bulk-count">
          {t("tasks.bulk.selected", { count: String(count) })}
        </p>
        <button type="button" className="awap-link-button text-sm" onClick={onClear}>
          {t("tasks.bulk.clear")}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="awap-button awap-button-primary min-h-11"
          onClick={() => onAction("approve")}
          disabled={busy}
          data-testid="task-bulk-approve"
        >
          {t("tasks.bulk.approve")}
        </button>
        <button
          type="button"
          className="awap-button min-h-11"
          onClick={() => onAction("complete")}
          disabled={busy}
          data-testid="task-bulk-complete"
        >
          {t("tasks.bulk.complete")}
        </button>
        <button
          type="button"
          className="awap-button min-h-11"
          onClick={() => onAction("claim")}
          disabled={busy}
          data-testid="task-bulk-claim"
        >
          {t("tasks.bulk.claim")}
        </button>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">{t("tasks.bulk.assignee")}</span>
          <Input
            value={assignee}
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(event) => setAssignee(event.target.value)}
            data-testid="task-bulk-assignee"
          />
        </label>
        <button
          type="button"
          className="awap-button min-h-11"
          onClick={() => onAction("assign", assignee.trim())}
          disabled={busy || assignee.trim() === ""}
          data-testid="task-bulk-assign"
        >
          {t("tasks.bulk.assign")}
        </button>
      </div>
    </div>
  );
}
