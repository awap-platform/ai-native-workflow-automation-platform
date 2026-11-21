/** One metric card; every value is supplied by the server projection. */
export function StatCard({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string | number;
  detail?: string;
  testId?: string;
}) {
  return (
    <div className="awap-stat" data-testid={testId}>
      <span className="awap-stat-label">{label}</span>
      <span className="awap-stat-value" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </span>
      {detail ? <span className="awap-stat-detail">{detail}</span> : null}
    </div>
  );
}
