"use client";

import { useState } from "react";
import type { TaskDto } from "../../lib/api";
import { useDecideTask } from "../../lib/hooks/resources";

/**
 * Work item 360 view (form + decision + context). The decision is an
 * irreversible action, so both buttons stay explicit and the comment is visible
 * next to them.
 */
export default function TaskDetail({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const [comment, setComment] = useState("");
  const decide = useDecideTask();

  return (
    <section className="awap-card" aria-labelledby="task-detail-heading">
      <h2 id="task-detail-heading" className="awap-section-title">
        {task.title}
      </h2>
      <p>{task.description}</p>
      <p>
        Status: <strong>{task.status}</strong>
      </p>
      <label className="awap-label">
        Decision comment
        <textarea
          className="awap-textarea"
          value={comment}
          maxLength={2000}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="awap-button awap-button-primary"
          onClick={() =>
            decide.mutate({ id: task.id, approve: true, comment }, { onSuccess: onClose })
          }
          disabled={decide.isPending}
        >
          Approve
        </button>
        <button
          type="button"
          className="awap-button awap-button-danger"
          onClick={() =>
            decide.mutate({ id: task.id, approve: false, comment }, { onSuccess: onClose })
          }
          disabled={decide.isPending}
        >
          Reject
        </button>
        <button type="button" className="awap-button awap-button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}
