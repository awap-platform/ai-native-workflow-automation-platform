"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { TaskActionKind, TaskDto } from "../../lib/api";
import {
  useAddTaskComment,
  useAttachTaskFile,
  useTaskAction,
  useTaskActivity,
  useTaskAttachments,
} from "../../lib/hooks/resources";
import { useI18n } from "../../lib/locale";
import { formatUtcDateTime } from "../../lib/format";
import { clearDraft, DRAFT_LIMIT, loadDraft, saveDraft } from "../../lib/tasks/drafts";
import { describeTaskError } from "../../lib/tasks/errors";
import {
  isClaimable,
  isCompletable,
  isDecidable,
  isEscalatable,
  taskTimeline,
  taskVariables,
} from "../../lib/tasks/inbox";
import { Tabs, Timeline } from "../ui/data-display";
import { FormField, Input, Textarea } from "../ui/form-controls";
import { ConfirmDialog, useToast } from "../ui/overlays";
import { EmptyState, LoadingState } from "../ui/QueryState";
import { Card } from "../ui/surface";
import { SlaChip, TaskStatusBadge } from "./TaskBadges";

export interface TaskWorkItemHandle {
  /** Opens the confirmation for a decision, used by the J/K/A/R keyboard shortcuts. */
  requestDecision: (decision: "approve" | "reject") => void;
  focus: () => void;
}

interface PendingAction {
  kind: TaskActionKind;
  title: string;
  description: string;
  danger: boolean;
}

interface TaskWorkItemProps {
  task: TaskDto;
  now: number;
  onReload: () => void;
  onClose?: () => void;
}

/**
 * Work item 360: the context a reviewer needs plus every decision the API supports.
 *
 * Safety rules baked in here:
 * - each action is confirmed with copy that states the consequence (R3-02);
 * - a ref lock plus the mutation's pending state means a double click cannot send two requests
 *   (R3-01, T3-05);
 * - the decision comment is autosaved per task so a stray reload loses nothing (R3-06);
 * - failures are classified, translated and never re-shown as raw status codes (T3-06).
 */
