const STATUS_CLASS: Record<string, string> = {
  UP: "awap-status-badge awap-status-up",
  DOWN: "awap-status-badge awap-status-down",
  UNKNOWN: "awap-status-badge awap-status-unknown",
  IDLE: "awap-status-badge awap-status-idle",
  BACKLOG: "awap-status-badge awap-status-backlog",
};

/** Small status pill for job and component health. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={STATUS_CLASS[status] ?? "awap-status-badge"} data-testid={`status-${status}`}>
      {status}
    </span>
  );
}
