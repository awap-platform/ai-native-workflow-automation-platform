"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  errorStatus,
  correlationIdOf,
  type InstanceAction,
  type WorkflowInstanceDto,
} from "../../lib/api";
import {
  useCompensateSaga,
  useInstanceAction,
  useInstanceLogs,
  useInstanceSaga,
  useReplayDryRun,
  useReplayInstance,
  useRetrySagaStep,
  useWorkflowDefinitions,
  useWorkflowInstance,
} from "../../lib/hooks/resources";
import { formatUtcDateTime } from "../../lib/format";
import {
  buildTimeline,
  redactPayload,
  summarizeSaga,
} from "../../lib/workflows/catalogue";
import { Tabs } from "../ui/data-display";
import { ConfirmDialog, useToast } from "../ui/overlays";
import { EmptyState, ErrorState, LoadingState } from "../ui/QueryState";
import { Badge } from "../ui/surface";

interface PendingAction {
  kind: InstanceAction;
  title: string;
  body: string;
  danger: boolean;
}

const ACTION_COPY: Record<InstanceAction, { title: string; body: string; danger: boolean }> = {
  retry: {
    title: "Retry this instance?",
    body: "The engine resumes from the failed node. Side effects that already committed are not rolled back.",
    danger: false,
  },
  pause: { title: "Pause this instance?", body: "No new nodes advance until it is resumed.", danger: false },
  resume: { title: "Resume this instance?", body: "The engine continues from the current node.", danger: false },
  cancel: {
    title: "Cancel this instance?",
    body: "Cancellation is terminal. Running compensations are not started automatically.",
    danger: true,
  },
  fail: {
    title: "Fail this instance?",
    body: "Marks the instance FAILED so it can be retried or investigated. This is an operator action.",
    danger: true,
  },
  recover: {
    title: "Recover this instance?",
    body: "Re-runs the recovery path for a stuck instance using the recorded log.",
    danger: false,
  },
};

/**
 * Instance 360: state, timeline, variables, logs and saga with guarded operator actions.
 *
 * Replay always runs the dry-run projection first and only offers "Apply" when the projection
 * matched, so an operator cannot replay a divergent instance by accident (risk R4-04). Log payloads
 * are redacted before rendering or export (R4-05).
 */
