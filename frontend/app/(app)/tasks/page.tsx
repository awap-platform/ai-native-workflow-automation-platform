"use client";

import { useState } from "react";
import type { TaskDto } from "../../../lib/api";
import { useTasks } from "../../../lib/hooks/resources";
import TaskDetail from "../../../components/tasks/TaskDetail";
import { EmptyState, ErrorState, LoadingState } from "../../../components/ui/QueryState";

export default function TasksPage() {
  const tasks = useTasks();
  const [selected, setSelected] = useState<TaskDto | null>(null);

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Tasks</h1>
      {selected ? <TaskDetail task={selected} onClose={() => setSelected(null)} /> : null}
      {tasks.isLoading ? <LoadingState label="Loading tasks…" /> : null}
      {tasks.isError ? (
        <ErrorState error={tasks.error} message="Failed to load tasks." />
      ) : null}
      {tasks.isSuccess && tasks.data.length === 0 ? (
        <EmptyState message="No tasks yet. New assignments appear here automatically." />
      ) : null}
      <ul className="awap-list" aria-label="Task inbox">
        {(tasks.data ?? []).map((task) => (
          <li key={task.id} className="awap-list-row">
            <button
              type="button"
              className="awap-link-button"
              onClick={() => setSelected(task)}
            >
              {task.title}
            </button>
            <span className="awap-muted">{task.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
