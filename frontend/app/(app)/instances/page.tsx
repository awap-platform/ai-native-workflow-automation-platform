"use client";

import { EmptyState, ErrorState, LoadingState } from "../../../components/ui/QueryState";
import { useWorkflowInstances } from "../../../lib/hooks/resources";

const stateClass: Record<string, string> = {
  COMPLETED: "awap-state-completed",
  FAILED: "awap-state-failed",
  RUNNING: "awap-state-running",
  WAITING: "awap-state-waiting",
  CANCELLED: "awap-state-cancelled",
};

/** Live instance monitor. Polling stays here because staleness matters more than request volume. */
export default function InstancesPage() {
  const instances = useWorkflowInstances({ refetchInterval: 5000 });

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Workflow Instances</h1>
      {instances.isLoading ? <LoadingState label="Loading workflow instances…" /> : null}
      {instances.isError ? (
        <ErrorState error={instances.error} message="Failed to load workflow instances." />
      ) : null}
      {instances.isSuccess && instances.data.length === 0 ? (
        <EmptyState message="No workflow instances yet." />
      ) : null}
      <ul className="awap-list" aria-label="Workflow instances">
        {(instances.data ?? []).map((instance) => (
          <li key={instance.id} className="awap-list-row">
            <span className="font-mono text-xs">{instance.workflowDefinitionId}</span>
            <span className={`awap-state ${stateClass[instance.state] ?? ""}`}>
              {instance.state}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
