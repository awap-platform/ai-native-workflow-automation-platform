"use client";

import { useParams } from "next/navigation";
import TaskInbox from "../../../../components/tasks/TaskInbox";

/**
 * Mobile work-item route (risk R3-07). Below the `lg` breakpoint the list links here instead of
 * squeezing a split pane into one column; the inbox component renders the list/detail switch.
 */
export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  return <TaskInbox detailOnly initialTaskId={params.id} />;
}
