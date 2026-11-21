"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnalyticsChart } from "../../../components/analytics/AnalyticsChart";
import { DrilldownTable } from "../../../components/analytics/DrilldownTable";
import { ConfirmationPanel } from "../../../components/admin/ConfirmationPanel";
import { StatCard } from "../../../components/admin/StatCard";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialState,
} from "../../../components/ui/QueryState";
import { analyticsExportUrl, type AnalyticsDashboardParams } from "../../../lib/api";
import { fetchExport, saveExport } from "../../../lib/export";
import {
  useAnalyticsDrilldown,
  useAnalyticsOverview,
} from "../../../lib/hooks/resources";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { from: isoDate(from), to: isoDate(to) };
}

function validDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function initialRange(params: URLSearchParams): {
  from: string;
  to: string;
  granularity: "DAY" | "WEEK" | "MONTH";
  groupBy: "EVENT_TYPE" | "NODE" | "WORKFLOW";
} {
  const fallback = defaultRange();
  const granularity = params.get("granularity");
  const groupBy = params.get("groupBy");
  return {
    from: validDate(params.get("from")) ?? fallback.from,
    to: validDate(params.get("to")) ?? fallback.to,
    granularity: granularity === "WEEK" || granularity === "MONTH" ? granularity : "DAY",
    groupBy: groupBy === "NODE" || groupBy === "WORKFLOW" ? groupBy : "EVENT_TYPE",
  };
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "—";
  }
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function AnalyticsScreen() {
  const searchParams = useSearchParams();
  const [initial] = useState(() => initialRange(searchParams));
  const [range, setRange] = useState({ from: initial.from, to: initial.to });
  const [granularity, setGranularity] = useState<"DAY" | "WEEK" | "MONTH">(
    initial.granularity,
  );
  const [groupBy, setGroupBy] = useState<"EVENT_TYPE" | "NODE" | "WORKFLOW">(
    initial.groupBy,
  );
  const [drillEventType, setDrillEventType] = useState<string | null>(null);
  const [drillPage, setDrillPage] = useState(0);
  const [confirmExport, setConfirmExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const reversed = range.from !== "" && range.to !== "" && range.from > range.to;
  const ready = range.from !== "" && range.to !== "" && !reversed;
  const params: AnalyticsDashboardParams = {
    from: range.from || undefined,
    to: range.to || undefined,
    granularity,
    groupBy,
    limit: 10,
  };
  const overview = useAnalyticsOverview(params, ready);
  const drilldown = useAnalyticsDrilldown(
    {
      from: range.from || undefined,
      to: range.to || undefined,
      eventType: drillEventType ?? undefined,
      page: drillPage,
      size: 20,
    },
    ready && drillEventType !== null,
  );

  const totals = useMemo(() => {
    const map = new Map(
      (overview.data?.eventTotals ?? []).map((row) => [row.eventType, row]),
    );
    return map;
  }, [overview.data]);

  const dashboard = overview.data?.dashboard;

  async function runExport() {
    setExporting(true);
    setExportError(null);
    setExportStatus("Preparing the analytics export…");
    try {
      const result = await fetchExport({
        url: analyticsExportUrl(params),
        onRetry: () => setExportStatus("The export timed out; retrying once…"),
      });
      saveExport(result.blob, "awap-analytics.csv");
      setExportStatus(
        `Export ready: ${result.bytes} bytes.` +
          (result.usedRetry ? " The request timed out once and was retried." : ""),
      );
    } catch (error) {
      setExportStatus(null);
      setExportError(
        error instanceof Error ? error.message : "The analytics export failed.",
      );
    } finally {
      setExporting(false);
      setConfirmExport(false);
    }
  }

  if (reversed) {
    return (
      <div className="awap-page">
        <h1 className="awap-page-title">Analytics</h1>
        <RangeFilters
          range={range}
          setRange={setRange}
          granularity={granularity}
          setGranularity={setGranularity}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
        />
        <p role="alert" className="awap-alert awap-alert-danger" data-testid="range-error">
          From must not be after to.
        </p>
      </div>
    );
  }

  if (!ready || overview.isLoading) {
    return (
      <div className="awap-page">
        <h1 className="awap-page-title">Analytics</h1>
        <RangeFilters
          range={range}
          setRange={setRange}
          granularity={granularity}
          setGranularity={setGranularity}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
        />
        <LoadingState label="Loading analytics…" />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <div className="awap-page">
        <h1 className="awap-page-title">Analytics</h1>
        <RangeFilters
          range={range}
          setRange={setRange}
          granularity={granularity}
          setGranularity={setGranularity}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
        />
        <ErrorState error={overview.error} message="Failed to load analytics." />
      </div>
    );
  }
  if (!overview.data || !dashboard) {
    return <ErrorState message="Failed to load analytics." />;
  }

  const isEmpty = overview.data.totalEvents === 0 && dashboard.dailyTotals.length === 0;

  return (
    <div className="awap-page">
      <div className="awap-card-header">
        <h1 className="awap-page-title">Analytics</h1>
        <button
          type="button"
          className="awap-button"
          onClick={() => setConfirmExport(true)}
        >
          Export analytics
        </button>
      </div>

      <RangeFilters
        range={range}
        setRange={setRange}
        granularity={granularity}
        setGranularity={setGranularity}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
      />

      {confirmExport ? (
        <ConfirmationPanel
          id="analytics-export-confirmation"
          title="Export analytics?"
          description={`This exports the ${range.from} to ${range.to} window as CSV.`}
          confirmLabel="Export CSV"
          onConfirm={() => void runExport()}
          onCancel={() => setConfirmExport(false)}
          busy={exporting}
        />
      ) : null}
      {exportStatus ? (
        <p role="status" className="awap-alert awap-alert-success" data-testid="analytics-export-status">
          {exportStatus}
        </p>
      ) : null}
      {exportError ? (
        <p role="alert" className="awap-alert awap-alert-danger" data-testid="analytics-export-error">
          {exportError}
        </p>
      ) : null}

      {!dashboard.dataCompleteness.rawEventsAvailable ? (
        <PartialState message="Raw-event analytics are temporarily unavailable. Daily totals are still authoritative; percentile, bottleneck and drill-down panels are partially populated." />
      ) : null}

      <div className="awap-grid">
        <StatCard
          testId="analytics-total-events"
          label="Total events"
          value={overview.data.totalEvents}
          detail={`${dashboard.dataCompleteness.sampleCount} sampled events`}
        />
        <StatCard
          testId="analytics-completed-workflows"
          label="Completed workflows"
          value={totals.get("WORKFLOW_COMPLETED")?.count ?? 0}
          detail={`avg ${formatDuration(totals.get("WORKFLOW_COMPLETED")?.averageDurationMs)}`}
        />
        <StatCard
          testId="analytics-failed-workflows"
          label="Failed workflows"
          value={totals.get("WORKFLOW_FAILED")?.count ?? 0}
          detail={`failure rate ${formatPercent(dashboard.failureRate)}`}
        />
        <StatCard
          testId="analytics-completed-tasks"
          label="Completed tasks"
          value={totals.get("TASK_COMPLETED")?.count ?? 0}
          detail={`avg ${formatDuration(totals.get("TASK_COMPLETED")?.averageDurationMs)}`}
        />
        <StatCard
          testId="analytics-sla-breaches"
          label="SLA breaches"
          value={totals.get("SLA_BREACHED")?.count ?? 0}
          detail={`breach rate ${formatPercent(dashboard.slaBreachRate)}`}
        />
        <StatCard
          testId="analytics-workflow-p95"
          label="Workflow duration p95"
          value={formatDuration(dashboard.workflowDuration.p95)}
          detail={`p50 ${formatDuration(dashboard.workflowDuration.p50)}`}
        />
        <StatCard
          testId="analytics-task-p95"
          label="Task cycle time p95"
          value={formatDuration(dashboard.taskCycleTime.p95)}
          detail={`p50 ${formatDuration(dashboard.taskCycleTime.p50)}`}
        />
        <StatCard
          testId="analytics-approval-p95"
          label="Approval latency p95"
          value={formatDuration(dashboard.approvalLatency.p95)}
          detail={`p50 ${formatDuration(dashboard.approvalLatency.p50)}`}
        />
        <StatCard
          testId="analytics-trend"
          label="Window trend"
          value={`${dashboard.trend.delta >= 0 ? "+" : ""}${dashboard.trend.delta}`}
          detail={`${dashboard.trend.currentCount} now / ${dashboard.trend.previousCount} before`}
        />
      </div>

      {isEmpty ? (
        <EmptyState message="No analytics recorded in the selected window." />
      ) : (
        <>
          <section className="awap-panel" aria-label="Event volume by bucket">
            <h2 className="awap-panel-title">
              Event volume by bucket ({dashboard.granularity}, UTC)
            </h2>
            <AnalyticsChart buckets={dashboard.timeBuckets} />
          </section>

          <section className="awap-panel" aria-label="Event totals">
            <h2 className="awap-panel-title">Event totals</h2>
            <div className="awap-table-wrap">
              <table className="awap-table">
                <caption className="sr-only">Totals and drill-down for each event type</caption>
                <thead>
                  <tr>
                    <th scope="col">Event type</th>
                    <th scope="col">Count</th>
                    <th scope="col">Total duration</th>
                    <th scope="col">Average</th>
                    <th scope="col">Drill down</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.eventTotals.map((row) => (
                    <tr key={row.eventType} data-testid={`analytics-row-${row.eventType}`}>
                      <td>{row.eventType}</td>
                      <td>{row.count}</td>
                      <td>{formatDuration(row.totalDurationMs)}</td>
                      <td>{formatDuration(row.averageDurationMs)}</td>
                      <td>
                        <button
                          type="button"
                          className="awap-button"
                          onClick={() => {
                            setDrillEventType(row.eventType);
                            setDrillPage(0);
                          }}
                        >
                          Drill down
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {drillEventType ? (
            <section className="awap-panel" aria-label="Drill-down">
              <div className="awap-card-header">
                <h2 className="awap-panel-title">Drill-down: {drillEventType}</h2>
                <button
                  type="button"
                  className="awap-button"
                  onClick={() => setDrillEventType(null)}
                >
                  Close drill-down
                </button>
              </div>
              {drilldown.isLoading ? <LoadingState label="Loading drill-down…" /> : null}
              {drilldown.isError ? (
                <ErrorState error={drilldown.error} message="Failed to load drill-down rows." />
              ) : null}
              {drilldown.data ? (
                drilldown.data.partial ? (
                  <PartialState
                    message={
                      drilldown.data.detail ??
                      "The raw-event source is unavailable; drill-down rows cannot be shown."
                    }
                  />
                ) : (
                  <DrilldownTable
                    data={drilldown.data}
                    onPrevious={() => setDrillPage((page) => Math.max(0, page - 1))}
                    onNext={() => setDrillPage((page) => page + 1)}
                  />
                )
              ) : null}
            </section>
          ) : null}

          <section className="awap-panel" aria-label="Bottleneck nodes">
            <h2 className="awap-panel-title">Bottleneck nodes</h2>
            <div className="awap-table-wrap">
              <table className="awap-table">
                <caption className="sr-only">Nodes ranked by average duration</caption>
                <thead>
                  <tr>
                    <th scope="col">Node</th>
                    <th scope="col">Events</th>
                    <th scope="col">Average</th>
                    <th scope="col">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.bottlenecks.map((bottleneck) => (
                    <tr
                      key={bottleneck.nodeId}
                      data-testid={`analytics-bottleneck-${bottleneck.nodeId}`}
                    >
                      <td>{bottleneck.nodeId}</td>
                      <td>{bottleneck.count}</td>
                      <td>{formatDuration(bottleneck.averageDurationMs)}</td>
                      <td>{formatDuration(bottleneck.p95DurationMs)}</td>
                    </tr>
                  ))}
                  {dashboard.bottlenecks.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="awap-muted">
                        No node samples in the selected window.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="awap-panel" aria-label="Daily totals">
            <h2 className="awap-panel-title">Daily totals</h2>
            <div className="awap-table-wrap">
              <table className="awap-table">
                <caption className="sr-only">Authoritative daily aggregates</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Event</th>
                    <th scope="col">Count</th>
                    <th scope="col">Total duration</th>
                    <th scope="col">Average duration</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.dailyTotals.map((row) => (
                    <tr key={`${row.day}-${row.eventType}`}>
                      <td>{row.day}</td>
                      <td>{row.eventType}</td>
                      <td>{row.count}</td>
                      <td>{formatDuration(row.totalDurationMs)}</td>
                      <td>{formatDuration(row.averageDurationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Route wrapper: `useSearchParams` needs a Suspense boundary. */
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading analytics…" />}>
      <AnalyticsScreen />
    </Suspense>
  );
}

function RangeFilters({
  range,
  setRange,
  granularity,
  setGranularity,
  groupBy,
  setGroupBy,
}: {
  range: { from: string; to: string };
  setRange: (value: { from: string; to: string }) => void;
  granularity: "DAY" | "WEEK" | "MONTH";
  setGranularity: (value: "DAY" | "WEEK" | "MONTH") => void;
  groupBy: "EVENT_TYPE" | "NODE" | "WORKFLOW";
  setGroupBy: (value: "EVENT_TYPE" | "NODE" | "WORKFLOW") => void;
}) {
  return (
    <div className="awap-toolbar" role="search" aria-label="Analytics filters">
      <label className="awap-field">
        <span className="awap-label">From</span>
        <input
          type="date"
          className="awap-input"
          value={range.from}
          onChange={(event) => setRange({ ...range, from: event.target.value })}
        />
      </label>
      <label className="awap-field">
        <span className="awap-label">To</span>
        <input
          type="date"
          className="awap-input"
          value={range.to}
          onChange={(event) => setRange({ ...range, to: event.target.value })}
        />
      </label>
      <label className="awap-field">
        <span className="awap-label">Granularity</span>
        <select
          className="awap-select"
          value={granularity}
          onChange={(event) =>
            setGranularity(event.target.value as "DAY" | "WEEK" | "MONTH")
          }
        >
          <option value="DAY">Day</option>
          <option value="WEEK">Week</option>
          <option value="MONTH">Month</option>
        </select>
      </label>
      <label className="awap-field">
        <span className="awap-label">Group by</span>
        <select
          className="awap-select"
          value={groupBy}
          onChange={(event) =>
            setGroupBy(event.target.value as "EVENT_TYPE" | "NODE" | "WORKFLOW")
          }
        >
          <option value="EVENT_TYPE">Event type</option>
          <option value="NODE">Node</option>
          <option value="WORKFLOW">Workflow</option>
        </select>
      </label>
    </div>
  );
}
