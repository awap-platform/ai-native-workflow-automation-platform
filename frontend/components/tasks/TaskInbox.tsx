"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { errorStatus, runTaskAction, type TaskDto } from "../../lib/api";
import { useMyTasks, useTasks } from "../../lib/hooks/resources";
import { useIsMobile } from "../../lib/hooks/useIsMobile";
import { useI18n } from "../../lib/locale";
import { queryKeys } from "../../lib/queryKeys";
import { serverNow } from "../../lib/serverClock";
import { DEFAULT_INBOX_QUERY, filterTasks, inboxCounts, nextIndex, type InboxQuery } from "../../lib/tasks/inbox";
import { describeTaskError } from "../../lib/tasks/errors";
import {
  addSavedView,
  removeSavedView,
  savedViewsServerSnapshot,
  savedViewsSnapshot,
  subscribeSavedViews,
} from "../../lib/tasks/savedViews";
import { ConfirmDialog, useToast } from "../ui/overlays";
import { ForbiddenState } from "../ui/states";
import { ErrorState, LoadingState } from "../ui/QueryState";
import BulkActionBar, { type BulkActionKind } from "./BulkActionBar";
import TaskFilters from "./TaskFilters";
import TaskList from "./TaskList";
import TaskWorkItem, { type TaskWorkItemHandle } from "./TaskWorkItem";

interface TaskInboxProps {
  /** Deep link target (`/tasks?task=<id>`); mobile detail routes pass it too. */
  initialTaskId?: string | null;
  /** Mobile detail route renders the work item without the list. */
  detailOnly?: boolean;
}

const BULK_COPY: Record<BulkActionKind, { title: string; body: string }> = {
  approve: { title: "tasks.bulk.approveTitle", body: "tasks.bulk.approveBody" },
  complete: { title: "tasks.bulk.completeTitle", body: "tasks.bulk.completeBody" },
  claim: { title: "tasks.bulk.claimTitle", body: "tasks.bulk.claimBody" },
  assign: { title: "tasks.bulk.assignTitle", body: "tasks.bulk.assignBody" },
};

/**
 * Two-pane work inbox. Desktop shows list and detail side by side; below `lg` the list stays here
 * and a row tap opens `/tasks/[id]`, so the split never squeezes into an unusable column (R3-07).
 */
