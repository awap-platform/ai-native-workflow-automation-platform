"use client";

import Link from "next/link";
import { useState } from "react";
import { ConfirmationPanel } from "../../../../components/admin/ConfirmationPanel";
import { MutationAlert } from "../../../../components/admin/MutationAlert";
import { StatCard } from "../../../../components/admin/StatCard";
import { StatusBadge } from "../../../../components/admin/StatusBadge";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialState,
} from "../../../../components/ui/QueryState";
import type { AdminDlqDeliveryDto } from "../../../../lib/api";
import { useActiveTenant } from "../../../../lib/hooks/useActiveTenant";
import {
  useAdminDlq,
  useAdminOperate,
  useRetryAdminDlq,
} from "../../../../lib/hooks/resources";

export default function OperateConsolePage() {
  const tenantId = useActiveTenant();
  const operate = useAdminOperate(tenantId);
  const dlq = useAdminDlq(tenantId);
  const retry = useRetryAdminDlq();
  const [pendingRetry, setPendingRetry] = useState<AdminDlqDeliveryDto | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (operate.isLoading) {
    return <LoadingState label="Loading the operate console…" />;
  }
  if (operate.isError) {
    return (
      <ErrorState
        error={operate.error}
        message="Failed to load the operate console."
        forbiddenMessage="Only a tenant administrator can open the operate console."
      />
    );
  }
  const data = operate.data;
  if (!data) {
    return <ErrorState message="Failed to load the operate console." />;
  }

  return (
    <div className="awap-page">
      <div className="awap-card-header">
        <h1 className="awap-page-title">Operate console</h1>
        <Link href="/admin/audit" className="awap-button">
          Open audit log
        </Link>
      </div>
      <p className="awap-muted">
        Workflow, instance, task, outbox, dead-letter and scheduled-pipeline health for the active
        tenant.
      </p>

      {status ? (
        <p role="status" className="awap-alert awap-alert-success" data-testid="operate-status">
          {status}
        </p>
      ) : null}

      <div className="awap-grid">
        <StatCard
          label="Workflows"
          value={data.workflows.total}
          detail={`${data.workflows.published} published / ${data.workflows.draft} draft`}
          testId="operate-workflows"
        />
        <StatCard
          label="Instances"
          value={data.instances.total}
          detail={`${data.instances.running} running / ${data.instances.failed} failed / ${data.instances.completed} completed`}
          testId="operate-instances"
        />
        <StatCard
          label="Open tasks"
          value={data.tasks.open}
          detail={`${data.tasks.total} total / ${data.tasks.completed} completed`}
          testId="operate-tasks"
        />
        <StatCard
          label="Outbox pending"
          value={data.outbox.pending}
          detail={`${data.outbox.exhausted} exhausted`}
          testId="operate-outbox"
        />
        <StatCard
          label="Dead letters"
          value={data.dlq.failed}
          detail="terminally failed notification deliveries"
          testId="operate-dlq"
        />
      </div>

      <section className="awap-panel" aria-label="Scheduled pipeline health">
        <h2 className="awap-panel-title">Scheduled pipeline health</h2>
        <div className="awap-table-wrap">
          <table className="awap-table" data-testid="operate-jobs">
            <caption className="sr-only">Scheduled pipeline health</caption>
            <thead>
              <tr>
                <th scope="col">Pipeline</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((job) => (
                <tr key={job.name}>
                  <td>{job.name}</td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td>{job.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="awap-panel" aria-label="Dead-letter queue">
        <h2 className="awap-panel-title">Dead-letter queue</h2>
        <p className="awap-muted">
          Terminally failed notification deliveries. Kafka dead-letter records are quarantined to
          an operator file and are never re-published, so the retryable projection is the delivery
          queue.
        </p>
        {pendingRetry ? (
          <ConfirmationPanel
            id="operate-dlq-confirm"
            title="Retry dead-letter delivery?"
            description={`Re-queue the ${pendingRetry.channel} delivery to ${pendingRetry.recipient}. The retry scheduler will attempt delivery again, and the action is audited.`}
            confirmLabel="Retry delivery"
            busy={retry.isPending}
            onCancel={() => setPendingRetry(null)}
            onConfirm={() => {
              retry.mutate(
                { tenantId, deliveryId: pendingRetry.id },
                {
                  onSuccess: (result) => {
                    setStatus(`${result.detail} Status: ${result.status}.`);
                    setPendingRetry(null);
                  },
                },
              );
            }}
          />
        ) : null}
        <MutationAlert error={retry.error} action="Dead-letter retry" />
        {dlq.isError ? (
          <PartialState message="The dead-letter projection could not be loaded. The health cards above are still authoritative." />
        ) : dlq.isLoading ? (
          <p className="awap-muted">Loading dead letters…</p>
        ) : (dlq.data ?? []).length === 0 ? (
          <EmptyState message="The dead-letter queue is empty." testId="dlq-empty-state" />
        ) : (
          <div className="awap-table-wrap">
            <table className="awap-table" data-testid="dlq-table">
              <caption className="sr-only">Terminally failed notification deliveries</caption>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Template</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Last error</th>
                  <th scope="col">Created</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {(dlq.data ?? []).map((delivery) => (
                  <tr key={delivery.id} data-testid={`dlq-row-${delivery.id}`}>
                    <td>{delivery.channel}</td>
                    <td>{delivery.recipient}</td>
                    <td>{delivery.templateKey ?? "—"}</td>
                    <td>{delivery.attempts}</td>
                    <td>{delivery.lastError ?? "—"}</td>
                    <td>{delivery.createdAt}</td>
                    <td>
                      <button
                        type="button"
                        className="awap-button"
                        data-testid={`dlq-retry-${delivery.id}`}
                        onClick={() => setPendingRetry(delivery)}
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