export default function InstanceDetail({ id }: { id: string }) {
  const instance = useWorkflowInstance(id);
  const definitions = useWorkflowDefinitions();
  const logs = useInstanceLogs(id);
  const saga = useInstanceSaga(id);
  const action = useInstanceAction(id);
  const dryRun = useReplayDryRun(id);
  const applyReplay = useReplayInstance(id);
  const compensate = useCompensateSaga(id);
  const retryStep = useRetrySagaStep(id);
  const { toast } = useToast();
  const busy = useRef(false);
  const [tab, setTab] = useState("timeline");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [sagaPending, setSagaPending] = useState<"compensate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workflowName = useMemo(
    () =>
      (definitions.data ?? []).find((workflow) => workflow.id === instance.data?.workflowDefinitionId)
        ?.name ?? instance.data?.workflowDefinitionId,
    [definitions.data, instance.data?.workflowDefinitionId],
  );
  const timeline = useMemo(() => buildTimeline(logs.data ?? []), [logs.data]);
  const sagaSummary = summarizeSaga(saga.data);

  const status = errorStatus(instance.error);
  if (instance.isLoading) {
    return <LoadingState label="Loading instance…" />;
  }
  if (status === 404) {
    return (
      <div className="awap-card grid gap-2" data-testid="instance-missing">
        <p className="font-semibold">Instance not found</p>
        <p className="text-sm awap-muted">It may have been removed or belongs to another tenant.</p>
        <Link href="/instances" className="awap-link-button">
          Back to instances
        </Link>
      </div>
    );
  }
  if (status === 403) {
    return <ErrorState error={instance.error} message="Forbidden" forbiddenMessage="You do not have permission to view this instance." />;
  }
  if (instance.isError || !instance.data) {
    return (
      <ErrorState
        error={instance.error}
        message="Failed to load the instance."
        onRetry={() => void instance.refetch()}
      />
    );
  }

  const data: WorkflowInstanceDto = instance.data;
  const terminal = ["COMPLETED", "CANCELLED"].includes(data.state);
  const canPause = ["RUNNING", "WAITING"].includes(data.state);
  const canResume = data.state === "PAUSED";
  const canRetry = data.state === "FAILED";

  function runAction(next: PendingAction) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setError(null);
    action.mutate(next.kind, {
      onSuccess: () => {
        busy.current = false;
        setPending(null);
        toast({ title: "Action applied", description: `The instance is now ${next.kind === "retry" ? "running" : "updated"}.`, variant: "success" });
      },
      onError: (failure) => {
        busy.current = false;
        setPending(null);
        const code = errorStatus(failure);
        const correlation = correlationIdOf(failure);
        setError(
          code === 409
            ? "The engine rejected this transition because the instance changed. Reload and try again."
            : code === 403
              ? "You no longer have permission for this action."
              : `The action failed${correlation ? ` (reference ${correlation})` : ""}.`,
        );
      },
    });
  }

  function runReplay() {
    setError(null);
    dryRun.mutate(undefined, {
      onError: () => setError("Replay projection failed. Try again or check the instance logs."),
    });
  }

  function applyReplayNow() {
    applyReplay.mutate(undefined, {
      onSuccess: () =>
        toast({ title: "Replay applied", description: "The reference replay completed.", variant: "success" }),
      onError: () => setError("Replay failed. The instance was not changed."),
    });
  }

  function exportDetail() {
    const payload = {
      instance: data,
      logs: logs.data ?? [],
      saga: saga.data ?? null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `instance-${data.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const timelinePanel =
    timeline.length === 0 ? (
      <EmptyState message="No execution log rows were recorded for this instance." />
    ) : (
      <div className="grid gap-3">
        {timeline.map((node) => (
          <section key={node.nodeId} className="awap-card" aria-label={`Node ${node.nodeId}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{node.nodeId}</h3>
              <Badge variant="muted">{node.nodeType}</Badge>
            </div>
            <table className="awap-table mt-2">
              <caption className="sr-only">Node {node.nodeId} events</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Payload</th>
                </tr>
              </thead>
              <tbody>
                {node.events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.action}</td>
                    <td>{formatUtcDateTime(event.time)}</td>
                    <td className="font-mono text-xs break-all">{redactPayload(event.payload) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    );

  const variablesPanel = (
    <pre className="awap-card overflow-auto text-xs" data-testid="instance-context">
      {(() => {
        try {
          return JSON.stringify(JSON.parse(data.contextJson || "{}"), null, 2);
        } catch {
          return data.contextJson;
        }
      })()}
    </pre>
  );

  const logsPanel =
    (logs.data ?? []).length === 0 ? (
      <EmptyState message="No log rows." />
    ) : (
      <div className="overflow-x-auto">
        <table className="awap-table" aria-label="Execution log">
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Node</th>
              <th scope="col">Action</th>
              <th scope="col">Payload (redacted)</th>
            </tr>
          </thead>
          <tbody>
            {(logs.data ?? []).map((row) => (
              <tr key={row.id}>
                <td>{formatUtcDateTime(row.createdAt)}</td>
                <td>{row.nodeId ?? "—"}</td>
                <td>{row.action}</td>
                <td className="font-mono text-xs break-all">{redactPayload(row.payload) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const sagaPanel = saga.isError ? (
    <EmptyState message="No saga was recorded for this instance." />
  ) : saga.isLoading ? (
    <LoadingState label="Loading saga…" />
  ) : sagaSummary ? (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={sagaSummary.status === "COMPLETED" ? "success" : sagaSummary.deadLettered > 0 ? "danger" : "warning"}>
          {sagaSummary.status}
        </Badge>
        <span>{sagaSummary.steps} steps</span>
        <span className="awap-muted">{sagaSummary.compensated} compensated</span>
        <span className="awap-muted">{sagaSummary.deadLettered} dead-lettered</span>
        <button
          type="button"
          className="awap-button min-h-9 px-3 py-1 text-sm"
          onClick={() => setSagaPending("compensate")}
          disabled={compensate.isPending}
          data-testid="saga-compensate"
        >
          Compensate
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="awap-table" aria-label="Saga steps">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Node</th>
              <th scope="col">Action</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col">Last error</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(saga.data?.steps ?? []).map((step) => (
              <tr key={step.id}>
                <td>{step.stepOrder}</td>
                <td>{step.nodeId}</td>
                <td>{step.actionType}</td>
                <td>{step.status}</td>
                <td>
                  {step.attempts} / {step.maxAttempts}
                </td>
                <td className="text-xs">{step.lastError ? redactPayload(step.lastError) : "—"}</td>
                <td>
                  {step.status === "DEAD_LETTERED" ? (
                    <button
                      type="button"
                      className="awap-link-button text-sm"
                      onClick={() => retryStep.mutate(step.id)}
                      disabled={retryStep.isPending}
                    >
                      Retry step
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ) : (
    <EmptyState message="No saga was recorded for this instance." />
  );

  return (
    <div className="grid gap-3" data-testid="instance-detail">
      <Link href="/instances" className="awap-link-button text-sm">
        ← Back to instances
      </Link>

      <header className="awap-card grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="awap-page-title">Instance detail</h1>
            <p className="break-words font-semibold">{workflowName}</p>
            <p className="break-all font-mono text-xs awap-muted">{data.id}</p>
            <p className="mt-1 text-xs awap-muted">
              v{data.workflowVersion} · created {formatUtcDateTime(data.createdAt)} · updated{" "}
              {formatUtcDateTime(data.updatedAt)}
            </p>
            {data.parentInstanceId ? (
              <p className="text-xs">
                Parent:{" "}
                <Link href={`/instances/${data.parentInstanceId}`} className="awap-link-button">
                  {data.parentInstanceId}
                </Link>
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`awap-state awap-state-${data.state.toLowerCase()}`} data-testid="instance-state">
              {data.state}
            </span>
            <span className="text-xs awap-muted">Reference: {data.id.slice(0, 8)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canRetry ? (
            <button type="button" className="awap-button awap-button-primary min-h-11" onClick={() => setPending({ kind: "retry", ...ACTION_COPY.retry })} data-testid="instance-retry">
              Retry
            </button>
          ) : null}
          {canPause ? (
            <button type="button" className="awap-button min-h-11" onClick={() => setPending({ kind: "pause", ...ACTION_COPY.pause })} data-testid="instance-pause">
              Pause
            </button>
          ) : null}
          {canResume ? (
            <button type="button" className="awap-button min-h-11" onClick={() => setPending({ kind: "resume", ...ACTION_COPY.resume })} data-testid="instance-resume">
              Resume
            </button>
          ) : null}
          {!terminal ? (
            <button type="button" className="awap-button awap-button-danger min-h-11" onClick={() => setPending({ kind: "cancel", ...ACTION_COPY.cancel })} data-testid="instance-cancel">
              Cancel
            </button>
          ) : null}
          <button type="button" className="awap-button min-h-11" onClick={runReplay} disabled={dryRun.isPending} data-testid="instance-replay-preview">
            Replay (dry run)
          </button>
          <button type="button" className="awap-button min-h-11" onClick={exportDetail}>
            Export JSON
          </button>
        </div>

        {error ? (
          <div className="awap-alert awap-alert-danger" role="alert" data-testid="instance-error">
            {error}
          </div>
        ) : null}

        {dryRun.data ? (
          <div className="awap-card grid gap-2" data-testid="replay-report">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={dryRun.data.result === "MATCHED" ? "success" : "danger"}>{dryRun.data.result}</Badge>
              <span className="text-sm">
                {dryRun.data.logRows} log rows · {dryRun.data.durationMs} ms · hash {dryRun.data.stateHash.slice(0, 12)}
              </span>
            </div>
            {dryRun.data.divergences.length > 0 ? (
              <ul className="text-sm">
                {dryRun.data.divergences.map((divergence) => (
                  <li key={`${divergence.type}-${divergence.nodeId ?? "x"}`}>
                    {divergence.type} at {divergence.nodeId ?? "instance"}: {divergence.detail ?? "no detail"}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs awap-muted">
              A replay rewrites the projected state and is audited. Apply is only offered when the projection matched.
            </p>
            <button
              type="button"
              className="awap-button awap-button-primary min-h-11"
              disabled={dryRun.data.result !== "MATCHED" || applyReplay.isPending}
              onClick={applyReplayNow}
              data-testid="instance-replay-apply"
            >
              {applyReplay.isPending ? "Applying…" : "Apply replay"}
            </button>
          </div>
        ) : null}
      </header>

      <Tabs
        ariaLabel="Instance sections"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "timeline", label: "Timeline", content: timelinePanel },
          { value: "variables", label: "Variables", content: variablesPanel },
          { value: "logs", label: "Logs", content: logsPanel },
          { value: "saga", label: "Saga", content: sagaPanel },
        ]}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={pending?.title ?? ""}
        description={pending?.body ?? ""}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        danger={pending?.danger ?? false}
        onConfirm={() => {
          if (pending) {
            runAction(pending);
          }
        }}
      />

      <ConfirmDialog
        open={sagaPending === "compensate"}
        onOpenChange={(open) => (open ? undefined : setSagaPending(null))}
        title="Compensate this saga?"
        description="Dead-lettered steps reopen and reverse-order compensation resumes. Only do this after the external system is fixed."
        confirmLabel="Compensate"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          setSagaPending(null);
          compensate.mutate(undefined, {
            onSuccess: () => toast({ title: "Compensation started", variant: "success" }),
            onError: () => setError("Compensation failed. Check the saga steps and try again."),
          });
        }}
      />
    </div>
  );
}
