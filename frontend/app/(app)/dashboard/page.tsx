"use client";

import Link from "next/link";
import AccessSummary from "../../../components/onboarding/AccessSummary";
import { ErrorState, LoadingState } from "../../../components/ui/QueryState";
import { useTasks, useWorkflowInstances } from "../../../lib/hooks/resources";
import { useI18n } from "../../../lib/locale";

export default function DashboardPage() {
  const { tp } = useI18n();
  const tasks = useTasks();
  const instances = useWorkflowInstances();

  if (tasks.isLoading || instances.isLoading) {
    return <LoadingState label="Loading dashboard…" />;
  }
  if (tasks.isError) {
    return <ErrorState error={tasks.error} message="Failed to load tasks." />;
  }
  if (instances.isError) {
    return <ErrorState error={instances.error} message="Failed to load workflow instances." />;
  }

  const pendingTasks = tasks.data?.length ?? 0;
  const activeInstances = instances.data?.length ?? 0;

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Dashboard</h1>
      <AccessSummary />
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="awap-card" aria-labelledby="dashboard-tasks-heading">
          <h2 id="dashboard-tasks-heading" className="awap-section-title">
            My tasks
          </h2>
          <p className="awap-muted">Pending tasks</p>
          <p
            className="text-3xl font-bold"
            data-testid="dashboard-pending-tasks"
            // The visible value stays numeric; the accessible name is the plural-aware copy.
            aria-label={tp("tasks.count", pendingTasks)}
          >
            {pendingTasks}
          </p>
          <Link href="/tasks">Open inbox</Link>
        </section>
        <section className="awap-card" aria-labelledby="dashboard-instances-heading">
          <h2 id="dashboard-instances-heading" className="awap-section-title">
            Operations
          </h2>
          <p className="awap-muted">Active workflow instances</p>
          <p className="text-3xl font-bold" data-testid="dashboard-active-instances">
            {activeInstances}
          </p>
          <Link href="/instances">Open monitor</Link>
        </section>
      </div>
    </div>
  );
}
