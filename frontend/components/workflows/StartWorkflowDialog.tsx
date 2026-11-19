"use client";

import { useState } from "react";
import { useStartWorkflow } from "../../lib/hooks/resources";

export default function StartWorkflowDialog({
  workflowId,
  onClose,
}: {
  workflowId: string;
  onClose: () => void;
}) {
  const [contextJson, setContextJson] = useState("{}");
  const [message, setMessage] = useState("");

  const start = useStartWorkflow();

  return (
    <section className="awap-card" aria-labelledby="start-workflow-heading">
      <h2 id="start-workflow-heading" className="awap-section-title">
        Start workflow
      </h2>
      <label className="awap-label">
        Workflow context JSON
        <textarea
          className="awap-textarea"
          value={contextJson}
          onChange={(event) => setContextJson(event.target.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="awap-button awap-button-primary"
          onClick={() =>
            start.mutate(
              { workflowDefinitionId: workflowId, contextJson },
              {
                onSuccess: onClose,
                onError: () => setMessage("Start failed"),
              },
            )
          }
          disabled={start.isPending}
        >
          Start
        </button>
        <button type="button" className="awap-button awap-button-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      {message ? (
        <p aria-live="polite" className="awap-alert awap-alert-danger">
          {message}
        </p>
      ) : null}
    </section>
  );
}
