"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import InstanceMonitor from "../../../components/instances/InstanceMonitor";
import { LoadingState } from "../../../components/ui/QueryState";

function InstanceMonitorRoute() {
  const params = useSearchParams();
  const workflow = params.get("workflow");
  // Keying the monitor re-seeds its local filter when the deep link changes.
  return <InstanceMonitor key={workflow ?? "all"} initialWorkflowId={workflow} />;
}

export default function InstancesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading workflow instances…" />}>
      <InstanceMonitorRoute />
    </Suspense>
  );
}
