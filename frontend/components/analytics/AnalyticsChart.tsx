/**
 * Accessible bar chart for the server's time buckets.
 *
 * The SVG is a single labelled image; every value it draws is also available in the bucket table
 * below it, so a screen-reader user never depends on the visual bars.
 */
export function AnalyticsChart({
  buckets,
}: {
  buckets: Array<{ bucket: string; total: number }>;
}) {
  if (buckets.length === 0) {
    return <p className="awap-muted">No buckets in the selected window.</p>;
  }
  const max = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const barWidth = 28;
  const gap = 14;
  const width = buckets.length * (barWidth + gap) + gap;
  const summary = buckets
    .map((bucket) => `${bucket.bucket}: ${bucket.total}`)
    .join(", ");
  return (
    <figure className="awap-stack">
      <svg
        role="img"
        aria-label={`Event totals by bucket. ${summary}`}
        viewBox={`0 0 ${width} 120`}
        className="awap-chart"
        preserveAspectRatio="none"
      >
        <line className="awap-chart-axis" x1="0" y1="110" x2={width} y2="110" />
        {buckets.map((bucket, index) => {
          const height = Math.max(2, Math.round((bucket.total / max) * 96));
          return (
            <rect
              key={bucket.bucket}
              className="awap-chart-bar"
              x={gap + index * (barWidth + gap)}
              y={110 - height}
              width={barWidth}
              height={height}
              rx="3"
            >
              <title>{`${bucket.bucket}: ${bucket.total}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="awap-chart-labels">
        {buckets.map((bucket) => (
          <span key={bucket.bucket}>{bucket.bucket}</span>
        ))}
      </figcaption>
    </figure>
  );
}
