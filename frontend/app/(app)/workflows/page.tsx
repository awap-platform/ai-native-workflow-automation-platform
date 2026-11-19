"use client";

import { useState } from "react";
import type { WorkflowDefinitionDto } from "../../../lib/api";
import { useWorkflowDefinitions } from "../../../lib/hooks/resources";
import StartWorkflowDialog from "../../../components/workflows/StartWorkflowDialog";
import { EmptyState, ErrorState, LoadingState } from "../../../components/ui/QueryState";

export default function WorkflowsPage() {
  const workflows = useWorkflowDefinitions();
  const [starting, setStarting] = useState<WorkflowDefinitionDto | null>(null);

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Workflows</h1>
      {starting ? (
        <StartWorkflowDialog workflowId={starting.id} onClose={() => setStarting(null)} />
      ) : null}
      {workflows.isLoading ? <LoadingState label="Loading workflows…" /> : null}
      {workflows.isError ? (
        <ErrorState error={workflows.error} message="Failed to load workflows." />
      ) : null}
      {workflows.isSuccess && workflows.data.length === 0 ? (
        <EmptyState message="No workflows yet. Create a draft in the Designer." />
      ) : null}
      <ul className="awap-list" aria-label="Workflow definitions">
        {(workflows.data ?? []).map((workflow) => (
          <li key={workflow.id} className="awap-list-row">
            <span>
              {workflow.name}{" "}
              <span className="awap-muted">
                {workflow.status} (v{workflow.currentVersion})
              </span>
            </span>
            {workflow.status === "PUBLISHED" ? (
              <button
                type="button"
                className="awap-button"
                onClick={() => setStarting(workflow)}
              >
                Start
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
