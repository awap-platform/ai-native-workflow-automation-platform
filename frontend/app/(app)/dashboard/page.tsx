"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccessSummary from "../../../components/onboarding/AccessSummary";
import { useAnalyticsOverview, useTasks, useWorkflowInstances } from "../../../lib/hooks/resources";
import { needsAttention, recentActivity, slaRisk, trendSeries } from "../../../lib/dashboard";
import { useI18n } from "../../../lib/locale";
import { serverNow } from "../../../lib/serverClock";

/**
 * Dashboard (issue 364). Answers "what needs attention now?" with four widgets: a compact
 * pending-work list, SLA risk, recent activity and a seven-day trend. Each widget owns its
 * loading/empty/error state, so one failing API never blanks the whole page.
 */
export default function DashboardPage() {
  const { tp } = useI18n();
  const tasks = useTasks();
  const instances = useWorkflowInstances();
  const analytics = useAnalyticsOverview({ granularity: "DAY" });
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const taskRows = tasks.data ?? [];
  const instanceRows = instances.data ?? [];
  const pendingTasks = taskRows.length;
  const activeInstances = instanceRows.length;
  const attention = needsAttention(taskRows);
  const risk = slaRisk(taskRows, now);
  const trend = trendSeries(analytics.data?.dashboard.dailyTotals ?? []);
  const recent = recentActivity(instanceRows);
  const maxTrend = Math.max(1, ...trend.map((point) => point.count));
  const allEmpty =
    !tasks.isLoading &&
    !instances.isLoading &&
    !analytics.isLoading &&
    taskRows.length === 0 &&
    instanceRows.length === 0 &&
    trend.length === 0;

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Dashboard</h1>
      <AccessSummary />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section className="awap-card" aria-labelledby="dashboard-tasks-heading">
          <h2 id="dashboard-tasks-heading" className="awap-section-title">
            My tasks
          </h2>
          <p className="awap-muted">Pending tasks</p>
          <p
            className="text-3xl font-bold"
            data-testid="dashboard-pending-tasks"
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

        <section
          className="awap-card"
          aria-labelledby="dashboard-sla-heading"
          data-testid="dashboard-sla-risk"
        >
          <h2 id="dashboard-sla-heading" className="awap-section-title">
            SLA risk
          </h2>
          {tasks.isLoading ? (
            <p className="awap-muted">Loading SLA risk…</p>
          ) : tasks.isError ? (
            <p role="alert" className="awap-muted">
              SLA risk is unavailable right now.
            </p>
          ) : (
            <dl className="awap-dashboard__stats">
              <div>
                <dt>Overdue</dt>
                <dd data-testid="dashboard-sla-overdue">{risk.overdue}</dd>
              </div>
              <div>
                <dt>Due within 24h</dt>
                <dd data-testid="dashboard-sla-due-soon">{risk.dueSoon}</dd>
              </div>
              <div>
                <dt>Unassigned</dt>
                <dd data-testid="dashboard-sla-unassigned">{risk.unassigned}</dd>
              </div>
            </dl>
          )}
        </section>

        <section
          className="awap-card"
          aria-labelledby="dashboard-trend-heading"
          data-testid="dashboard-trend"
        >
          <h2 id="dashboard-trend-heading" className="awap-section-title">
            7-day trend
          </h2>
          {analytics.isLoading ? (
            <p className="awap-muted">Loading trend…</p>
          ) : analytics.isError ? (
            <p role="alert" className="awap-muted">
              Trend is unavailable right now.
            </p>
          ) : trend.length === 0 ? (
            <p className="awap-muted">No events in the last seven days.</p>
          ) : (
            <ul className="awap-dashboard__trend">
              {trend.map((point) => (
                <li key={point.day}>
                  <span>{point.day.slice(5)}</span>
                  <progress
                    aria-label={`${point.day}: ${point.count} events`}
                    value={point.count}
                    max={maxTrend}
                  />
                  <span>{point.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          className="awap-card"
          aria-labelledby="dashboard-attention-heading"
          data-testid="dashboard-needs-attention"
        >
          <h2 id="dashboard-attention-heading" className="awap-section-title">
            Needs attention
          </h2>
          {tasks.isLoading ? (
            <p className="awap-muted">Loading work items…</p>
          ) : tasks.isError ? (
            <p role="alert" className="awap-muted">
              Work items are unavailable right now.
            </p>
          ) : attention.length === 0 ? (
            <p className="awap-muted">Nothing needs attention.</p>
          ) : (
            <ul className="awap-list">
              {attention.map((task) => (
                <li key={task.id} className="awap-list-row">
                  <Link href={`/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link>
                  <span className="awap-muted">{task.status.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="awap-card"
          aria-labelledby="dashboard-activity-heading"
          data-testid="dashboard-recent-activity"
        >
          <h2 id="dashboard-activity-heading" className="awap-section-title">
            Recent activity
          </h2>
          {instances.isLoading ? (
            <p className="awap-muted">Loading activity…</p>
          ) : instances.isError ? (
            <p role="alert" className="awap-muted">
              Activity is unavailable right now.
            </p>
          ) : recent.length === 0 ? (
            <p className="awap-muted">No workflow activity yet.</p>
          ) : (
            <ul className="awap-list">
              {recent.map((instance) => (
                <li key={instance.id} className="awap-list-row">
                  <Link href={`/instances/${encodeURIComponent(instance.id)}`}>
                    {instance.workflowDefinitionId}
                  </Link>
                  <span className="awap-muted">{instance.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {allEmpty ? (
        <section className="awap-card" data-testid="dashboard-onboarding">
          <h2 className="awap-section-title">Start with a workflow</h2>
          <p className="awap-muted">
            No work has reached this tenant yet. Create and publish a workflow to see pending work,
            SLA risk and activity here.
          </p>
          <Link href="/workflows/designer">Open the designer</Link>
        </section>
      ) : null}
    </div>
  );
}
