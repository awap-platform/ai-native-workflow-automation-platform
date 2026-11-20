"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TaskInbox from "../../../components/tasks/TaskInbox";
import { LoadingState } from "../../../components/ui/QueryState";

function TaskInboxRoute() {
  const params = useSearchParams();
  return <TaskInbox initialTaskId={params.get("task")} />;
}

/**
 * `/tasks` is the inbox route. `useSearchParams` needs a Suspense boundary at the route level so
 * the static shell can render before the query string is known.
 */
export default function TasksPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading inbox…" />}>
      <TaskInboxRoute />
    </Suspense>
  );
}