const TaskWorkItem = forwardRef<TaskWorkItemHandle, TaskWorkItemProps>(function TaskWorkItem(
  { task, now, onReload, onClose },
  ref,
) {
  const { t } = useI18n();
  const { toast } = useToast();
  const action = useTaskAction();
  const activityQuery = useTaskActivity(task.id);
  const attachmentsQuery = useTaskAttachments(task.id);
  const addComment = useAddTaskComment(task.id);
  const attachFile = useAttachTaskFile(task.id);
  const [tab, setTab] = useState("context");
  const [comment, setComment] = useState("");
  const [newComment, setNewComment] = useState("");
  const [attachmentFileId, setAttachmentFileId] = useState("");
  const [collaborationError, setCollaborationError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const submitting = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setComment(loadDraft(task.id));
    setError(null);
    setPending(null);
  }, [task.id]);

  useImperativeHandle(ref, () => ({
    requestDecision(decision) {
      setTab("decision");
      openDecision(decision);
    },
    focus() {
      headingRef.current?.focus();
    },
  }));

  const timeline = useMemo(
    () =>
      taskTimeline(task).map((item) => ({
        id: item.id,
        title: item.title,
        time: formatUtcDateTime(item.time),
        ...(item.description ? { description: item.description } : {}),
      })),
    [task],
  );

  const variables = useMemo(() => taskVariables(task), [task]);

  function openDecision(decision: "approve" | "reject") {
    if (decision === "reject" && comment.trim() === "") {
      setError(t("tasks.error.commentRequired"));
      document.getElementById("task-decision-comment")?.focus();
      return;
    }
    setError(null);
    setPending(
      decision === "approve"
        ? {
            kind: "approve",
            title: t("tasks.confirm.approveTitle"),
            description: t("tasks.confirm.approveBody"),
            danger: false,
          }
        : {
            kind: "reject",
            title: t("tasks.confirm.rejectTitle"),
            description: t("tasks.confirm.rejectBody"),
            danger: true,
          },
    );
  }

  function openAction(kind: TaskActionKind) {
    const copy: Record<string, PendingAction> = {
      complete: {
        kind: "complete",
        title: t("tasks.confirm.completeTitle"),
        description: t("tasks.confirm.completeBody"),
        danger: false,
      },
      claim: {
        kind: "claim",
        title: t("tasks.confirm.claimTitle"),
        description: t("tasks.confirm.claimBody"),
        danger: false,
      },
      assign: {
        kind: "assign",
        title: t("tasks.confirm.assignTitle"),
        description: t("tasks.confirm.assignBody"),
        danger: false,
      },
      escalate: {
        kind: "escalate",
        title: t("tasks.confirm.escalateTitle"),
        description: t("tasks.confirm.escalateBody"),
        danger: true,
      },
    };
    const next = copy[kind];
    if (!next) {
      return;
    }
    if ((kind === "assign" || kind === "escalate") && assignee.trim() === "") {
      setError(t("tasks.error.assigneeRequired"));
      return;
    }
    setError(null);
    setPending(next);
  }

  async function submit(pendingAction: PendingAction) {
    if (submitting.current || action.isPending) {
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      await action.mutateAsync({
        id: task.id,
        action: pendingAction.kind,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(assignee.trim() ? { assigneeId: assignee.trim() } : {}),
      });
      clearDraft(task.id);
      setComment("");
      toast({
        title: t("tasks.toast.success"),
        description: t("tasks.toast.successBody"),
        variant: "success",
      });
      onClose?.();
    } catch (failure) {
      const description = describeTaskError(failure);
      setError(t(description.messageKey));
      toast({
        title: t("tasks.toast.failure"),
        description: t(description.messageKey),
        variant: "danger",
      });
    } finally {
      submitting.current = false;
      setPending(null);
    }
  }

  function onCommentChange(value: string) {
    const next = value.slice(0, DRAFT_LIMIT);
    setComment(next);
    saveDraft(task.id, next);
    if (error === t("tasks.error.commentRequired") && next.trim() !== "") {
      setError(null);
    }
  }

  const contextPanel = (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-semibold">{t("tasks.detail.contextHeading")}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm">
          {task.description?.trim() ? task.description : t("tasks.detail.noDescription")}
        </p>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="awap-muted">{t("tasks.detail.instance")}</dt>
        <dd className="break-all">{task.workflowInstanceId ?? t("tasks.detail.none")}</dd>
        <dt className="awap-muted">{t("tasks.detail.assignee")}</dt>
        <dd className="break-all">{task.assigneeId ?? t("tasks.detail.unassigned")}</dd>
        <dt className="awap-muted">{t("tasks.detail.created")}</dt>
        <dd>{formatUtcDateTime(task.createdAt)}</dd>
        <dt className="awap-muted">{t("tasks.detail.updated")}</dt>
        <dd>{formatUtcDateTime(task.updatedAt)}</dd>
        <dt className="awap-muted">{t("tasks.detail.deadline")}</dt>
        <dd>{formatUtcDateTime(task.escalateAt)}</dd>
      </dl>
    </div>
  );

  const decisionPanel = (
    <form
      className="grid gap-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (isDecidable(task)) {
          openDecision("approve");
        }
      }}
    >
      <FormField
        id="task-decision-comment"
        label={t("tasks.detail.comment")}
        hint={t("tasks.detail.commentHint", { limit: String(DRAFT_LIMIT) })}
      >
        <Textarea
          id="task-decision-comment"
          value={comment}
          maxLength={DRAFT_LIMIT}
          placeholder={t("tasks.detail.commentPlaceholder")}
          onChange={(event) => onCommentChange(event.target.value)}
          data-testid="task-comment"
        />
      </FormField>

      <FormField
        id="task-assignee"
        label={t("tasks.detail.assigneeInput")}
        hint={t("tasks.detail.assigneeHint")}
      >
        <Input
          id="task-assignee"
          value={assignee}
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(event) => setAssignee(event.target.value)}
          data-testid="task-assignee"
        />
      </FormField>

      {error ? (
        <div className="awap-alert awap-alert-danger" role="alert" data-testid="task-error">
          <p>{error}</p>
          <button type="button" className="awap-link-button mt-2" onClick={onReload}>
            {t("tasks.error.reload")}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {isDecidable(task) ? (
          <>
            <button
              type="button"
              className="awap-button awap-button-primary"
              onClick={() => openDecision("approve")}
              disabled={action.isPending}
              data-testid="task-approve"
            >
              {t("tasks.action.approve")}
            </button>
            <button
              type="button"
              className="awap-button awap-button-danger"
              onClick={() => openDecision("reject")}
              disabled={action.isPending}
              data-testid="task-reject"
            >
              {t("tasks.action.reject")}
            </button>
          </>
        ) : null}
        {isCompletable(task) ? (
          <button
            type="button"
            className="awap-button"
            onClick={() => openAction("complete")}
            disabled={action.isPending}
            data-testid="task-complete"
          >
            {t("tasks.action.complete")}
          </button>
        ) : null}
        {isClaimable(task) ? (
          <button
            type="button"
            className="awap-button"
            onClick={() => openAction("claim")}
            disabled={action.isPending}
            data-testid="task-claim"
          >
            {t("tasks.action.claim")}
          </button>
        ) : null}
        <button
          type="button"
          className="awap-button awap-button-ghost"
          onClick={() => openAction("assign")}
          disabled={action.isPending}
          data-testid="task-assign"
        >
          {task.assigneeId ? t("tasks.action.reassign") : t("tasks.action.assign")}
        </button>
        {isEscalatable(task) ? (
          <button
            type="button"
            className="awap-button awap-button-ghost"
            onClick={() => openAction("escalate")}
            disabled={action.isPending}
            data-testid="task-escalate"
          >
            {t("tasks.action.escalate")}
          </button>
        ) : null}
      </div>
      <p className="text-xs awap-muted">{t("tasks.detail.shortcuts")}</p>
    </form>
  );

  const historyPanel =
    timeline.length > 0 ? (
      <Timeline items={timeline} ariaLabel={t("tasks.detail.historyHeading")} />
    ) : (
      <EmptyState message={t("tasks.detail.noHistory")} />
    );

  const attachmentsPanel = (
    <div className="grid gap-3" data-testid="task-attachments">
      {attachmentsQuery.isLoading ? <LoadingState label="Loading attachments…" /> : null}
      {attachmentsQuery.data && attachmentsQuery.data.length === 0 ? (
        <EmptyState message={t("tasks.detail.noAttachments")} />
      ) : null}
      <ul className="grid gap-2">
        {(attachmentsQuery.data ?? []).map((attachment) => (
          <li key={attachment.id} className="awap-card flex flex-wrap items-center gap-2 text-sm">
            <span className="break-all">{attachment.fileName}</span>
            <span
              className={
                attachment.downloadable
                  ? "awap-badge awap-badge-success"
                  : "awap-badge awap-badge-warning"
              }
            >
              {attachment.scanStatus}
            </span>
            {!attachment.downloadable ? (
              <span className="text-xs awap-muted">Download unlocks after the scan is clean.</span>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setCollaborationError(null);
          if (attachmentFileId.trim() === "") {
            setCollaborationError("Enter a document file id to attach.");
            return;
          }
          attachFile.mutate(attachmentFileId.trim(), {
            onSuccess: () => setAttachmentFileId(""),
            onError: () => setCollaborationError("The file could not be attached."),
          });
        }}
      >
        <FormField
          id="task-attachment-file"
          label="Attach a document file"
          hint="Upload the file in Documents first, then paste its file id here."
        >
          <Input
            id="task-attachment-file"
            value={attachmentFileId}
            onChange={(event) => setAttachmentFileId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            data-testid="task-attachment-file"
          />
        </FormField>
        <button
          type="submit"
          className="awap-button"
          disabled={attachFile.isPending}
          data-testid="task-attach"
        >
          Attach file
        </button>
      </form>
      {collaborationError ? (
        <p role="alert" className="awap-error">
          {collaborationError}
        </p>
      ) : null}
    </div>
  );

  const activityPanel = (
    <div className="grid gap-3" data-testid="task-activity">
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setCollaborationError(null);
          if (newComment.trim() === "") {
            setCollaborationError("A comment cannot be empty.");
            return;
          }
          addComment.mutate(newComment.trim(), {
            onSuccess: () => setNewComment(""),
            onError: () => setCollaborationError("The comment could not be posted."),
          });
        }}
      >
        <FormField id="task-new-comment" label="Add a comment">
          <Textarea
            id="task-new-comment"
            value={newComment}
            maxLength={10_000}
            onChange={(event) => setNewComment(event.target.value)}
            data-testid="task-new-comment"
          />
        </FormField>
        <button
          type="submit"
          className="awap-button"
          disabled={addComment.isPending}
          data-testid="task-comment-submit"
        >
          Post comment
        </button>
      </form>
      {collaborationError ? (
        <p role="alert" className="awap-error">
          {collaborationError}
        </p>
      ) : null}
      {activityQuery.isLoading ? <LoadingState label="Loading activity…" /> : null}
      {activityQuery.data && activityQuery.data.length === 0 ? (
        <EmptyState message="No activity yet." />
      ) : null}
      <ol className="grid gap-2" data-testid="task-activity-list">
        {(activityQuery.data ?? []).map((entry) => (
          <li key={entry.id} className="awap-card grid gap-1 text-sm">
            <span className="text-xs awap-muted">
              {entry.kind} · {formatUtcDateTime(entry.createdAt)}
            </span>
            <span className="whitespace-pre-wrap">{entry.summary}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  const variablesPanel = (
    <dl
      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm"
      data-testid="task-variables"
    >
      {variables.map((entry) => (
        <div key={entry.name} className="contents">
          <dt className="awap-muted">{entry.name}</dt>
          <dd className="break-all">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <Card className="flex min-h-0 flex-col gap-3" data-testid="task-work-item">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="awap-section-title break-words outline-none"
            data-testid="task-detail-heading"
          >
            {task.title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <TaskStatusBadge status={task.status} />
            <span className="awap-muted">
              {t("tasks.detail.version", { version: String(task.version) })}
            </span>
            {task.escalated ? (
              <span className="text-[var(--awap-danger)]">{t("tasks.detail.escalated")}</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <SlaChip task={task} now={now} />
          {onClose ? (
            <button type="button" className="awap-link-button text-sm" onClick={onClose}>
              {t("tasks.detail.close")}
            </button>
          ) : null}
        </div>
      </header>

      <Tabs
        ariaLabel={t("tasks.detail.tabsLabel")}
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "context", label: t("tasks.tab.context"), content: contextPanel },
          { value: "decision", label: t("tasks.tab.decision"), content: decisionPanel },
          { value: "history", label: t("tasks.tab.history"), content: historyPanel },
          { value: "attachments", label: t("tasks.tab.attachments"), content: attachmentsPanel },
          { value: "activity", label: "Activity", content: activityPanel },
          { value: "variables", label: t("tasks.tab.variables"), content: variablesPanel },
        ]}
      />

      {action.isPending ? <LoadingState label={t("tasks.detail.saving")} /> : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={pending?.title ?? ""}
        description={pending?.description ?? ""}
        confirmLabel={t("tasks.confirm.confirm")}
        cancelLabel={t("tasks.confirm.cancel")}
        danger={pending?.danger ?? false}
        onConfirm={() => {
          if (pending) {
            void submit(pending);
          }
        }}
      />
    </Card>
  );
});

export default TaskWorkItem;
