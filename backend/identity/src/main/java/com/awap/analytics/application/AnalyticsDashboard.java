package com.awap.analytics.application;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Versioned response contract for the advanced analytics dashboard (issue #285).
 *
 * <p>Daily totals are authoritative PostgreSQL aggregates. Percentiles, cycle times, bottlenecks
 * and trends are computed from the bounded raw-event sample window. {@code dataCompleteness}
 * exposes which sources were available so the dashboard can render an explicit partial state
 * instead of inventing values.
 */
public record AnalyticsDashboard(
    LocalDate from,
    LocalDate to,
    String granularity,
    String timezone,
    DataCompleteness dataCompleteness,
    List<DailyTotal> dailyTotals,
    List<TimeBucket> timeBuckets,
    PercentileSet workflowDuration,
    PercentileSet taskCycleTime,
    PercentileSet approvalLatency,
    double failureRate,
    double slaBreachRate,
    List<Bottleneck> bottlenecks,
    List<GroupSummary> groups,
    Trend trend) {

  /** Which data sources backed the response. */
  public record DataCompleteness(
      boolean dailyTotalsAvailable, boolean rawEventsAvailable, long sampleCount) {}

  /** One authoritative tenant/day/event-type aggregate. */
  public record DailyTotal(
      LocalDate day, String eventType, long count, long totalDurationMs, long averageDurationMs) {}

  /** One time bucket and the event-type counts it contains. */
  public record TimeBucket(String bucket, long total, Map<String, Long> counts) {}

  /** Exact percentiles over the samples in the window; fields are null when no sample exists. */
  public record PercentileSet(Long p50, Long p90, Long p95, Long p99, long sampleCount) {

    public static PercentileSet empty() {
      return new PercentileSet(null, null, null, null, 0);
    }
  }

  /** Ranked node that spends the most time in the window. */
  public record Bottleneck(String nodeId, long count, long averageDurationMs, long p95DurationMs) {}

  /** One group-by bucket. */
  public record GroupSummary(String key, long count, long averageDurationMs, long p95DurationMs) {}

  /** Current window versus the equally sized preceding window. */
  public record Trend(long currentCount, long previousCount, long delta) {}
}
