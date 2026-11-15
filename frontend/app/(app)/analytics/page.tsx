"use client";

import { ErrorState, LoadingState } from "../../../components/ui/QueryState";
import { useAnalyticsDashboard } from "../../../lib/hooks/resources";

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function AnalyticsPage() {
  const analytics = useAnalyticsDashboard();
  const dashboard = analytics.data;

  if (analytics.isLoading) {
    return <LoadingState label="Loading analytics…" />;
  }
  if (analytics.isError) {
    return <ErrorState error={analytics.error} message="Failed to load analytics." />;
  }
  if (!dashboard) {
    return <ErrorState message="Failed to load analytics." />;
  }

  const dailyTotals = dashboard.dailyTotals;
  const workflowCompleted = dailyTotals.find((item) => item.eventType === "WORKFLOW_COMPLETED");
  const workflowFailed = dailyTotals.find((item) => item.eventType === "WORKFLOW_FAILED");
  const taskCompleted = dailyTotals.find((item) => item.eventType === "TASK_COMPLETED");
  const isEmpty = dailyTotals.length === 0 && dashboard.dataCompleteness.sampleCount === 0;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Analytics</h1>

      {!dashboard.dataCompleteness.rawEventsAvailable && (
        <p
          role="status"
          data-testid="analytics-partial-state"
          style={{
            border: "1px solid #f59e0b",
            borderRadius: 8,
            padding: 12,
            background: "#fffbeb",
            color: "#92400e",
          }}
        >
          Raw-event analytics are temporarily unavailable. Daily totals are still authoritative;
          percentile, bottleneck and trend panels are partially populated.
        </p>
      )}

      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <MetricCard
          testId="analytics-completed-workflows"
          title="Completed workflows"
          value={String(workflowCompleted?.count ?? 0)}
          detail={`avg ${formatDuration(workflowCompleted?.averageDurationMs ?? 0)}`}
        />
        <MetricCard
          testId="analytics-failed-workflows"
          title="Failed workflows"
          value={String(workflowFailed?.count ?? 0)}
          detail={`failure rate ${formatPercent(dashboard.failureRate)}`}
        />
        <MetricCard
          testId="analytics-completed-tasks"
          title="Completed tasks"
          value={String(taskCompleted?.count ?? 0)}
          detail={`avg ${formatDuration(taskCompleted?.averageDurationMs ?? 0)}`}
        />
        <MetricCard
          testId="analytics-sla-breach-rate"
          title="SLA breach rate"
          value={formatPercent(dashboard.slaBreachRate)}
          detail={`${dashboard.dataCompleteness.sampleCount} sampled events`}
        />
        <MetricCard
          testId="analytics-workflow-p95"
          title="Workflow duration p95"
          value={formatDuration(dashboard.workflowDuration.p95)}
          detail={`p50 ${formatDuration(dashboard.workflowDuration.p50)}`}
        />
        <MetricCard
          testId="analytics-task-cycle-p95"
          title="Task cycle time p95"
          value={formatDuration(dashboard.taskCycleTime.p95)}
          detail={`p50 ${formatDuration(dashboard.taskCycleTime.p50)}`}
        />
        <MetricCard
          testId="analytics-approval-latency-p95"
          title="Approval latency p95"
          value={formatDuration(dashboard.approvalLatency.p95)}
          detail={`p50 ${formatDuration(dashboard.approvalLatency.p50)}`}
        />
        <MetricCard
          testId="analytics-trend"
          title="Window trend"
          value={`${dashboard.trend.delta >= 0 ? "+" : ""}${dashboard.trend.delta}`}
          detail={`${dashboard.trend.currentCount} now / ${dashboard.trend.previousCount} before`}
        />
      </div>

      {isEmpty ? (
        <p style={{ padding: 8, color: "#6b7280" }}>
          No analytics recorded in the selected window.
        </p>
      ) : (
        <>
          <Panel title="Bottleneck nodes">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{ padding: 8 }}>Node</th>
                  <th style={{ padding: 8 }}>Events</th>
                  <th style={{ padding: 8 }}>Average</th>
                  <th style={{ padding: 8 }}>p95</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.bottlenecks.map((bottleneck) => (
                  <tr
                    key={bottleneck.nodeId}
                    data-testid={`analytics-bottleneck-${bottleneck.nodeId}`}
                    style={{ borderBottom: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: 8 }}>{bottleneck.nodeId}</td>
                    <td style={{ padding: 8 }}>{bottleneck.count}</td>
                    <td style={{ padding: 8 }}>{formatDuration(bottleneck.averageDurationMs)}</td>
                    <td style={{ padding: 8 }}>{formatDuration(bottleneck.p95DurationMs)}</td>
                  </tr>
                ))}
                {dashboard.bottlenecks.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 8, color: "#6b7280" }}>
                      No node samples in the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel title="Time buckets">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{ padding: 8 }}>Bucket ({dashboard.granularity}, UTC)</th>
                  <th style={{ padding: 8 }}>Total</th>
                  <th style={{ padding: 8 }}>Counts</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.timeBuckets.map((bucket) => (
                  <tr
                    key={bucket.bucket}
                    data-testid={`analytics-bucket-${bucket.bucket}`}
                    style={{ borderBottom: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: 8 }}>{bucket.bucket}</td>
                    <td style={{ padding: 8 }}>{bucket.total}</td>
                    <td style={{ padding: 8 }}>
                      {Object.entries(bucket.counts)
                        .map(([eventType, count]) => `${eventType}: ${count}`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
                {dashboard.timeBuckets.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 8, color: "#6b7280" }}>
                      No buckets in the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel title="Grouped summary">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{ padding: 8 }}>Key</th>
                  <th style={{ padding: 8 }}>Count</th>
                  <th style={{ padding: 8 }}>Average</th>
                  <th style={{ padding: 8 }}>p95</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.groups.map((group) => (
                  <tr
                    key={group.key}
                    data-testid={`analytics-group-${group.key}`}
                    style={{ borderBottom: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: 8 }}>{group.key}</td>
                    <td style={{ padding: 8 }}>{group.count}</td>
                    <td style={{ padding: 8 }}>{formatDuration(group.averageDurationMs)}</td>
                    <td style={{ padding: 8 }}>{formatDuration(group.p95DurationMs)}</td>
                  </tr>
                ))}
                {dashboard.groups.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 8, color: "#6b7280" }}>
                      No groups in the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel title="Daily totals">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{ padding: 8 }}>Day</th>
                  <th style={{ padding: 8 }}>Event</th>
                  <th style={{ padding: 8 }}>Count</th>
                  <th style={{ padding: 8 }}>Total duration</th>
                  <th style={{ padding: 8 }}>Average duration</th>
                </tr>
              </thead>
              <tbody>
                {dailyTotals.map((item) => (
                  <tr
                    key={`${item.day}-${item.eventType}`}
                    data-testid={`analytics-row-${item.eventType}`}
                    style={{ borderBottom: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: 8 }}>{item.day}</td>
                    <td style={{ padding: 8 }}>{item.eventType}</td>
                    <td style={{ padding: 8 }}>{item.count}</td>
                    <td style={{ padding: 8 }}>{formatDuration(item.totalDurationMs)}</td>
                    <td style={{ padding: 8 }}>{formatDuration(item.averageDurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({
  testId,
  title,
  value,
  detail,
}: {
  testId: string;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        padding: 16,
        minWidth: 180,
        background: "#f8fafc",
      }}
    >
      <div style={{ color: "#475569", fontSize: 13 }}>{title}</div>
      <div data-testid={`${testId}-value`} style={{ fontSize: 28, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ color: "#6b7280", fontSize: 12 }}>{detail}</div>
    </div>
  );
}
