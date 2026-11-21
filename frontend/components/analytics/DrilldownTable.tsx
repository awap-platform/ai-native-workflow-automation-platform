import type { AnalyticsDrilldownDto } from "../../lib/api";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Paginated raw-event list behind one analytics card or bucket. */
export function DrilldownTable({
  data,
  onPrevious,
  onNext,
}: {
  data: AnalyticsDrilldownDto;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="awap-stack" data-testid="analytics-drilldown">
      <p className="awap-muted">
        {data.totalElements} sampled event{data.totalElements === 1 ? "" : "s"} for{" "}
        {data.eventType ?? "all event types"}. Page {data.page + 1} of{" "}
        {Math.max(data.totalPages, 1)}.
      </p>
      {data.rows.length === 0 ? (
        <p className="awap-empty">No sampled events in this window.</p>
      ) : (
        <div className="awap-table-wrap">
          <table className="awap-table">
            <caption className="sr-only">
              Raw analytics events for {data.eventType ?? "all event types"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Occurred (UTC)</th>
                <th scope="col">Event</th>
                <th scope="col">Node</th>
                <th scope="col">Workflow instance</th>
                <th scope="col">Task</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} data-testid={`drilldown-row-${row.id}`}>
                  <td>{row.occurredAt}</td>
                  <td>{row.eventType}</td>
                  <td>{row.nodeId ?? "—"}</td>
                  <td className="awap-mono">{row.workflowInstanceId ?? "—"}</td>
                  <td className="awap-mono">{row.taskId ?? "—"}</td>
                  <td>{formatDuration(row.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="awap-inline">
        <button
          type="button"
          className="awap-button"
          onClick={onPrevious}
          disabled={data.page <= 0}
        >
          Previous page
        </button>
        <button
          type="button"
          className="awap-button"
          onClick={onNext}
          disabled={data.page + 1 >= data.totalPages}
        >
          Next page
        </button>
      </div>
    </div>
  );
}