export default function TaskInbox({ initialTaskId = null, detailOnly = false }: TaskInboxProps) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const tasksQuery = useTasks();
  const myTasksQuery = useMyTasks();

  const [query, setQuery] = useState<InboxQuery>(DEFAULT_INBOX_QUERY);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const savedViews = useSyncExternalStore(
    subscribeSavedViews,
    savedViewsSnapshot,
    savedViewsServerSnapshot,
  );
  const [now, setNow] = useState(() => serverNow());
  const [bulkPending, setBulkPending] = useState<{ kind: BulkActionKind; assigneeId?: string } | null>(
    null,
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkRunning = useRef(false);
  const workItemRef = useRef<TaskWorkItemHandle>(null);

  // Server-aligned clock tick: SLA chips and the overdue filter stay honest without a refetch.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const allTasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const myTasks = useMemo(() => myTasksQuery.data ?? [], [myTasksQuery.data]);

  const source = query.filter === "mine" ? myTasks : allTasks;
  const rows = useMemo(
    () => filterTasks(source, query, now),
    [source, query, now],
  );
  const counts = useMemo(() => {
    const base = inboxCounts(allTasks, now);
    return { ...base, mine: myTasks.length };
  }, [allTasks, myTasks.length, now]);

  const selected = useMemo(
    () => allTasks.find((task) => task.id === selectedId) ?? myTasks.find((task) => task.id === selectedId) ?? null,
    [allTasks, myTasks, selectedId],
  );

  const reload = useCallback(() => {
    void tasksQuery.refetch();
    void myTasksQuery.refetch();
  }, [tasksQuery, myTasksQuery]);

  const selectTask = useCallback(
    (task: TaskDto) => {
      if (detailOnly) {
        return;
      }
      if (isMobile) {
        router.push(`/tasks/${task.id}`);
        return;
      }
      setSelectedId(task.id);
    },
    [detailOnly, isMobile, router],
  );

  // J/K move the cursor, Enter focuses the detail heading, A/R open the decision confirmation.
  useEffect(() => {
    if (detailOnly) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      const index = rows.findIndex((row) => row.id === selectedId);
      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        const next = rows[nextIndex(index < 0 ? -1 : index, 1, rows.length)];
        if (next) {
          setSelectedId(next.id);
        }
      } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        const previous = rows[nextIndex(index < 0 ? 0 : index, -1, rows.length)];
        if (previous) {
          setSelectedId(previous.id);
        }
      } else if (event.key === "Enter" && selected) {
        event.preventDefault();
        workItemRef.current?.focus();
      } else if ((event.key === "a" || event.key === "A") && selected) {
        event.preventDefault();
        workItemRef.current?.requestDecision("approve");
      } else if ((event.key === "r" || event.key === "R") && selected) {
        event.preventDefault();
        workItemRef.current?.requestDecision("reject");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailOnly, rows, selected, selectedId]);

  function toggleCheck(id: string) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setCheckedIds((current) => {
      const allChecked = rows.length > 0 && rows.every((row) => current.has(row.id));
      return allChecked ? new Set<string>() : new Set(rows.map((row) => row.id));
    });
  }

  async function runBulk(kind: BulkActionKind, assigneeId?: string) {
    if (bulkRunning.current) {
      return;
    }
    bulkRunning.current = true;
    setBulkBusy(true);
    const targets = rows.filter((row) => checkedIds.has(row.id));
    const failed = new Map<string, string>();
    let succeeded = 0;
    for (const target of targets) {
      try {
        await runTaskAction({
          id: target.id,
          action: kind,
          ...(assigneeId ? { assigneeId } : {}),
        });
        succeeded += 1;
      } catch (error) {
        const description = describeTaskError(error);
        failed.set(target.id, t(description.messageKey));
      }
    }
    bulkRunning.current = false;
    setBulkBusy(false);
    setBulkPending(null);
    setCheckedIds(new Set(failed.keys()));
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    toast({
      title: t("tasks.bulk.resultTitle"),
      description: t("tasks.bulk.resultBody", {
        succeeded: String(succeeded),
        failed: String(failed.size),
      }),
      variant: failed.size > 0 ? "danger" : "success",
    });
    if (failed.size > 0) {
      const firstFailure = [...failed.values()][0];
      if (firstFailure) {
        toast({ title: t("tasks.bulk.partialTitle"), description: firstFailure, variant: "danger" });
      }
    }
  }

  const error = tasksQuery.error;
  const status = errorStatus(error);
  const loading = tasksQuery.isLoading || (query.filter === "mine" && myTasksQuery.isLoading);

  if (detailOnly) {
    if (!selected) {
      return (
        <div className="awap-card grid gap-2" data-testid="task-missing">
          <p className="font-semibold">{t("tasks.detail.missingTitle")}</p>
          <p className="text-sm awap-muted">{t("tasks.detail.missingBody")}</p>
          <button type="button" className="awap-link-button" onClick={() => router.push("/tasks")}>
            {t("tasks.detail.backToList")}
          </button>
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        <button type="button" className="awap-link-button text-sm" onClick={() => router.push("/tasks")}>
          ← {t("tasks.detail.backToList")}
        </button>
        <TaskWorkItem task={selected} now={now} onReload={reload} />
      </div>
    );
  }

  // The page heading renders for every state: a 404/403 must still show where the user is.
  const inboxBody = loading ? (
    <LoadingState label={t("tasks.loading")} />
  ) : status === 403 ? (
    <ForbiddenState message={t("tasks.forbidden")} />
  ) : tasksQuery.isError ? (
    <ErrorState error={error} message={t("tasks.loadFailed")} onRetry={reload} />
  ) : (
    <>
      <TaskFilters
        query={query}
        counts={counts}
        savedViews={savedViews}
        onChange={setQuery}
        onSaveView={(name) => addSavedView(name, query)}
        onApplyView={(view) => setQuery(view.query)}
        onDeleteView={(id) => removeSavedView(id)}
      />

      <BulkActionBar
        count={checkedIds.size}
        busy={bulkBusy}
        onClear={() => setCheckedIds(new Set())}
        onAction={(kind, assigneeId) =>
          setBulkPending(assigneeId === undefined ? { kind } : { kind, assigneeId })
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <TaskList
          rows={rows}
          now={now}
          selectedId={selectedId}
          checkedIds={checkedIds}
          onSelect={selectTask}
          onToggleCheck={toggleCheck}
          onToggleAll={toggleAll}
        />
        <div className="hidden lg:block">
          {selected ? (
            <TaskWorkItem ref={workItemRef} task={selected} now={now} onReload={reload} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="awap-card text-sm awap-muted" data-testid="task-detail-empty">
              {t("tasks.detail.selectHint")}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="grid gap-4" data-testid="task-inbox">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="awap-page-title">{t("tasks.title")}</h1>
        <p className="text-sm awap-muted">{t("tasks.subtitle", { count: String(counts.total) })}</p>
      </div>

      {inboxBody}

      <ConfirmDialog
        open={bulkPending !== null}
        onOpenChange={(open) => (open ? undefined : setBulkPending(null))}
        title={bulkPending ? t(BULK_COPY[bulkPending.kind].title) : ""}
        description={bulkPending ? t(BULK_COPY[bulkPending.kind].body, { count: String(checkedIds.size) }) : ""}
        confirmLabel={t("tasks.confirm.confirm")}
        cancelLabel={t("tasks.confirm.cancel")}
        danger={bulkPending?.kind === "approve"}
        onConfirm={() => {
          if (bulkPending) {
            void runBulk(bulkPending.kind, bulkPending.assigneeId);
          }
        }}
      />
    </div>
  );
}
